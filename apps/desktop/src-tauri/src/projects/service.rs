use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::protocols::scheme_base;
use crate::schema::plugins::COVER_SCHEME;
use crate::schema::projects::{Collection, CreateProject, HomeData, ProjectPatch, ProjectStatus, ProjectSummary, Tag, UpsertCollection, UpsertTag};
use crate::util::paths::{normalize, same_path};
use crate::util::time::{mtime_ms, now_iso};
use crate::util::{json, Error, Result};

use super::files::{cover_file, meta_file, project_file, MetaFile, ProjectFile, Registry, RegistryEntry, COVER_EXTENSIONS, MAX_COVER_BYTES, SOURCES_DIR};
use super::folder_name::{folder_name, unique_folder};

fn project_error(code: &str) -> Error {
    Error::new(format!("project:{code}"))
}

fn read_project(root: &Path) -> Option<ProjectFile> {
    json::read(&project_file(root), ProjectFile::parse)
}

fn read_meta(root: &Path) -> Option<MetaFile> {
    json::read(&meta_file(root), MetaFile::parse)
}

fn is_dir(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

pub struct ProjectService {
    registry_file: PathBuf,
    location: Box<dyn Fn() -> PathBuf + Send + Sync>,
    registry: Mutex<Registry>,
}

impl ProjectService {
    pub fn new(registry_file: PathBuf, location: impl Fn() -> PathBuf + Send + Sync + 'static) -> Self {
        ProjectService { registry_file, location: Box::new(location), registry: Mutex::new(Registry::empty()) }
    }

    pub fn default_location(&self) -> PathBuf {
        (self.location)()
    }

    pub fn load(&self) {
        *self.registry.lock().unwrap() = json::read(&self.registry_file, Registry::parse).unwrap_or_else(Registry::empty);
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.registry.lock().unwrap().projects.iter().map(|p| PathBuf::from(&p.path)).collect()
    }

    pub fn home(&self) -> HomeData {
        let registry = self.registry.lock().unwrap();
        HomeData {
            projects: registry.projects.iter().map(|e| summary(&registry, e)).collect(),
            tags: registry.tags.clone(),
            collections: registry.collections.clone(),
            default_location: self.default_location().to_string_lossy().into_owned(),
        }
    }

    pub fn create(&self, request: &CreateProject) -> Result<ProjectSummary> {
        let raw = Path::new(&request.location);
        if !raw.is_absolute() {
            return Err(project_error("invalid-location"));
        }
        let location = normalize(raw);
        if same_path(&location, &self.default_location()) {
            fs::create_dir_all(&location)?;
        }
        if !is_dir(&location) {
            return Err(project_error("invalid-location"));
        }
        let mut registry = self.registry.lock().unwrap();
        let root = unique_folder(&location, &folder_name(&request.name))?;
        let project = ProjectFile { format_version: 1, id: uuid::Uuid::new_v4().to_string(), name: request.name.clone(), game: "ssbu".into(), created_at: now_iso() };
        let meta = MetaFile { kind: request.kind, ..MetaFile::default_meta() };
        fs::create_dir_all(root.join(SOURCES_DIR))?;
        json::write(&project_file(&root), &project)?;
        json::write(&meta_file(&root), &meta)?;
        let entry = RegistryEntry { id: project.id, path: root.to_string_lossy().into_owned(), name: project.name, last_opened: None };
        registry.projects.push(entry.clone());
        self.save(&registry)?;
        Ok(summary(&registry, &entry))
    }

    pub fn import_folder(&self, folder: &Path) -> Result<ProjectSummary> {
        let root = normalize(folder);
        if !is_dir(&root) {
            return Err(project_error("not-a-folder"));
        }
        let mut registry = self.registry.lock().unwrap();
        if let Some(known) = registry.projects.iter().find(|p| same_path(Path::new(&p.path), &root)) {
            return Ok(summary(&registry, known));
        }
        let existing = read_project(&root);
        let project = match existing {
            Some(project) if !registry.projects.iter().any(|p| p.id == project.id) => project,
            other => {
                let project = ProjectFile {
                    format_version: 1,
                    id: uuid::Uuid::new_v4().to_string(),
                    name: other.as_ref().map(|p| p.name.clone()).unwrap_or_else(|| crate::util::paths::file_name(&root)),
                    game: "ssbu".into(),
                    created_at: other.as_ref().map(|p| p.created_at.clone()).unwrap_or_else(now_iso),
                };
                json::write(&project_file(&root), &project)?;
                project
            }
        };
        if read_meta(&root).is_none() {
            json::write(&meta_file(&root), &MetaFile::default_meta())?;
        }
        fs::create_dir_all(root.join(SOURCES_DIR))?;
        let entry = RegistryEntry { id: project.id, path: root.to_string_lossy().into_owned(), name: project.name, last_opened: None };
        registry.projects.push(entry.clone());
        self.save(&registry)?;
        Ok(summary(&registry, &entry))
    }

    pub fn open(&self, id: &str) -> Result<ProjectSummary> {
        let mut registry = self.registry.lock().unwrap();
        let index = index_of(&registry, id)?;
        if read_project(Path::new(&registry.projects[index].path)).is_none() {
            return Err(project_error("missing"));
        }
        registry.projects[index].last_opened = Some(now_iso());
        self.save(&registry)?;
        Ok(summary(&registry, &registry.projects[index]))
    }

    pub fn update(&self, id: &str, patch: &ProjectPatch) -> Result<ProjectSummary> {
        let mut registry = self.registry.lock().unwrap();
        let index = index_of(&registry, id)?;
        let root = PathBuf::from(&registry.projects[index].path);
        let (mut project, meta) = read_files(&root)?;
        if let Some(name) = &patch.name {
            project.name = name.clone();
            registry.projects[index].name = name.clone();
            json::write(&project_file(&root), &project)?;
        }
        let mut next = meta;
        if let Some(kind) = patch.kind {
            next.kind = kind;
        }
        if let Some(status) = patch.status {
            next.status = status;
        }
        if let Some(favorite) = patch.favorite {
            next.favorite = favorite;
        }
        if let Some(tags) = &patch.tags {
            let mut unique: Vec<String> = vec![];
            for tag in tags {
                if !unique.contains(tag) && registry.tags.iter().any(|t| &t.id == tag) {
                    unique.push(tag.clone());
                }
            }
            next.tags = unique;
        }
        if let Some(collection) = &patch.collection {
            next.collection = collection.clone().filter(|c| registry.collections.iter().any(|x| &x.id == c));
        }
        next.updated_at = now_iso();
        json::write(&meta_file(&root), &next)?;
        self.save(&registry)?;
        Ok(summary(&registry, &registry.projects[index]))
    }

    pub fn set_cover(&self, id: &str, source: &Path) -> Result<ProjectSummary> {
        let registry = self.registry.lock().unwrap();
        let index = index_of(&registry, id)?;
        let root = PathBuf::from(&registry.projects[index].path);
        read_files(&root)?;
        let ext = source.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !COVER_EXTENSIONS.contains(&ext.as_str()) {
            return Err(project_error("invalid-cover"));
        }
        match fs::metadata(source) {
            Ok(info) if info.is_file() && info.len() <= MAX_COVER_BYTES => {}
            _ => return Err(project_error("invalid-cover")),
        }
        clear_cover(&root);
        fs::copy(source, cover_file(&root, &ext))?;
        touch(&root)?;
        Ok(summary(&registry, &registry.projects[index]))
    }

    pub fn remove_cover(&self, id: &str) -> Result<ProjectSummary> {
        let registry = self.registry.lock().unwrap();
        let index = index_of(&registry, id)?;
        let root = PathBuf::from(&registry.projects[index].path);
        clear_cover(&root);
        touch(&root)?;
        Ok(summary(&registry, &registry.projects[index]))
    }

    pub fn cover_path(&self, id: &str) -> Option<PathBuf> {
        let registry = self.registry.lock().unwrap();
        let entry = registry.projects.iter().find(|p| p.id == id)?;
        find_cover(Path::new(&entry.path))
    }

    pub fn forget(&self, id: &str) -> Result<()> {
        let mut registry = self.registry.lock().unwrap();
        index_of(&registry, id)?;
        registry.projects.retain(|p| p.id != id);
        self.save(&registry)
    }

    pub fn path_of(&self, id: &str) -> Result<PathBuf> {
        let registry = self.registry.lock().unwrap();
        Ok(PathBuf::from(&registry.projects[index_of(&registry, id)?].path))
    }

    pub fn root_of(&self, id: &str) -> Result<PathBuf> {
        let root = self.path_of(id)?;
        read_files(&root)?;
        Ok(root)
    }

    pub fn upsert_tag(&self, input: &UpsertTag) -> Result<Tag> {
        let mut registry = self.registry.lock().unwrap();
        let tag = Tag { id: input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()), name: input.name.clone(), color: input.color.to_lowercase() };
        match registry.tags.iter_mut().find(|t| t.id == tag.id) {
            Some(existing) => *existing = tag.clone(),
            None => registry.tags.push(tag.clone()),
        }
        self.save(&registry)?;
        Ok(tag)
    }

    pub fn delete_tag(&self, id: &str) -> Result<()> {
        let mut registry = self.registry.lock().unwrap();
        registry.tags.retain(|t| t.id != id);
        self.save(&registry)
    }

    pub fn upsert_collection(&self, input: &UpsertCollection) -> Result<Collection> {
        let mut registry = self.registry.lock().unwrap();
        let collection = Collection { id: input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()), name: input.name.clone() };
        match registry.collections.iter_mut().find(|c| c.id == collection.id) {
            Some(existing) => *existing = collection.clone(),
            None => registry.collections.push(collection.clone()),
        }
        self.save(&registry)?;
        Ok(collection)
    }

    pub fn delete_collection(&self, id: &str) -> Result<()> {
        let mut registry = self.registry.lock().unwrap();
        registry.collections.retain(|c| c.id != id);
        self.save(&registry)
    }

    fn save(&self, registry: &Registry) -> Result<()> {
        json::write(&self.registry_file, registry)
    }
}

fn index_of(registry: &Registry, id: &str) -> Result<usize> {
    registry.projects.iter().position(|p| p.id == id).ok_or_else(|| project_error("not-found"))
}

fn read_files(root: &Path) -> Result<(ProjectFile, MetaFile)> {
    let project = read_project(root).ok_or_else(|| project_error("missing"))?;
    let meta = read_meta(root).unwrap_or_else(MetaFile::default_meta);
    Ok((project, meta))
}

fn touch(root: &Path) -> Result<()> {
    let (_, mut meta) = read_files(root)?;
    meta.updated_at = now_iso();
    json::write(&meta_file(root), &meta)
}

fn clear_cover(root: &Path) {
    for ext in COVER_EXTENSIONS {
        let _ = fs::remove_file(cover_file(root, ext));
    }
}

fn find_cover(root: &Path) -> Option<PathBuf> {
    COVER_EXTENSIONS.iter().map(|ext| cover_file(root, ext)).find(|file| fs::metadata(file).map(|m| m.is_file()).unwrap_or(false))
}

fn summary(registry: &Registry, entry: &RegistryEntry) -> ProjectSummary {
    let root = Path::new(&entry.path);
    let project = read_project(root);
    let meta = if project.is_some() { read_meta(root).unwrap_or_else(MetaFile::default_meta) } else { MetaFile::default_meta() };
    let cover = project.as_ref().and_then(|_| find_cover(root));
    let cover_version = cover.as_ref().and_then(|c| fs::metadata(c).ok()).and_then(|m| m.modified().ok()).map(mtime_ms).unwrap_or(0.0);
    ProjectSummary {
        id: entry.id.clone(),
        name: project.as_ref().map(|p| p.name.clone()).unwrap_or_else(|| entry.name.clone()),
        path: entry.path.clone(),
        kind: meta.kind,
        status: if project.is_some() { meta.status } else { ProjectStatus::Draft },
        tags: meta.tags.iter().filter(|t| registry.tags.iter().any(|x| &x.id == *t)).cloned().collect(),
        collection: meta.collection.clone().filter(|c| registry.collections.iter().any(|x| &x.id == c)),
        favorite: meta.favorite,
        cover: cover.map(|_| format!("{}/{}/cover?v={}", scheme_base(COVER_SCHEME), entry.id, cover_version.round() as i64)),
        created_at: project.as_ref().map(|p| p.created_at.clone()).unwrap_or_else(|| meta.updated_at.clone()),
        updated_at: meta.updated_at.clone(),
        last_opened: entry.last_opened.clone(),
        missing: project.is_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::projects::ProjectKind;

    fn setup() -> (tempfile::TempDir, ProjectService) {
        let dir = tempfile::tempdir().unwrap();
        let location = dir.path().join("Projects");
        let service = ProjectService::new(dir.path().join("projects.json"), move || location.clone());
        service.load();
        (dir, service)
    }

    fn create(service: &ProjectService, dir: &Path, name: &str) -> ProjectSummary {
        service.create(&CreateProject { name: name.into(), kind: ProjectKind::Skin, location: dir.join("Projects").to_string_lossy().into() }).unwrap()
    }

    #[test]
    fn creates_in_default_location() {
        let (dir, service) = setup();
        let project = create(&service, dir.path(), "Mario Classic");
        assert_eq!(project.name, "Mario Classic");
        assert_eq!(PathBuf::from(&project.path), dir.path().join("Projects").join("mario-classic"));
        assert_eq!(project.status, ProjectStatus::Draft);
        assert!(!project.missing);
        let file = json::read_value(&project_file(Path::new(&project.path))).unwrap();
        assert_eq!(file["id"], project.id);
    }

    #[test]
    fn never_overwrites_a_folder_and_refuses_missing_location() {
        let (dir, service) = setup();
        let a = create(&service, dir.path(), "Same");
        let b = create(&service, dir.path(), "Same");
        assert_ne!(a.path, b.path);
        let err = service.create(&CreateProject { name: "X".into(), kind: ProjectKind::Skin, location: dir.path().join("nope").to_string_lossy().into() }).unwrap_err();
        assert_eq!(err.0, "project:invalid-location");
    }

    #[test]
    fn persists_registry() {
        let (dir, service) = setup();
        let created = create(&service, dir.path(), "Persist");
        let location = dir.path().join("Projects");
        let reloaded = ProjectService::new(dir.path().join("projects.json"), move || location.clone());
        reloaded.load();
        assert_eq!(reloaded.home().projects.iter().map(|p| p.id.clone()).collect::<Vec<_>>(), vec![created.id]);
    }

    #[test]
    fn keeps_only_known_tags_and_collections() {
        let (dir, service) = setup();
        let project = create(&service, dir.path(), "Tags");
        let tag = service.upsert_tag(&UpsertTag { id: None, name: "WIP".into(), color: "#FF6B6B".into() }).unwrap();
        let collection = service.upsert_collection(&UpsertCollection { id: None, name: "Skins".into() }).unwrap();
        let patch = ProjectPatch {
            tags: Some(vec![tag.id.clone(), tag.id.clone(), "00000000-0000-4000-8000-000000000000".into()]),
            collection: Some(Some(collection.id.clone())),
            favorite: Some(true),
            ..Default::default()
        };
        let updated = service.update(&project.id, &patch).unwrap();
        assert_eq!(updated.tags, vec![tag.id.clone()]);
        assert_eq!(updated.collection, Some(collection.id.clone()));
        assert!(updated.favorite);
        assert_eq!(tag.color, "#ff6b6b");
        service.delete_tag(&tag.id).unwrap();
        service.delete_collection(&collection.id).unwrap();
        let after = &service.home().projects[0];
        assert!(after.tags.is_empty());
        assert_eq!(after.collection, None);
    }

    #[test]
    fn marks_deleted_folder_missing() {
        let (dir, service) = setup();
        let project = create(&service, dir.path(), "Gone");
        fs::remove_dir_all(&project.path).unwrap();
        assert!(service.home().projects[0].missing);
        assert_eq!(service.open(&project.id).unwrap_err().0, "project:missing");
    }

    #[test]
    fn imports_folder_with_new_id_for_copies() {
        let (dir, service) = setup();
        let original = create(&service, dir.path(), "Original");
        let copy = dir.path().join("copy");
        fs::create_dir_all(copy.join(".tessera")).unwrap();
        fs::copy(project_file(Path::new(&original.path)), project_file(&copy)).unwrap();
        let imported = service.import_folder(&copy).unwrap();
        assert_ne!(imported.id, original.id);
        assert_eq!(imported.name, "Original");
        let again = service.import_folder(&copy).unwrap();
        assert_eq!(again.id, imported.id);
        assert_eq!(service.home().projects.len(), 2);
    }

    #[test]
    fn sets_and_removes_cover() {
        let (dir, service) = setup();
        let project = create(&service, dir.path(), "Cover");
        let png = dir.path().join("cover.png");
        let txt = dir.path().join("cover.txt");
        fs::write(&png, "fake").unwrap();
        fs::write(&txt, "fake").unwrap();
        assert_eq!(service.set_cover(&project.id, &txt).unwrap_err().0, "project:invalid-cover");
        let with_cover = service.set_cover(&project.id, &png).unwrap();
        let cover = with_cover.cover.unwrap();
        assert!(cover.starts_with(&format!("{}/{}/cover?v=", scheme_base(COVER_SCHEME), project.id)));
        assert_eq!(service.cover_path(&project.id).unwrap(), Path::new(&project.path).join(".tessera").join("cover.png"));
        assert_eq!(service.remove_cover(&project.id).unwrap().cover, None);
    }

    #[test]
    fn forgets_without_deleting_files() {
        let (dir, service) = setup();
        let project = create(&service, dir.path(), "Keep");
        service.forget(&project.id).unwrap();
        assert!(service.home().projects.is_empty());
        assert!(fs::read_to_string(project_file(Path::new(&project.path))).unwrap().contains(&project.id));
    }
}

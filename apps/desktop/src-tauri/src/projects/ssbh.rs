use std::io::Cursor;

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use ssbh_data::mesh_data::{MeshData, VectorData};
use ssbh_data::skel_data::SkelData;
use ssbh_data::SsbhData;

use crate::util::{Error, Result};

#[derive(Serialize)]
pub struct MeshBuffers {
    pub name: String,
    pub subindex: u64,
    pub positions: String,
    pub normals: String,
    pub uvs: Option<String>,
    pub indices: String,
    pub bones: Option<String>,
    pub weights: Option<String>,
}

fn parse<T: SsbhData + Serialize>(bytes: &[u8]) -> Result<Value> {
    let data = T::read(&mut Cursor::new(bytes)).map_err(|e| Error::new(format!("invalid ssbh file: {e}")))?;
    Ok(serde_json::to_value(data)?)
}

pub fn read_ssbh(bytes: &[u8], path: &str) -> Result<Value> {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "numdlb" | "nusrcmdlb" => parse::<ssbh_data::modl_data::ModlData>(bytes),
        "numatb" => parse::<ssbh_data::matl_data::MatlData>(bytes),
        "nusktb" => parse::<SkelData>(bytes),
        "nuhlpb" => parse::<ssbh_data::hlpb_data::HlpbData>(bytes),
        "nuanmb" => parse::<ssbh_data::anim_data::AnimData>(bytes),
        "numshexb" => parse::<ssbh_data::meshex_data::MeshExData>(bytes),
        "adjb" => parse::<ssbh_data::adj_data::AdjData>(bytes),
        _ => Err(Error::new("unsupported ssbh file")),
    }
}

fn write<T: SsbhData + serde::de::DeserializeOwned>(data: Value) -> Result<Vec<u8>> {
    let data: T = serde_json::from_value(data).map_err(|e| Error::new(format!("invalid ssbh data: {e}")))?;
    let mut out = Cursor::new(Vec::new());
    data.write(&mut out).map_err(|e| Error::new(format!("invalid ssbh data: {e}")))?;
    Ok(out.into_inner())
}

pub fn write_ssbh(data: Value, path: &str) -> Result<Vec<u8>> {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "numdlb" | "nusrcmdlb" => write::<ssbh_data::modl_data::ModlData>(data),
        "numatb" => write::<ssbh_data::matl_data::MatlData>(data),
        "nusktb" => write::<SkelData>(data),
        "nuhlpb" => write::<ssbh_data::hlpb_data::HlpbData>(data),
        "nuanmb" => write::<ssbh_data::anim_data::AnimData>(data),
        "numshexb" => write::<ssbh_data::meshex_data::MeshExData>(data),
        "adjb" => write::<ssbh_data::adj_data::AdjData>(data),
        _ => Err(Error::new("unsupported ssbh file")),
    }
}

fn floats(values: impl Iterator<Item = f32>) -> String {
    base64::engine::general_purpose::STANDARD.encode(values.flat_map(f32::to_le_bytes).collect::<Vec<_>>())
}

fn vec3(data: &VectorData) -> Vec<[f32; 3]> {
    match data {
        VectorData::Vector2(v) => v.iter().map(|p| [p[0], p[1], 0.0]).collect(),
        VectorData::Vector3(v) => v.clone(),
        VectorData::Vector4(v) => v.iter().map(|p| [p[0], p[1], p[2]]).collect(),
    }
}

fn skin(object: &ssbh_data::mesh_data::MeshObjectData, skel: &SkelData, count: usize) -> (String, String) {
    let index = |name: &str| skel.bones.iter().position(|b| b.name == name);
    let mut influences = vec![Vec::<(usize, f32)>::new(); count];
    if object.bone_influences.is_empty() {
        if let Some(parent) = index(&object.parent_bone_name) {
            influences.iter_mut().for_each(|v| v.push((parent, 1.0)));
        }
    }
    for influence in &object.bone_influences {
        let Some(bone) = index(&influence.bone_name) else { continue };
        for w in &influence.vertex_weights {
            if let Some(v) = influences.get_mut(w.vertex_index as usize) {
                v.push((bone, w.vertex_weight));
            }
        }
    }
    let mut bones = Vec::with_capacity(count * 4);
    let mut weights = Vec::with_capacity(count * 4);
    for mut v in influences {
        v.sort_by(|a, b| b.1.total_cmp(&a.1));
        v.truncate(4);
        let total: f32 = v.iter().map(|(_, w)| w).sum();
        for k in 0..4 {
            let (bone, weight) = v.get(k).copied().unwrap_or((0, 0.0));
            bones.push(bone as f32);
            weights.push(if total > 0.0 { weight / total } else { 0.0 });
        }
    }
    (floats(bones.into_iter()), floats(weights.into_iter()))
}

fn apply(m: &[[f32; 4]; 4], p: [f32; 3], w: f32) -> [f32; 3] {
    std::array::from_fn(|i| m[0][i] * p[0] + m[1][i] * p[1] + m[2][i] * p[2] + m[3][i] * w)
}

pub fn mesh_buffers(bytes: &[u8], skeleton: Option<&[u8]>) -> Result<Vec<MeshBuffers>> {
    let mesh = MeshData::read(&mut Cursor::new(bytes)).map_err(|e| Error::new(format!("invalid ssbh file: {e}")))?;
    let skel = skeleton.map(|b| SkelData::read(&mut Cursor::new(b))).transpose().map_err(|e| Error::new(format!("invalid ssbh file: {e}")))?;
    Ok(mesh
        .objects
        .iter()
        .map(|object| {
            let parent = skel
                .as_ref()
                .filter(|_| object.bone_influences.is_empty())
                .and_then(|s| s.bones.iter().find(|b| b.name == object.parent_bone_name).and_then(|b| s.calculate_world_transform(b).ok()));
            let transform = |p: [f32; 3], w: f32| parent.as_ref().map_or(p, |m| apply(m, p, w));
            let positions = object.positions.first().map(|a| vec3(&a.data)).unwrap_or_default();
            let mut normals = object.normals.first().map(|a| vec3(&a.data)).unwrap_or_default();
            normals.resize(positions.len(), [0.0, 1.0, 0.0]);
            let uvs = object.texture_coordinates.iter().find(|a| a.name == "map1").or(object.texture_coordinates.first()).map(|a| match &a.data {
                VectorData::Vector2(v) => floats(v.iter().flat_map(|u| [u[0], u[1]])),
                VectorData::Vector3(v) => floats(v.iter().flat_map(|u| [u[0], u[1]])),
                VectorData::Vector4(v) => floats(v.iter().flat_map(|u| [u[0], u[1]])),
            });
            let (bones, weights) = skel.as_ref().map(|s| skin(object, s, positions.len())).unzip();
            MeshBuffers {
                bones,
                weights,
                name: object.name.clone(),
                subindex: object.subindex,
                positions: floats(positions.iter().flat_map(|&p| transform(p, 1.0))),
                normals: floats(normals.iter().flat_map(|&n| transform(n, 0.0))),
                uvs,
                indices: base64::engine::general_purpose::STANDARD.encode(object.vertex_indices.iter().flat_map(|i| i.to_le_bytes()).collect::<Vec<_>>()),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ssbh_data::mesh_data::{AttributeData, MeshObjectData};
    use ssbh_data::modl_data::{ModlData, ModlEntryData};
    use ssbh_data::skel_data::{BillboardType, BoneData};

    fn bytes<T: SsbhData>(data: &T) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        data.write(&mut out).unwrap();
        out.into_inner()
    }

    fn decode(text: &str) -> Vec<f32> {
        base64::engine::general_purpose::STANDARD.decode(text).unwrap().chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
    }

    #[test]
    fn reads_model_entries_as_json() {
        let modl = ModlData {
            major_version: 1,
            minor_version: 0,
            model_name: "model".into(),
            skeleton_file_name: "model.nusktb".into(),
            material_file_names: vec!["model.numatb".into()],
            animation_file_name: None,
            mesh_file_name: "model.numshb".into(),
            entries: vec![ModlEntryData { mesh_object_name: "body".into(), mesh_object_subindex: 0, material_label: "skin".into() }],
        };
        let value = read_ssbh(&bytes(&modl), "c00/model.numdlb").unwrap();
        assert_eq!(value["entries"][0]["material_label"], "skin");
        let matl = ssbh_data::matl_data::MatlData {
            major_version: 1,
            minor_version: 6,
            entries: vec![ssbh_data::matl_data::MatlEntryData {
                material_label: "skin".into(),
                shader_label: "SFX_PBS_0100000008008269_opaque".into(),
                blend_states: vec![],
                floats: vec![],
                booleans: vec![],
                vectors: vec![],
                rasterizer_states: vec![],
                samplers: vec![],
                textures: vec![ssbh_data::matl_data::TextureParam::new(ssbh_data::matl_data::ParamId::Texture0, "def_col".into())],
                uv_transforms: vec![],
            }],
        };
        assert_eq!(read_ssbh(&bytes(&matl), "model.numatb").unwrap()["entries"][0]["textures"][0], serde_json::json!({ "param_id": "Texture0", "data": "def_col" }));
        let mut edited = read_ssbh(&bytes(&matl), "model.numatb").unwrap();
        edited["entries"][0]["textures"][0]["data"] = "new_col".into();
        let written = write_ssbh(edited, "model.numatb").unwrap();
        assert_eq!(read_ssbh(&written, "model.numatb").unwrap()["entries"][0]["textures"][0]["data"], "new_col");
        assert!(write_ssbh(serde_json::json!({ "entries": 3 }), "model.numatb").unwrap_err().to_string().starts_with("invalid ssbh data"));
        assert!(write_ssbh(serde_json::json!({}), "model.txt").is_err());
        use ssbh_data::anim_data::{AnimData, GroupData, NodeData, TrackData, TrackValues, TransformFlags};
        let anim = AnimData {
            major_version: 2,
            minor_version: 0,
            final_frame_index: 0.0,
            groups: vec![GroupData {
                group_type: ssbh_data::anim_data::GroupType::Visibility,
                nodes: vec![NodeData {
                    name: "EyeN_VIS_O_OBJ".into(),
                    tracks: vec![TrackData { name: "Visibility".into(), compensate_scale: false, transform_flags: TransformFlags::default(), values: TrackValues::Boolean(vec![true]) }],
                }],
            }],
        };
        let value = read_ssbh(&bytes(&anim), "a.nuanmb").unwrap();
        assert_eq!(value["groups"][0]["group_type"], "Visibility");
        assert_eq!(value["groups"][0]["nodes"][0]["tracks"][0]["values"], serde_json::json!({ "Boolean": [true] }));
        assert_eq!(value["groups"][0]["nodes"][0]["tracks"][0]["transform_flags"]["override_translation"], false);
        assert!(read_ssbh(b"nope", "model.numdlb").is_err());
        assert!(read_ssbh(&bytes(&modl), "model.txt").is_err());
    }

    #[test]
    fn keeps_the_four_strongest_weights() {
        use ssbh_data::mesh_data::{BoneInfluence, VertexWeight};
        let names = ["A", "B", "C", "D", "E"];
        let object = MeshObjectData {
            name: "body".into(),
            vertex_indices: vec![0, 0, 0],
            positions: vec![AttributeData { name: "Position0".into(), data: VectorData::Vector3(vec![[0.0; 3]]) }],
            bone_influences: names
                .iter()
                .zip([0.1, 0.4, 0.2, 0.2, 0.1])
                .map(|(n, w)| BoneInfluence { bone_name: (*n).into(), vertex_weights: vec![VertexWeight { vertex_index: 0, vertex_weight: w }] })
                .chain([BoneInfluence { bone_name: "missing".into(), vertex_weights: vec![VertexWeight { vertex_index: 0, vertex_weight: 0.9 }] }])
                .collect(),
            ..Default::default()
        };
        let identity = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
        let skel = SkelData {
            major_version: 1,
            minor_version: 0,
            bones: names.iter().map(|n| BoneData { name: (*n).into(), transform: identity, parent_index: None, billboard_type: BillboardType::Disabled }).collect(),
        };
        let mesh = MeshData { major_version: 1, minor_version: 10, objects: vec![object] };
        let out = mesh_buffers(&bytes(&mesh), Some(&bytes(&skel))).unwrap();
        assert_eq!(decode(out[0].bones.as_deref().unwrap()), [1.0, 2.0, 3.0, 0.0]);
        let weights = decode(out[0].weights.as_deref().unwrap());
        assert!((weights.iter().sum::<f32>() - 1.0).abs() < 1e-6);
        assert!((weights[0] - 0.4 / 0.9).abs() < 1e-6);
    }

    #[test]
    fn moves_unskinned_meshes_to_their_parent_bone() {
        let object = MeshObjectData {
            name: "hat".into(),
            parent_bone_name: "Head".into(),
            vertex_indices: vec![0, 1, 2],
            positions: vec![AttributeData { name: "Position0".into(), data: VectorData::Vector3(vec![[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]) }],
            normals: vec![AttributeData { name: "Normal0".into(), data: VectorData::Vector4(vec![[0.0, 0.0, 1.0, 0.0]; 3]) }],
            texture_coordinates: vec![AttributeData { name: "map1".into(), data: VectorData::Vector2(vec![[0.5, 0.25]; 3]) }],
            ..Default::default()
        };
        let mesh = MeshData { major_version: 1, minor_version: 10, objects: vec![object] };
        let mut translate = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
        translate[3] = [0.0, 10.0, 0.0, 1.0];
        let skel = SkelData { major_version: 1, minor_version: 0, bones: vec![BoneData { name: "Head".into(), transform: translate, parent_index: None, billboard_type: BillboardType::Disabled }] };
        let out = mesh_buffers(&bytes(&mesh), Some(&bytes(&skel))).unwrap();
        assert_eq!(decode(&out[0].positions)[..6], [0.0, 10.0, 0.0, 1.0, 10.0, 0.0]);
        assert_eq!(decode(&out[0].normals)[..3], [0.0, 0.0, 1.0]);
        assert_eq!(decode(out[0].uvs.as_deref().unwrap())[..2], [0.5, 0.25]);
        assert_eq!(decode(out[0].bones.as_deref().unwrap())[..4], [0.0; 4]);
        assert_eq!(decode(out[0].weights.as_deref().unwrap())[..4], [1.0, 0.0, 0.0, 0.0]);
        let unskinned = mesh_buffers(&bytes(&mesh), None).unwrap();
        assert_eq!(decode(&unskinned[0].positions)[4], 0.0);
        assert!(unskinned[0].bones.is_none());
    }
}

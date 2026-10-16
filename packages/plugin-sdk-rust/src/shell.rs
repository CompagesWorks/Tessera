use crate::bridge::{run, text};
use crate::error::Result;
use crate::files::Scope;

pub async fn open_url(url: &str) -> Result<()> {
    run(&["shell", "openUrl"], &[text(url)]).await
}

pub async fn reveal(path: &str, scope: Scope) -> Result<()> {
    let scope = match scope {
        Scope::Project => "project",
        Scope::Private => "private",
        Scope::External => "external",
    };
    run(&["shell", "reveal"], &[text(path), text(scope)]).await
}

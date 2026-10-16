mod dom;
mod scan;

use std::cell::Cell;
use std::rc::Rc;

use serde::{Deserialize, Serialize};
use tessera_plugin::ui::Toast;
use tessera_plugin::wasm_bindgen::prelude::wasm_bindgen;
use tessera_plugin::{project, spawn_local, ui, widget};

#[derive(Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    count: i64,
}

#[wasm_bindgen(start)]
pub fn start() {
    spawn_local(async {
        if let Err(error) = run().await {
            dom::set_text("project", &format!("Erreur : {error}"));
        }
    });
}

async fn run() -> tessera_plugin::Result<()> {
    tessera_plugin::ready().await?;
    let state: State = widget::get_state().await.unwrap_or_default();
    let count = Rc::new(Cell::new(state.count));
    dom::set_text("value", &count.get().to_string());
    dom::set_text("project", &project::info().await?.name);

    for (id, delta) in [("plus", 1), ("minus", -1)] {
        let count = count.clone();
        dom::on_click(id, move || {
            count.set(count.get() + delta);
            dom::set_text("value", &count.get().to_string());
            let state = State { count: count.get() };
            spawn_local(async move {
                let _ = widget::set_state(&state).await;
            });
        });
    }

    dom::on_click("scan", || {
        spawn_local(async {
            match scan::summarize("sources").await {
                Ok(summary) => {
                    dom::set_list("report", &summary.lines());
                    let _ = ui::toast(Toast::Success, &format!("{} fichier(s) analysé(s) en Rust", summary.files)).await;
                }
                Err(error) => {
                    let _ = ui::toast(Toast::Error, error.message()).await;
                }
            }
        });
    });
    Ok(())
}

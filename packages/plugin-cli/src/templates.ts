export interface TemplateInput {
  id: string;
  name: string;
  author: string;
  crate: string;
  sdk: string;
}

export function manifestFile(input: TemplateInput, rust: boolean) {
  return `${JSON.stringify(
    {
      id: input.id,
      name: input.name,
      version: '0.1.0',
      author: input.author,
      description: rust ? 'A Tessera widget written in Rust.' : 'A Tessera widget.',
      icon: rust ? 'cpu' : 'puzzle',
      engines: { tessera: '^0.1.0' },
      permissions: ['fs.project.read'],
      contributes: {
        widgets: [{ id: 'main', title: input.name, description: '', icon: rust ? 'cpu' : 'puzzle', category: 'tools', entry: 'widget.html' }],
      },
    },
    null,
    2,
  )}\n`;
}

export function widgetHtml(rust: boolean) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="/__tessera/sdk.js"></script>
    <link rel="stylesheet" href="widget.css" />
  </head>
  <body>
    <main class="widget">
      <p id="project" class="project"></p>
      <h1 id="value" class="value">0</h1>
      <button class="atrium-btn atrium-btn-primary" id="plus"><i class="bi bi-plus-lg"></i></button>
      <button class="atrium-btn atrium-btn-secondary" id="files"><i class="bi bi-folder2-open"></i> sources/</button>
      <ul id="list" class="list"></ul>
    </main>
    <script ${rust ? 'type="module" ' : ''}src="widget.js"></script>
  </body>
</html>
`;
}

export const widgetCss = `html,
body {
  margin: 0;
  height: 100%;
  background: transparent;
  color: var(--atrium-text-primary);
  font-family: var(--atrium-font-family);
}

.widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px;
}

.project {
  margin: 0;
  color: var(--atrium-text-muted);
  font-size: 13px;
}

.value {
  margin: 0;
  font-size: 48px;
  color: var(--atrium-accent-color);
}

.list {
  width: 100%;
  max-width: 320px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}

.list li {
  padding: 4px 8px;
  border-bottom: 1px solid var(--atrium-border-color);
}
`;

export const widgetJs = `(async () => {
  await tessera.ready;
  const state = await tessera.widget.getState();
  let count = typeof state.count === 'number' ? state.count : 0;
  const value = document.getElementById('value');
  value.textContent = String(count);
  document.getElementById('project').textContent = (await tessera.project.info()).name;

  document.getElementById('plus').addEventListener('click', () => {
    count += 1;
    value.textContent = String(count);
    tessera.widget.setState({ count });
  });

  document.getElementById('files').addEventListener('click', async () => {
    try {
      const entries = await tessera.files.list('sources');
      document.getElementById('list').replaceChildren(
        ...entries.map((entry) => Object.assign(document.createElement('li'), { textContent: entry.name })),
      );
    } catch (error) {
      tessera.ui.toast('error', error.message);
    }
  });
})();
`;

export function rustLoader(crate: string) {
  return `import init from './pkg/${crate.replace(/-/g, '_')}.js';

init().catch((error) => console.error(error));
`;
}

export function cargoToml(input: TemplateInput) {
  return `[package]
name = "${input.crate}"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
tessera-plugin = ${input.sdk}
wasm-bindgen = "=0.2.129"
serde = { version = "1", features = ["derive"] }
web-sys = { version = "0.3", features = ["Document", "Element", "HtmlElement", "Window", "Event", "EventTarget"] }

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
`;
}

export const rustLib = `use serde::{Deserialize, Serialize};
use tessera_plugin::wasm_bindgen::closure::Closure;
use tessera_plugin::wasm_bindgen::prelude::wasm_bindgen;
use tessera_plugin::wasm_bindgen::JsCast;
use tessera_plugin::{files, project, spawn_local, ui, widget};

#[derive(Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    count: i64,
}

fn element(id: &str) -> Option<web_sys::Element> {
    web_sys::window()?.document()?.get_element_by_id(id)
}

fn set_text(id: &str, text: &str) {
    if let Some(element) = element(id) {
        element.set_text_content(Some(text));
    }
}

fn on_click(id: &str, handler: impl FnMut() + 'static) {
    let Some(target) = element(id) else { return };
    let closure = Closure::<dyn FnMut()>::new(handler);
    let _ = target.add_event_listener_with_callback("click", closure.as_ref().unchecked_ref());
    closure.forget();
}

#[wasm_bindgen(start)]
pub fn start() {
    spawn_local(async {
        if let Err(error) = run().await {
            let _ = ui::toast(ui::Toast::Error, error.message()).await;
        }
    });
}

async fn run() -> tessera_plugin::Result<()> {
    tessera_plugin::ready().await?;
    let state: State = widget::get_state().await.unwrap_or_default();
    let count = std::rc::Rc::new(std::cell::Cell::new(state.count));
    set_text("value", &count.get().to_string());
    set_text("project", &project::info().await?.name);

    on_click("plus", move || {
        count.set(count.get() + 1);
        set_text("value", &count.get().to_string());
        let state = State { count: count.get() };
        spawn_local(async move {
            let _ = widget::set_state(&state).await;
        });
    });

    on_click("files", || {
        spawn_local(async {
            match files::project().list("sources").await {
                Ok(entries) => {
                    let names: Vec<String> = entries.into_iter().map(|e| e.name).collect();
                    set_text("list", &names.join(", "));
                }
                Err(error) => {
                    let _ = ui::toast(ui::Toast::Error, error.message()).await;
                }
            }
        });
    });
    Ok(())
}
`;

export const gitignore = `target/
*.tessera-plugin
`;

export const projectConfig = `${JSON.stringify({ plugin: 'plugin', rust: 'rust' }, null, 2)}\n`;

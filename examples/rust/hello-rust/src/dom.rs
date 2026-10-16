use tessera_plugin::wasm_bindgen::closure::Closure;
use tessera_plugin::wasm_bindgen::JsCast;
use web_sys::{Document, Element};

fn document() -> Option<Document> {
    web_sys::window()?.document()
}

fn element(id: &str) -> Option<Element> {
    document()?.get_element_by_id(id)
}

pub fn set_text(id: &str, text: &str) {
    if let Some(element) = element(id) {
        element.set_text_content(Some(text));
    }
}

pub fn set_list(id: &str, lines: &[String]) {
    let (Some(list), Some(document)) = (element(id), document()) else { return };
    list.set_text_content(None);
    for line in lines {
        if let Ok(item) = document.create_element("li") {
            item.set_text_content(Some(line));
            let _ = list.append_child(&item);
        }
    }
}

pub fn on_click(id: &str, mut handler: impl FnMut() + 'static) {
    let Some(target) = element(id) else { return };
    let closure = Closure::<dyn FnMut()>::new(move || handler());
    let _ = target.add_event_listener_with_callback("click", closure.as_ref().unchecked_ref());
    closure.forget();
}

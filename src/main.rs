#[cfg(any(target_arch = "wasm32", test))]
mod protocol;
mod workflow_app;

#[cfg(target_arch = "wasm32")]
mod plugin_api;

#[cfg(target_arch = "wasm32")]
mod transport_api;

use workflow_app::LightFlowApp;

#[cfg(not(target_arch = "wasm32"))]
fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        renderer: eframe::Renderer::Glow,
        viewport: egui::ViewportBuilder::default()
            .with_title("LightFlowUI")
            .with_inner_size([1440.0, 920.0]),
        ..Default::default()
    };

    eframe::run_native(
        "LightFlowUI",
        options,
        Box::new(|cc| Ok(Box::new(LightFlowApp::new(cc)))),
    )
}

#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn start() {
    lightflow_step("wasm_start_called");
    wasm_bindgen_futures::spawn_local(async {
        if let Err(error) = start_async().await {
            report_startup_error(&format!("startup_error: {error:?}"));
            lightflow_step("start_async_error");
            web_sys::console::error_1(&error);
        }
    });
}

#[cfg(target_arch = "wasm32")]
async fn start_async() -> Result<(), wasm_bindgen::JsValue> {
    lightflow_step("start entered");
    install_panic_reporter();
    lightflow_step("panic reporter installed");
    let _ = eframe::WebLogger::init(log::LevelFilter::Debug);
    lightflow_step("web logger initialized");
    use wasm_bindgen::JsCast;

    let window =
        web_sys::window().ok_or_else(|| wasm_bindgen::JsValue::from_str("missing window"))?;
    lightflow_step("window acquired");
    let document = window
        .document()
        .ok_or_else(|| wasm_bindgen::JsValue::from_str("missing document"))?;
    lightflow_step("document acquired");
    let canvas = document
        .get_element_by_id("lightflow-canvas")
        .ok_or_else(|| wasm_bindgen::JsValue::from_str("missing #lightflow-canvas"))?
        .dyn_into::<web_sys::HtmlCanvasElement>()?;
    lightflow_step("canvas acquired");

    lightflow_step("web runner starting");
    match eframe::WebRunner::new()
        .start(
            canvas,
            eframe::WebOptions::default(),
            Box::new(|cc| {
                lightflow_step("app creator entered");
                Ok(Box::new(LightFlowApp::new(cc)))
            }),
        )
        .await
    {
        Ok(()) => {
            lightflow_step("web runner started");
            Ok(())
        }
        Err(error) => {
            report_startup_error(&format!("eframe WebRunner failed: {error:?}"));
            Err(error)
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn lightflow_step(step: &str) {
    use wasm_bindgen::JsCast;

    let global = js_sys::global();
    if let Ok(reporter) = js_sys::Reflect::get(
        &global,
        &wasm_bindgen::JsValue::from_str("__lightflow_step"),
    ) {
        if let Some(function) = reporter.dyn_ref::<js_sys::Function>() {
            let _ = function.call1(
                &wasm_bindgen::JsValue::NULL,
                &wasm_bindgen::JsValue::from_str(step),
            );
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn install_panic_reporter() {
    std::panic::set_hook(Box::new(|info| {
        console_error_panic_hook::hook(info);
        report_startup_error(&format!("Rust panic:\n{info}"));
    }));
}

#[cfg(target_arch = "wasm32")]
fn report_startup_error(message: &str) {
    use wasm_bindgen::JsCast;

    let global = js_sys::global();
    if let Ok(reporter) = js_sys::Reflect::get(
        &global,
        &wasm_bindgen::JsValue::from_str("__lightflow_report_rust_error"),
    ) {
        if let Some(function) = reporter.dyn_ref::<js_sys::Function>() {
            let _ = function.call1(
                &wasm_bindgen::JsValue::NULL,
                &wasm_bindgen::JsValue::from_str(message),
            );
            return;
        }
    }

    let Some(window) = web_sys::window() else {
        return;
    };
    let Some(document) = window.document() else {
        return;
    };
    let Some(error_box) = document.get_element_by_id("lightflow-error") else {
        return;
    };
    error_box.set_text_content(Some(message));
    if let Ok(element) = error_box.dyn_into::<web_sys::HtmlElement>() {
        let _ = element.style().set_property("display", "block");
    }
}

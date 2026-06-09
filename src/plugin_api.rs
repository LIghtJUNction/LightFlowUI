use std::cell::RefCell;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[derive(Clone, Debug)]
struct PluginNodeRegistration {
    id: String,
    display_name: String,
    element_name: String,
    inputs: Vec<String>,
    outputs: Vec<String>,
}

thread_local! {
    static PLUGIN_NODES: RefCell<Vec<PluginNodeRegistration>> = const { RefCell::new(Vec::new()) };
    static PLUGIN_OVERLAYS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

pub(crate) fn plugin_node_summaries() -> Vec<String> {
    PLUGIN_NODES.with(|nodes| {
        nodes
            .borrow()
            .iter()
            .map(|node| format!("{} -> {}", node.id, node.element_name))
            .collect()
    })
}

pub(crate) fn plugin_overlay_summaries() -> Vec<String> {
    PLUGIN_OVERLAYS.with(|overlays| overlays.borrow().clone())
}

pub(crate) fn first_plugin_element_name() -> Option<String> {
    PLUGIN_NODES.with(|nodes| {
        nodes
            .borrow()
            .first()
            .map(|registration| registration.element_name.clone())
    })
}

pub(crate) fn sync_lightflow_node_component(
    node_id: &str,
    element_name: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    props: JsValue,
) -> Result<(), JsValue> {
    mount_lightflow_node_component(
        node_id.to_owned(),
        element_name.to_owned(),
        x,
        y,
        width,
        height,
        props,
    )
}

pub(crate) fn retain_lightflow_node_components(live_node_ids: &[String]) {
    let mounted = PLUGIN_OVERLAYS.with(|overlays| overlays.borrow().clone());
    for node_id in mounted {
        if live_node_ids.iter().all(|live| live != &node_id) {
            let _ = unmount_lightflow_node_component(node_id);
        }
    }
}

#[wasm_bindgen(js_name = registerLightFlowNode)]
pub fn register_lightflow_node(registration: JsValue) -> Result<(), JsValue> {
    let registration = parse_registration(registration)?;
    validate_registration(&registration)?;

    PLUGIN_NODES.with(|nodes| {
        let mut nodes = nodes.borrow_mut();
        if let Some(existing) = nodes.iter_mut().find(|node| node.id == registration.id) {
            *existing = registration;
        } else {
            nodes.push(registration);
        }
    });

    Ok(())
}

#[wasm_bindgen(js_name = lightFlowNodeRegistrations)]
pub fn lightflow_node_registrations() -> js_sys::Array {
    PLUGIN_NODES.with(|nodes| {
        nodes
            .borrow()
            .iter()
            .map(registration_to_js)
            .collect::<js_sys::Array>()
    })
}

#[wasm_bindgen(js_name = mountLightFlowNodeComponent)]
pub fn mount_lightflow_node_component(
    node_id: String,
    element_name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    props: JsValue,
) -> Result<(), JsValue> {
    validate_element_name(&element_name)?;

    let document = document()?;
    let host = overlay_host(&document)?;
    let element_id = overlay_element_id(&node_id);
    let element = if let Some(existing) = document.get_element_by_id(&element_id) {
        existing
    } else {
        let element = document.create_element(&element_name)?;
        element.set_attribute("id", &element_id)?;
        element.set_attribute("data-lightflow-node-id", &node_id)?;
        element.set_attribute("data-lightflow-component", &element_name)?;
        host.append_child(&element)?;
        remember_overlay(&node_id);
        element
    };

    position_overlay_element(&element, x, y, width, height)?;
    set_component_props(&element, props)?;
    Ok(())
}

#[wasm_bindgen(js_name = updateLightFlowNodeComponent)]
pub fn update_lightflow_node_component(
    node_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    props: JsValue,
) -> Result<(), JsValue> {
    let document = document()?;
    let element_id = overlay_element_id(&node_id);
    let element = document
        .get_element_by_id(&element_id)
        .ok_or_else(|| JsValue::from_str("LightFlow node component is not mounted"))?;
    position_overlay_element(&element, x, y, width, height)?;
    set_component_props(&element, props)?;
    Ok(())
}

#[wasm_bindgen(js_name = unmountLightFlowNodeComponent)]
pub fn unmount_lightflow_node_component(node_id: String) -> Result<(), JsValue> {
    let document = document()?;
    let element_id = overlay_element_id(&node_id);
    if let Some(element) = document.get_element_by_id(&element_id) {
        element.remove();
    }
    PLUGIN_OVERLAYS.with(|overlays| overlays.borrow_mut().retain(|id| id != &node_id));
    Ok(())
}

#[wasm_bindgen(js_name = lightFlowMountedComponents)]
pub fn lightflow_mounted_components() -> js_sys::Array {
    PLUGIN_OVERLAYS.with(|overlays| {
        overlays
            .borrow()
            .iter()
            .map(|id| JsValue::from_str(id))
            .collect::<js_sys::Array>()
    })
}

fn parse_registration(value: JsValue) -> Result<PluginNodeRegistration, JsValue> {
    Ok(PluginNodeRegistration {
        id: required_string(&value, "id")?,
        display_name: required_string(&value, "displayName")?,
        element_name: required_string(&value, "elementName")?,
        inputs: optional_string_array(&value, "inputs")?,
        outputs: optional_string_array(&value, "outputs")?,
    })
}

fn validate_registration(registration: &PluginNodeRegistration) -> Result<(), JsValue> {
    if registration.id.trim().is_empty() {
        return Err(JsValue::from_str("LightFlow node registration id is empty"));
    }
    if registration.display_name.trim().is_empty() {
        return Err(JsValue::from_str(
            "LightFlow node registration displayName is empty",
        ));
    }
    validate_element_name(&registration.element_name)
}

fn required_string(value: &JsValue, key: &str) -> Result<String, JsValue> {
    js_sys::Reflect::get(value, &JsValue::from_str(key))?
        .as_string()
        .ok_or_else(|| JsValue::from_str(&format!("missing string field `{key}`")))
}

fn optional_string_array(value: &JsValue, key: &str) -> Result<Vec<String>, JsValue> {
    let field = js_sys::Reflect::get(value, &JsValue::from_str(key))?;
    if field.is_undefined() || field.is_null() {
        return Ok(Vec::new());
    }

    if !js_sys::Array::is_array(&field) {
        return Err(JsValue::from_str(&format!(
            "field `{key}` must be an array"
        )));
    }

    let array = js_sys::Array::from(&field);
    let mut values = Vec::with_capacity(array.length() as usize);
    for item in array.iter() {
        values.push(
            item.as_string()
                .ok_or_else(|| JsValue::from_str(&format!("field `{key}` contains non-string")))?,
        );
    }
    Ok(values)
}

fn registration_to_js(registration: &PluginNodeRegistration) -> JsValue {
    let object = js_sys::Object::new();
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("id"),
        &JsValue::from_str(&registration.id),
    );
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("displayName"),
        &JsValue::from_str(&registration.display_name),
    );
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("elementName"),
        &JsValue::from_str(&registration.element_name),
    );
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("inputs"),
        &strings_to_array(&registration.inputs),
    );
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("outputs"),
        &strings_to_array(&registration.outputs),
    );
    object.into()
}

fn strings_to_array(values: &[String]) -> JsValue {
    values
        .iter()
        .map(|value| JsValue::from_str(value))
        .collect::<js_sys::Array>()
        .into()
}

fn validate_element_name(element_name: &str) -> Result<(), JsValue> {
    if !element_name.contains('-') {
        return Err(JsValue::from_str(
            "Web Component elementName must contain a hyphen",
        ));
    }
    Ok(())
}

fn document() -> Result<web_sys::Document, JsValue> {
    web_sys::window()
        .ok_or_else(|| JsValue::from_str("missing window"))?
        .document()
        .ok_or_else(|| JsValue::from_str("missing document"))
}

fn overlay_host(document: &web_sys::Document) -> Result<web_sys::Element, JsValue> {
    if let Some(host) = document.get_element_by_id("lightflow-plugin-overlay") {
        return Ok(host);
    }

    let host = document.create_element("div")?;
    host.set_attribute("id", "lightflow-plugin-overlay")?;
    if let Some(body) = document.body() {
        body.append_child(&host)?;
        Ok(host)
    } else {
        Err(JsValue::from_str("missing document body"))
    }
}

fn position_overlay_element(
    element: &web_sys::Element,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), JsValue> {
    let element = element
        .dyn_ref::<web_sys::HtmlElement>()
        .ok_or_else(|| JsValue::from_str("overlay element is not an HtmlElement"))?;
    let style = element.style();
    style.set_property("position", "absolute")?;
    style.set_property("left", "0")?;
    style.set_property("top", "0")?;
    style.set_property("transform", &format!("translate({x}px, {y}px)"))?;
    style.set_property("width", &format!("{width}px"))?;
    style.set_property("height", &format!("{height}px"))?;
    style.set_property("contain", "layout paint size")?;
    Ok(())
}

fn set_component_props(element: &web_sys::Element, props: JsValue) -> Result<(), JsValue> {
    js_sys::Reflect::set(element, &JsValue::from_str("lightflowProps"), &props)?;
    Ok(())
}

fn remember_overlay(node_id: &str) {
    PLUGIN_OVERLAYS.with(|overlays| {
        let mut overlays = overlays.borrow_mut();
        if overlays.iter().all(|id| id != node_id) {
            overlays.push(node_id.to_owned());
        }
    });
}

fn overlay_element_id(node_id: &str) -> String {
    let mut id = String::from("lightflow-component-");
    for byte in node_id.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' => id.push(byte as char),
            _ => id.push('_'),
        }
    }
    id
}

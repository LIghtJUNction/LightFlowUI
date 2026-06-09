use std::cell::RefCell;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};

use crate::protocol::{
    self, MessageKind, NodeKind, PortRefInput, PreviewFrameInput, WorkflowNodePatchInput,
    WorkflowPatchInput, WorkflowPatchOpInput,
};

#[derive(Clone, Debug)]
struct OwnedPatchNode {
    id: String,
    kind: NodeKind,
    title: String,
    component: Option<String>,
    x: f32,
    y: f32,
}

#[derive(Clone, Debug)]
struct OwnedPortRef {
    node: String,
    port: String,
}

#[derive(Clone, Debug)]
enum OwnedPatchOp {
    AddNode {
        node: OwnedPatchNode,
    },
    UpdateNode {
        node: OwnedPatchNode,
    },
    MoveNode {
        node_id: String,
        x: f32,
        y: f32,
    },
    DeleteNode {
        node_id: String,
    },
    Connect {
        from: OwnedPortRef,
        to: OwnedPortRef,
    },
    Disconnect {
        from: OwnedPortRef,
        to: OwnedPortRef,
    },
}

#[derive(Clone, Debug)]
struct TransportState {
    url: Option<String>,
    status: String,
    last_error: Option<String>,
    datagrams: Option<JsValue>,
}

impl Default for TransportState {
    fn default() -> Self {
        Self {
            url: None,
            status: "disconnected".to_owned(),
            last_error: None,
            datagrams: None,
        }
    }
}

thread_local! {
    static TRANSPORT: RefCell<TransportState> = RefCell::new(TransportState::default());
}

pub(crate) fn transport_summary() -> String {
    TRANSPORT.with(|transport| {
        let transport = transport.borrow();
        match (&transport.url, &transport.last_error) {
            (Some(url), Some(error)) => format!("{}: {} ({})", transport.status, url, error),
            (Some(url), None) => format!("{}: {}", transport.status, url),
            (None, Some(error)) => format!("{} ({})", transport.status, error),
            (None, None) => transport.status.clone(),
        }
    })
}

#[wasm_bindgen(js_name = connectLightFlowTransport)]
pub fn connect_lightflow_transport(url: String) -> Result<(), JsValue> {
    if !web_transport_supported() {
        set_transport_error(
            Some(url),
            "WebTransport is not available in this browser".to_owned(),
        );
        return Err(JsValue::from_str(
            "WebTransport is not available in this browser",
        ));
    }

    set_transport_connecting(url.clone());
    spawn_local(async move {
        let result = connect_transport(url.clone()).await;
        match result {
            Ok(datagrams) => set_transport_ready(url, datagrams),
            Err(error) => set_transport_error(Some(url), error),
        }
    });

    Ok(())
}

#[wasm_bindgen(js_name = lightFlowTransportStatus)]
pub fn lightflow_transport_status() -> String {
    transport_summary()
}

#[wasm_bindgen(js_name = sendLightFlowTransportBytes)]
pub fn send_lightflow_transport_bytes(kind: u16, bytes: js_sys::Uint8Array) -> Result<(), JsValue> {
    send_frame(kind, bytes)
}

#[wasm_bindgen(js_name = sendLightFlowRunEvent)]
pub fn send_lightflow_run_event(
    request_id: u32,
    run_id: String,
    sequence: u32,
    event_type: String,
    payload: js_sys::Uint8Array,
) -> Result<(), JsValue> {
    let mut payload_bytes = vec![0; payload.length() as usize];
    payload.copy_to(&mut payload_bytes);
    let envelope = protocol::build_run_event_envelope(
        request_id as u64,
        &run_id,
        sequence as u64,
        &event_type,
        &payload_bytes,
    );
    send_frame(
        MessageKind::RunEvent as u16,
        js_sys::Uint8Array::from(envelope.as_slice()),
    )
}

#[wasm_bindgen(js_name = sendLightFlowPreviewFrame)]
pub fn send_lightflow_preview_frame(
    request_id: u32,
    run_id: String,
    node_id: String,
    sequence: u32,
    timestamp_ms: f64,
    mime: String,
    width: u32,
    height: u32,
    bytes: js_sys::Uint8Array,
) -> Result<(), JsValue> {
    let mut frame_bytes = vec![0; bytes.length() as usize];
    bytes.copy_to(&mut frame_bytes);
    let envelope = protocol::build_preview_frame_envelope(PreviewFrameInput {
        request_id: request_id as u64,
        run_id: &run_id,
        node_id: &node_id,
        sequence: sequence as u64,
        timestamp_ms: timestamp_ms.max(0.0) as u64,
        mime: &mime,
        width,
        height,
        bytes: &frame_bytes,
    });
    send_frame(
        MessageKind::PreviewFrame as u16,
        js_sys::Uint8Array::from(envelope.as_slice()),
    )
}

#[wasm_bindgen(js_name = sendLightFlowWorkflowPatch)]
pub fn send_lightflow_workflow_patch(
    request_id: u32,
    workflow_id: String,
    base_revision: String,
    ops: js_sys::Array,
) -> Result<(), JsValue> {
    let owned_ops = parse_patch_ops(&ops)?;
    let borrowed_ops = borrowed_patch_ops(&owned_ops);
    let envelope = protocol::build_workflow_patch_envelope(WorkflowPatchInput {
        request_id: request_id as u64,
        workflow_id: &workflow_id,
        base_revision: &base_revision,
        ops: &borrowed_ops,
    });
    send_frame(
        MessageKind::WorkflowPatch as u16,
        js_sys::Uint8Array::from(envelope.as_slice()),
    )
}

fn send_frame(kind: u16, bytes: js_sys::Uint8Array) -> Result<(), JsValue> {
    TRANSPORT.with(|transport| {
        let transport = transport.borrow();
        let datagrams = transport
            .datagrams
            .as_ref()
            .ok_or_else(|| JsValue::from_str("LightFlow WebTransport is not connected"))?;

        let writable = reflect(datagrams, "writable")?;
        let writer = call0(&writable, "getWriter")?;
        let frame = encode_transport_frame(kind, bytes);
        call1(&writer, "write", &frame)?;
        let _ = call0(&writer, "releaseLock");
        Ok(())
    })
}

fn parse_patch_ops(ops: &js_sys::Array) -> Result<Vec<OwnedPatchOp>, JsValue> {
    let mut parsed = Vec::with_capacity(ops.length() as usize);
    for value in ops.iter() {
        let op = required_string(&value, "op")?;
        parsed.push(match op.as_str() {
            "add_node" => OwnedPatchOp::AddNode {
                node: parse_patch_node(&reflect(&value, "node")?)?,
            },
            "update_node" => OwnedPatchOp::UpdateNode {
                node: parse_patch_node(&reflect(&value, "node")?)?,
            },
            "move_node" => OwnedPatchOp::MoveNode {
                node_id: required_string(&value, "node_id")?,
                x: optional_f32(&value, "x"),
                y: optional_f32(&value, "y"),
            },
            "delete_node" => OwnedPatchOp::DeleteNode {
                node_id: required_string(&value, "node_id")?,
            },
            "connect" => OwnedPatchOp::Connect {
                from: parse_port_ref(&reflect(&value, "from")?)?,
                to: parse_port_ref(&reflect(&value, "to")?)?,
            },
            "disconnect" => OwnedPatchOp::Disconnect {
                from: parse_port_ref(&reflect(&value, "from")?)?,
                to: parse_port_ref(&reflect(&value, "to")?)?,
            },
            _ => return Err(JsValue::from_str(&format!("unsupported patch op `{op}`"))),
        });
    }
    Ok(parsed)
}

fn parse_patch_node(value: &JsValue) -> Result<OwnedPatchNode, JsValue> {
    Ok(OwnedPatchNode {
        id: required_string(value, "id")?,
        kind: parse_node_kind(&required_string(value, "kind")?),
        title: required_string(value, "title")?,
        component: optional_string(value, "component"),
        x: optional_f32(value, "x"),
        y: optional_f32(value, "y"),
    })
}

fn parse_port_ref(value: &JsValue) -> Result<OwnedPortRef, JsValue> {
    Ok(OwnedPortRef {
        node: required_string(value, "node")?,
        port: required_string(value, "port")?,
    })
}

fn borrowed_patch_ops(ops: &[OwnedPatchOp]) -> Vec<WorkflowPatchOpInput<'_>> {
    ops.iter()
        .map(|op| match op {
            OwnedPatchOp::AddNode { node } => WorkflowPatchOpInput::AddNode {
                node: WorkflowNodePatchInput {
                    id: &node.id,
                    kind: node.kind,
                    title: &node.title,
                    component: node.component.as_deref(),
                    x: node.x,
                    y: node.y,
                },
            },
            OwnedPatchOp::UpdateNode { node } => WorkflowPatchOpInput::UpdateNode {
                node: WorkflowNodePatchInput {
                    id: &node.id,
                    kind: node.kind,
                    title: &node.title,
                    component: node.component.as_deref(),
                    x: node.x,
                    y: node.y,
                },
            },
            OwnedPatchOp::MoveNode { node_id, x, y } => WorkflowPatchOpInput::MoveNode {
                node_id,
                x: *x,
                y: *y,
            },
            OwnedPatchOp::DeleteNode { node_id } => WorkflowPatchOpInput::DeleteNode { node_id },
            OwnedPatchOp::Connect { from, to } => WorkflowPatchOpInput::Connect {
                from: PortRefInput {
                    node: &from.node,
                    port: &from.port,
                },
                to: PortRefInput {
                    node: &to.node,
                    port: &to.port,
                },
            },
            OwnedPatchOp::Disconnect { from, to } => WorkflowPatchOpInput::Disconnect {
                from: PortRefInput {
                    node: &from.node,
                    port: &from.port,
                },
                to: PortRefInput {
                    node: &to.node,
                    port: &to.port,
                },
            },
        })
        .collect()
}

fn parse_node_kind(kind: &str) -> NodeKind {
    match kind {
        "workflow_input" | "input" => NodeKind::WorkflowInput,
        "mcp_tool" | "tool" => NodeKind::McpTool,
        "state_transform" | "transform" => NodeKind::StateTransform,
        "run_state" | "state" => NodeKind::RunState,
        "preview_sink" | "preview" => NodeKind::PreviewSink,
        "web_component_slot" | "web_component" => NodeKind::WebComponentSlot,
        _ => NodeKind::McpTool,
    }
}

fn required_string(value: &JsValue, key: &str) -> Result<String, JsValue> {
    reflect(value, key)?
        .as_string()
        .ok_or_else(|| JsValue::from_str(&format!("missing string field `{key}`")))
}

fn optional_string(value: &JsValue, key: &str) -> Option<String> {
    reflect(value, key).ok().and_then(|value| value.as_string())
}

fn optional_f32(value: &JsValue, key: &str) -> f32 {
    reflect(value, key)
        .ok()
        .and_then(|value| value.as_f64())
        .unwrap_or_default() as f32
}

async fn connect_transport(url: String) -> Result<JsValue, String> {
    let window = web_sys::window().ok_or_else(|| "missing window".to_owned())?;
    let constructor =
        js_sys::Reflect::get(&window, &JsValue::from_str("WebTransport")).map_err(js_error)?;
    let transport = js_sys::Reflect::construct(
        &constructor.unchecked_into::<js_sys::Function>(),
        &js_sys::Array::of1(&JsValue::from_str(&url)),
    )
    .map_err(js_error)?;

    let ready = reflect(&transport, "ready").map_err(js_error)?;
    let ready = ready
        .dyn_into::<js_sys::Promise>()
        .map_err(|_| "WebTransport.ready is not a Promise".to_owned())?;
    JsFuture::from(ready).await.map_err(js_error)?;

    reflect(&transport, "datagrams").map_err(js_error)
}

fn encode_transport_frame(kind: u16, bytes: js_sys::Uint8Array) -> JsValue {
    let length = bytes.length();
    let frame = js_sys::Uint8Array::new_with_length(length + 2);
    frame.set_index(0, (kind & 0xff) as u8);
    frame.set_index(1, (kind >> 8) as u8);
    frame.set(&bytes, 2);
    frame.into()
}

fn web_transport_supported() -> bool {
    web_sys::window()
        .and_then(|window| js_sys::Reflect::get(&window, &JsValue::from_str("WebTransport")).ok())
        .is_some_and(|value| !value.is_undefined() && !value.is_null())
}

fn set_transport_connecting(url: String) {
    TRANSPORT.with(|transport| {
        let mut transport = transport.borrow_mut();
        transport.url = Some(url);
        transport.status = "connecting".to_owned();
        transport.last_error = None;
        transport.datagrams = None;
    });
}

fn set_transport_ready(url: String, datagrams: JsValue) {
    TRANSPORT.with(|transport| {
        let mut transport = transport.borrow_mut();
        transport.url = Some(url);
        transport.status = "ready".to_owned();
        transport.last_error = None;
        transport.datagrams = Some(datagrams);
    });
}

fn set_transport_error(url: Option<String>, error: String) {
    TRANSPORT.with(|transport| {
        let mut transport = transport.borrow_mut();
        transport.url = url;
        transport.status = "error".to_owned();
        transport.last_error = Some(error);
        transport.datagrams = None;
    });
}

fn reflect(value: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    js_sys::Reflect::get(value, &JsValue::from_str(key))
}

fn call0(target: &JsValue, method: &str) -> Result<JsValue, JsValue> {
    let method = reflect(target, method)?.unchecked_into::<js_sys::Function>();
    method.call0(target)
}

fn call1(target: &JsValue, method: &str, arg: &JsValue) -> Result<JsValue, JsValue> {
    let method = reflect(target, method)?.unchecked_into::<js_sys::Function>();
    method.call1(target, arg)
}

fn js_error(value: JsValue) -> String {
    value
        .as_string()
        .unwrap_or_else(|| "JavaScript WebTransport error".to_owned())
}

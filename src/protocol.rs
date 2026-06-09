use flatbuffers::{FlatBufferBuilder, TableFinishedWIPOffset, WIPOffset};

#[repr(u16)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageKind {
    WorkflowPatch = 3,
    PreviewFrame = 5,
    RunEvent = 6,
}

const VT_REQUEST_ID: flatbuffers::VOffsetT = 4;
const VT_KIND: flatbuffers::VOffsetT = 6;
const VT_WORKFLOW_PATCH: flatbuffers::VOffsetT = 12;
const VT_PREVIEW_FRAME: flatbuffers::VOffsetT = 16;
const VT_RUN_EVENT: flatbuffers::VOffsetT = 18;

const VT_PORT_NODE: flatbuffers::VOffsetT = 4;
const VT_PORT_PORT: flatbuffers::VOffsetT = 6;

const VT_WORKFLOW_NODE_ID: flatbuffers::VOffsetT = 4;
const VT_WORKFLOW_NODE_KIND: flatbuffers::VOffsetT = 6;
const VT_WORKFLOW_NODE_TITLE: flatbuffers::VOffsetT = 8;
const VT_WORKFLOW_NODE_COMPONENT: flatbuffers::VOffsetT = 12;

const VT_PATCH_OP_KIND: flatbuffers::VOffsetT = 4;
const VT_PATCH_OP_NODE: flatbuffers::VOffsetT = 6;
const VT_PATCH_OP_NODE_ID: flatbuffers::VOffsetT = 8;
const VT_PATCH_OP_FROM: flatbuffers::VOffsetT = 12;
const VT_PATCH_OP_TO: flatbuffers::VOffsetT = 14;

const VT_WORKFLOW_PATCH_ID: flatbuffers::VOffsetT = 4;
const VT_WORKFLOW_PATCH_BASE_REVISION: flatbuffers::VOffsetT = 6;
const VT_WORKFLOW_PATCH_OPS: flatbuffers::VOffsetT = 8;

const VT_PREVIEW_RUN_ID: flatbuffers::VOffsetT = 4;
const VT_PREVIEW_NODE_ID: flatbuffers::VOffsetT = 6;
const VT_PREVIEW_SEQUENCE: flatbuffers::VOffsetT = 8;
const VT_PREVIEW_TIMESTAMP_MS: flatbuffers::VOffsetT = 10;
const VT_PREVIEW_MIME: flatbuffers::VOffsetT = 12;
const VT_PREVIEW_WIDTH: flatbuffers::VOffsetT = 14;
const VT_PREVIEW_HEIGHT: flatbuffers::VOffsetT = 16;
const VT_PREVIEW_BYTES: flatbuffers::VOffsetT = 18;

const VT_RUN_ID: flatbuffers::VOffsetT = 4;
const VT_SEQUENCE: flatbuffers::VOffsetT = 6;
const VT_EVENT_TYPE: flatbuffers::VOffsetT = 8;
const VT_PAYLOAD: flatbuffers::VOffsetT = 10;

#[repr(u16)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeKind {
    WorkflowInput = 1,
    McpTool = 2,
    StateTransform = 3,
    RunState = 4,
    PreviewSink = 5,
    WebComponentSlot = 6,
}

#[repr(u16)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PatchOpKind {
    AddNode = 1,
    MoveNode = 2,
    DeleteNode = 3,
    Connect = 4,
    Disconnect = 5,
    UpdateNode = 6,
}

pub struct WorkflowNodePatchInput<'a> {
    pub id: &'a str,
    pub kind: NodeKind,
    pub title: &'a str,
    pub component: Option<&'a str>,
    pub x: f32,
    pub y: f32,
}

pub struct PortRefInput<'a> {
    pub node: &'a str,
    pub port: &'a str,
}

pub enum WorkflowPatchOpInput<'a> {
    AddNode {
        node: WorkflowNodePatchInput<'a>,
    },
    UpdateNode {
        node: WorkflowNodePatchInput<'a>,
    },
    MoveNode {
        node_id: &'a str,
        x: f32,
        y: f32,
    },
    DeleteNode {
        node_id: &'a str,
    },
    Connect {
        from: PortRefInput<'a>,
        to: PortRefInput<'a>,
    },
    Disconnect {
        from: PortRefInput<'a>,
        to: PortRefInput<'a>,
    },
}

pub struct WorkflowPatchInput<'a> {
    pub request_id: u64,
    pub workflow_id: &'a str,
    pub base_revision: &'a str,
    pub ops: &'a [WorkflowPatchOpInput<'a>],
}

pub fn build_workflow_patch_envelope(input: WorkflowPatchInput<'_>) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::with_capacity(512 + input.ops.len() * 96);

    let mut op_offsets = Vec::with_capacity(input.ops.len());
    for op in input.ops {
        op_offsets.push(build_patch_op(&mut builder, op));
    }

    let ops = builder.create_vector(&op_offsets);
    let workflow_id = builder.create_string(input.workflow_id);
    let base_revision = builder.create_string(input.base_revision);

    let patch = {
        let start = builder.start_table();
        builder.push_slot_always(VT_WORKFLOW_PATCH_ID, workflow_id);
        builder.push_slot_always(VT_WORKFLOW_PATCH_BASE_REVISION, base_revision);
        builder.push_slot_always(VT_WORKFLOW_PATCH_OPS, ops);
        builder.end_table(start)
    };

    let envelope = build_envelope(
        &mut builder,
        input.request_id,
        MessageKind::WorkflowPatch,
        Some(patch),
        None,
        None,
    );
    builder.finish_minimal(envelope);
    builder.finished_data().to_vec()
}

pub struct PreviewFrameInput<'a> {
    pub request_id: u64,
    pub run_id: &'a str,
    pub node_id: &'a str,
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub mime: &'a str,
    pub width: u32,
    pub height: u32,
    pub bytes: &'a [u8],
}

pub fn build_preview_frame_envelope(input: PreviewFrameInput<'_>) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::with_capacity(input.bytes.len() + 320);

    let run_id = builder.create_string(input.run_id);
    let node_id = builder.create_string(input.node_id);
    let mime = builder.create_string(input.mime);
    let bytes = builder.create_vector(input.bytes);

    let preview_frame = {
        let start = builder.start_table();
        builder.push_slot_always(VT_PREVIEW_RUN_ID, run_id);
        builder.push_slot_always(VT_PREVIEW_NODE_ID, node_id);
        builder.push_slot(VT_PREVIEW_SEQUENCE, input.sequence, 0);
        builder.push_slot(VT_PREVIEW_TIMESTAMP_MS, input.timestamp_ms, 0);
        builder.push_slot_always(VT_PREVIEW_MIME, mime);
        builder.push_slot(VT_PREVIEW_WIDTH, input.width, 0);
        builder.push_slot(VT_PREVIEW_HEIGHT, input.height, 0);
        builder.push_slot_always(VT_PREVIEW_BYTES, bytes);
        builder.end_table(start)
    };

    let envelope = build_envelope(
        &mut builder,
        input.request_id,
        MessageKind::PreviewFrame,
        None,
        Some(preview_frame),
        None,
    );
    builder.finish_minimal(envelope);
    builder.finished_data().to_vec()
}

pub fn build_run_event_envelope(
    request_id: u64,
    run_id: &str,
    sequence: u64,
    event_type: &str,
    payload: &[u8],
) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::with_capacity(payload.len() + 256);

    let run_id = builder.create_string(run_id);
    let event_type = builder.create_string(event_type);
    let payload = builder.create_vector(payload);

    let run_event = {
        let start = builder.start_table();
        builder.push_slot_always(VT_RUN_ID, run_id);
        builder.push_slot(VT_SEQUENCE, sequence, 0);
        builder.push_slot_always(VT_EVENT_TYPE, event_type);
        builder.push_slot_always(VT_PAYLOAD, payload);
        builder.end_table(start)
    };

    let envelope = build_envelope(
        &mut builder,
        request_id,
        MessageKind::RunEvent,
        None,
        None,
        Some(run_event),
    );
    builder.finish_minimal(envelope);
    builder.finished_data().to_vec()
}

fn build_envelope(
    builder: &mut FlatBufferBuilder<'_>,
    request_id: u64,
    kind: MessageKind,
    workflow_patch: Option<WIPOffset<TableFinishedWIPOffset>>,
    preview_frame: Option<WIPOffset<TableFinishedWIPOffset>>,
    run_event: Option<WIPOffset<TableFinishedWIPOffset>>,
) -> WIPOffset<TableFinishedWIPOffset> {
    let start = builder.start_table();
    builder.push_slot(VT_REQUEST_ID, request_id, 0);
    builder.push_slot(VT_KIND, kind as u16, 0);
    if let Some(workflow_patch) = workflow_patch {
        builder.push_slot_always(VT_WORKFLOW_PATCH, workflow_patch);
    }
    if let Some(preview_frame) = preview_frame {
        builder.push_slot_always(VT_PREVIEW_FRAME, preview_frame);
    }
    if let Some(run_event) = run_event {
        builder.push_slot_always(VT_RUN_EVENT, run_event);
    }
    builder.end_table(start)
}

fn build_patch_op(
    builder: &mut FlatBufferBuilder<'_>,
    op: &WorkflowPatchOpInput<'_>,
) -> WIPOffset<TableFinishedWIPOffset> {
    match op {
        WorkflowPatchOpInput::AddNode { node } => {
            let node = build_workflow_node(builder, node);
            let start = builder.start_table();
            builder.push_slot(VT_PATCH_OP_KIND, PatchOpKind::AddNode as u16, 0);
            builder.push_slot_always(VT_PATCH_OP_NODE, node);
            builder.end_table(start)
        }
        WorkflowPatchOpInput::UpdateNode { node } => {
            let node = build_workflow_node(builder, node);
            let start = builder.start_table();
            builder.push_slot(VT_PATCH_OP_KIND, PatchOpKind::UpdateNode as u16, 0);
            builder.push_slot_always(VT_PATCH_OP_NODE, node);
            builder.end_table(start)
        }
        WorkflowPatchOpInput::MoveNode { node_id, x, y } => {
            let _position_is_reserved_for_codegen = (*x, *y);
            let node_id = builder.create_string(node_id);
            let start = builder.start_table();
            builder.push_slot(VT_PATCH_OP_KIND, PatchOpKind::MoveNode as u16, 0);
            builder.push_slot_always(VT_PATCH_OP_NODE_ID, node_id);
            builder.end_table(start)
        }
        WorkflowPatchOpInput::DeleteNode { node_id } => {
            let node_id = builder.create_string(node_id);
            let start = builder.start_table();
            builder.push_slot(VT_PATCH_OP_KIND, PatchOpKind::DeleteNode as u16, 0);
            builder.push_slot_always(VT_PATCH_OP_NODE_ID, node_id);
            builder.end_table(start)
        }
        WorkflowPatchOpInput::Connect { from, to } => {
            let from = build_port_ref(builder, from);
            let to = build_port_ref(builder, to);
            let start = builder.start_table();
            builder.push_slot(VT_PATCH_OP_KIND, PatchOpKind::Connect as u16, 0);
            builder.push_slot_always(VT_PATCH_OP_FROM, from);
            builder.push_slot_always(VT_PATCH_OP_TO, to);
            builder.end_table(start)
        }
        WorkflowPatchOpInput::Disconnect { from, to } => {
            let from = build_port_ref(builder, from);
            let to = build_port_ref(builder, to);
            let start = builder.start_table();
            builder.push_slot(VT_PATCH_OP_KIND, PatchOpKind::Disconnect as u16, 0);
            builder.push_slot_always(VT_PATCH_OP_FROM, from);
            builder.push_slot_always(VT_PATCH_OP_TO, to);
            builder.end_table(start)
        }
    }
}

fn build_workflow_node(
    builder: &mut FlatBufferBuilder<'_>,
    node: &WorkflowNodePatchInput<'_>,
) -> WIPOffset<TableFinishedWIPOffset> {
    let _position_is_reserved_for_codegen = (node.x, node.y);
    let id = builder.create_string(node.id);
    let title = builder.create_string(node.title);
    let component = node
        .component
        .map(|component| builder.create_string(component));

    let start = builder.start_table();
    builder.push_slot_always(VT_WORKFLOW_NODE_ID, id);
    builder.push_slot(VT_WORKFLOW_NODE_KIND, node.kind as u16, 0);
    builder.push_slot_always(VT_WORKFLOW_NODE_TITLE, title);
    if let Some(component) = component {
        builder.push_slot_always(VT_WORKFLOW_NODE_COMPONENT, component);
    }
    builder.end_table(start)
}

fn build_port_ref(
    builder: &mut FlatBufferBuilder<'_>,
    port: &PortRefInput<'_>,
) -> WIPOffset<TableFinishedWIPOffset> {
    let node = builder.create_string(port.node);
    let port_name = builder.create_string(port.port);
    let start = builder.start_table();
    builder.push_slot_always(VT_PORT_NODE, node);
    builder.push_slot_always(VT_PORT_PORT, port_name);
    builder.end_table(start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_event_envelope_is_nonempty_flatbuffer() {
        let bytes = build_run_event_envelope(7, "run-1", 11, "preview", &[1, 2, 3, 4]);
        assert!(bytes.len() > 16);
        let root_offset = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        assert!(root_offset < bytes.len());
    }

    #[test]
    fn preview_frame_envelope_is_nonempty_flatbuffer() {
        let bytes = build_preview_frame_envelope(PreviewFrameInput {
            request_id: 9,
            run_id: "run-1",
            node_id: "node-preview",
            sequence: 12,
            timestamp_ms: 1_701_000,
            mime: "image/png",
            width: 640,
            height: 360,
            bytes: &[137, 80, 78, 71],
        });
        assert!(bytes.len() > 24);
        let root_offset = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        assert!(root_offset < bytes.len());
    }

    #[test]
    fn workflow_patch_envelope_is_nonempty_flatbuffer() {
        let ops = [
            WorkflowPatchOpInput::AddNode {
                node: WorkflowNodePatchInput {
                    id: "node-a",
                    kind: NodeKind::McpTool,
                    title: "MCP Tool",
                    component: Some("lightflow-tool-node"),
                    x: 10.0,
                    y: 20.0,
                },
            },
            WorkflowPatchOpInput::MoveNode {
                node_id: "node-a",
                x: 40.0,
                y: 50.0,
            },
            WorkflowPatchOpInput::UpdateNode {
                node: WorkflowNodePatchInput {
                    id: "node-a",
                    kind: NodeKind::WebComponentSlot,
                    title: "Histogram",
                    component: Some("lightflow-histogram-node"),
                    x: 40.0,
                    y: 50.0,
                },
            },
            WorkflowPatchOpInput::Connect {
                from: PortRefInput {
                    node: "node-a",
                    port: "tool_result",
                },
                to: PortRefInput {
                    node: "node-b",
                    port: "tool_result",
                },
            },
            WorkflowPatchOpInput::DeleteNode { node_id: "node-c" },
            WorkflowPatchOpInput::Disconnect {
                from: PortRefInput {
                    node: "node-a",
                    port: "tool_result",
                },
                to: PortRefInput {
                    node: "node-b",
                    port: "tool_result",
                },
            },
        ];
        let bytes = build_workflow_patch_envelope(WorkflowPatchInput {
            request_id: 12,
            workflow_id: "workflow.default",
            base_revision: "rev-1",
            ops: &ops,
        });
        assert!(bytes.len() > 32);
        let root_offset = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        assert!(root_offset < bytes.len());
    }

    #[test]
    fn all_node_kinds_have_schema_values() {
        let values = [
            NodeKind::WorkflowInput as u16,
            NodeKind::McpTool as u16,
            NodeKind::StateTransform as u16,
            NodeKind::RunState as u16,
            NodeKind::PreviewSink as u16,
            NodeKind::WebComponentSlot as u16,
        ];
        assert_eq!(values, [1, 2, 3, 4, 5, 6]);
    }
}

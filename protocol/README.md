# LightFlow Transport Protocol

LightFlowUI uses two lanes:

- Control plane: JSON-RPC `tools/call` over `/mcp` for workflow open, region reads, validation, and patch saves.
- Data plane: WebTransport plus FlatBuffers for high-frequency binary streams such as preview frames and run events.

The FlatBuffers schema in `lightflow_transport.fbs` is the source contract for generated clients and servers. The frontend still treats MCP as the workflow source of truth; WebTransport is not an agent interface and must not replace workflow editing tools.

## Region Loading

Large workflows are loaded by visible rectangle. The frontend sends `WorkflowRegionRequest` with a viewport rect, zoom, limit, and optional cursor. The backend returns `WorkflowRegionResponse` containing only nodes and edges needed for that region, plus an estimated total and next cursor.

## Patch Saves

Edits are sent as `WorkflowPatch` against a base revision. The backend owns conflict detection and returns the new revision through the MCP control response.

## Preview Streams

`PreviewFrame` is intended for binary image or video preview chunks. It carries encoded bytes and metadata only; decoding and rendering stay in the Rust/WASM `wgpu` frontend.

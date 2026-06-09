# LightFlowUI

Frontend control console for [LightFlow](https://github.com/LIghtJUNction/LightFlow).

LightFlowUI is a Rust/WASM workflow canvas. The UI uses `egui`/`wgpu` through `eframe` and builds on `egui_node_graph2` for node-graph interaction. The resource explorer treats `/mcp` as a special resource file, while the main screen is a tiled workflow workspace.

There is no Python compatibility layer and no ComfyUI compatibility layer in this frontend direction.

## Local Development

```bash
rustup target add wasm32-unknown-unknown
cargo install trunk
trunk serve --port 5174
```

## Production Build

```bash
trunk build --release
```

The app is deployed to GitHub Pages:

```text
https://lightjunction.github.io/LightFlowUI/
```

## Runtime Modes

- Canvas mode runs entirely inside Rust/WASM and renders through GPU-backed egui.
- MCP mode uses `http://localhost:5174/mcp` as the source of truth for workflow open/read/validate/save.
- Plugin mode exposes `registerLightFlowNode` through `wasm-bindgen` so TypeScript/Web Components can register custom node UIs without moving core canvas logic out of Rust.
- Transport mode keeps `/mcp` as the control plane and reserves WebTransport plus FlatBuffers for high-frequency binary previews and run events.

## MCP Workflow Contract

The frontend calls `/mcp` with JSON-RPC. Workflow operations use `tools/call`; capability discovery uses the standard `tools/list`, `resources/list`, and `prompts/list` methods and is shown in the resource explorer. Discovered resources can be selected and previewed through `resources/read`; discovered prompts can be previewed through `prompts/get`. It does not contain an agent planner and does not load complete workflows by default.

Required backend tools:

- `lightflow.workflow.open`
- `lightflow.workflow.read_region`
- `lightflow.workflow.apply_patch`
- `lightflow.workflow.validate`
- `lightflow.workflow.list`

Large workflows are read by viewport:

```json
{
  "workflow_id": "workflow.default",
  "region": {
    "x": 0,
    "y": 0,
    "width": 1800,
    "height": 1200,
    "zoom": 1,
    "limit": 500,
    "cursor": null
  }
}
```

Expected `read_region` payload:

```json
{
  "workflow_id": "workflow.default",
  "revision": "rev-001",
  "nodes": [
    {
      "id": "node-1",
      "kind": "web_component_slot",
      "title": "Histogram UI",
      "position": { "x": 300, "y": 80 },
      "component": "lightflow-histogram-node"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "from": { "node": "node-1", "port": "tool_result" },
      "to": { "node": "node-2", "port": "tool_result" }
    }
  ],
  "total_estimate": 120000,
  "next_cursor": "opaque-cursor-or-null"
}
```

Edits are saved as patches against the loaded revision:

```json
{
  "patch": {
    "workflow_id": "workflow.default",
    "base_revision": "rev-001",
    "ops": [
      {
        "op": "add_node",
        "node": {
          "id": "local::NodeId(1v1)",
          "kind": "mcp_tool",
          "title": "MCP Tool",
          "position": { "x": 120, "y": 160 }
        }
      },
      {
        "op": "connect",
        "from": { "node": "node-1", "port": "tool_result" },
        "to": { "node": "node-2", "port": "tool_result" }
      }
    ]
  }
}
```

The backend should return a new revision after `apply_patch`; the frontend clears its dirty patch queue only after that response. For `web_component_slot` nodes, the optional `component` field is copied into the node's editable `component` input so custom UI survives region reloads.

The toolbar has an `auto read` toggle for large workflows. When enabled, LightFlowUI watches the current viewport, waits for pan/zoom to settle, and then calls `lightflow.workflow.read_region` with the visible rectangle. It skips duplicate viewport signatures and does not issue another region read while a previous `read_region` call is pending.

The `window graph` toggle is enabled by default. It prunes remote nodes that are no longer returned by the current `read_region` response from the local egui graph, without emitting delete patches. This keeps the WASM-side graph bounded while panning across very large workflows. Disable it only when debugging accumulated region cache behavior.

## Plugin API

The browser build exports the plugin API declared in `web/lightflow-plugin-api.d.ts`:

```ts
registerLightFlowNode({
  id: "vendor.histogram",
  displayName: "Histogram",
  elementName: "lightflow-histogram-node",
  inputs: ["image"],
  outputs: ["stats"]
})
```

`elementName` must be a valid custom-element name containing a hyphen. Re-registering the same `id` replaces the existing registration.

Custom node UI is mounted in a dedicated overlay above the GPU canvas. The core workflow canvas, node selection, links, pan/zoom, and validation remain in Rust/egui; the DOM layer is only for third-party node controls.

```ts
mountLightFlowNodeComponent(
  "node-42",
  "lightflow-histogram-node",
  320,
  180,
  260,
  160,
  { nodeId: "node-42", revision: "rev-001" }
)

updateLightFlowNodeComponent("node-42", 340, 190, 260, 160, {
  nodeId: "node-42",
  selected: true
})

unmountLightFlowNodeComponent("node-42")
```

The mounted element receives the latest payload through its `lightflowProps` property.

`Web Component Slot` nodes in the Rust graph are synchronized automatically. Each slot has a `component` constant input; set it to a custom element name such as `lightflow-histogram-node` to mount that component. If the field is empty, LightFlowUI falls back to the first registered plugin component. The mounted element follows the egui node rectangle and updates its `lightflowProps` as the canvas pans, zooms, selects, or reloads workflow regions. Editing the `component` input creates an `update_node` workflow patch so the change can be saved back to the backend. The same fields are also exposed in the right-side Inspector for the currently selected node, alongside the node title.

## Binary Transport Schema

The FlatBuffers schema lives in `protocol/lightflow_transport.fbs`. It defines workflow region messages, patch messages, validation issues, preview frames, and run events. Generated backend/client code should treat that file as the binary data-plane contract.

The browser build exports a minimal WebTransport data-plane API:

```ts
connectLightFlowTransport("https://localhost:5174/transport")
sendLightFlowTransportBytes(5, previewFrameFlatBufferBytes)
sendLightFlowRunEvent(1, "run-42", 7, "node.progress", new Uint8Array([1, 2, 3]))
sendLightFlowPreviewFrame(
  2,
  "run-42",
  "preview-node",
  8,
  Date.now(),
  "image/png",
  640,
  360,
  pngBytes
)
sendLightFlowWorkflowPatch(3, "workflow.default", "rev-001", [
  {
    op: "update_node",
    node: {
      id: "node-ui",
      kind: "web_component_slot",
      title: "Histogram UI",
      component: "lightflow-histogram-node"
    }
  },
  {
    op: "connect",
    from: { node: "node-a", port: "tool_result" },
    to: { node: "node-b", port: "tool_result" }
  }
])
console.log(lightFlowTransportStatus())
```

`sendLightFlowTransportBytes` prefixes each datagram with a little-endian `u16` message kind, followed by the FlatBuffers payload bytes. `sendLightFlowRunEvent`, `sendLightFlowPreviewFrame`, and `sendLightFlowWorkflowPatch` build `TransportEnvelope` payloads using the Rust `flatbuffers` crate before sending. `/mcp` remains the control plane for workflow editing.

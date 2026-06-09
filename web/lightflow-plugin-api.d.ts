export interface LightFlowNodeRegistration {
  id: string
  displayName: string
  elementName: string
  inputs?: string[]
  outputs?: string[]
}

export function registerLightFlowNode(
  registration: LightFlowNodeRegistration
): void

export function lightFlowNodeRegistrations(): LightFlowNodeRegistration[]

export function mountLightFlowNodeComponent(
  nodeId: string,
  elementName: string,
  x: number,
  y: number,
  width: number,
  height: number,
  props?: unknown
): void

export function updateLightFlowNodeComponent(
  nodeId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  props?: unknown
): void

export function unmountLightFlowNodeComponent(nodeId: string): void

export function lightFlowMountedComponents(): string[]

export function connectLightFlowTransport(url: string): void

export function lightFlowTransportStatus(): string

export function sendLightFlowTransportBytes(
  kind: number,
  bytes: Uint8Array
): void

export function sendLightFlowRunEvent(
  requestId: number,
  runId: string,
  sequence: number,
  eventType: string,
  payload: Uint8Array
): void

export function sendLightFlowPreviewFrame(
  requestId: number,
  runId: string,
  nodeId: string,
  sequence: number,
  timestampMs: number,
  mime: string,
  width: number,
  height: number,
  bytes: Uint8Array
): void

export type LightFlowWorkflowPatchOp =
  | {
      op: "add_node"
      node: {
        id: string
        kind: string
        title: string
        component?: string
        x?: number
        y?: number
      }
    }
  | {
      op: "update_node"
      node: {
        id: string
        kind: string
        title: string
        component?: string
        x?: number
        y?: number
      }
    }
  | { op: "move_node"; node_id: string; x?: number; y?: number }
  | { op: "delete_node"; node_id: string }
  | {
      op: "connect" | "disconnect"
      from: { node: string; port: string }
      to: { node: string; port: string }
    }

export function sendLightFlowWorkflowPatch(
  requestId: number,
  workflowId: string,
  baseRevision: string,
  ops: LightFlowWorkflowPatchOp[]
): void

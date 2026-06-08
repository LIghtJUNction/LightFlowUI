export type AssetKind = 'Workflow' | 'Node' | 'Composition' | 'Model'

export interface AssetRecord {
  id: string
  kind: AssetKind
  title: string
  description: string
  source_path: string
  builtin: boolean
}

export interface AssetList {
  assets: AssetRecord[]
}

export interface CreateRunRequest {
  workflow_asset_id: string
  run_id?: string
  inputs: Record<string, unknown>
}

export type WorkflowStepTarget =
  | { type: 'api'; format: string }
  | { type: 'tool'; tool_id: string }
  | { type: 'thread'; thread_id: string }

export interface WorkflowRequestTemplate {
  type: 'openai_chat_prompt'
  model_asset_id: string
  prompt_input: string
}

export interface WorkflowStepDef {
  id: string
  title: string
  target: WorkflowStepTarget
  request?: WorkflowRequestTemplate
}

export interface WorkflowDef {
  id: string
  title: string
  description: string
  steps: WorkflowStepDef[]
}

export interface RunPreviewStep {
  step_id: string
  title: string
  target: WorkflowStepTarget
  request_template?: WorkflowRequestTemplate
  cortex_request_path: string
  rendered_request?: Record<string, unknown>
}

export interface RunPreview {
  run_id: string
  workflow: AssetRecord
  definition: WorkflowDef
  validation_issues: string[]
  steps: RunPreviewStep[]
}

export type RunStepStatus = 'planned' | 'submitted' | 'succeeded' | 'failed'
export type RunLifecycleStatus = 'planned' | 'running' | 'succeeded' | 'failed'

export interface RunStepRecord {
  step_id: string
  title: string
  status: RunStepStatus
  cortex_request_path: string
  submitted_request_path?: string
  response_path?: string
  error_path?: string
  response_fingerprint?: string
  audit_correlation?: string
}

export interface RunManifest {
  run_id: string
  workflow_asset_id: string
  created_at: string
  steps: RunStepRecord[]
}

export interface RunList {
  runs: RunManifest[]
}

export interface RunStatusSummary {
  run_id: string
  workflow_asset_id: string
  status: RunLifecycleStatus
  total_steps: number
  planned_steps: number
  submitted_steps: number
  succeeded_steps: number
  failed_steps: number
}

export interface AssetState {
  workflows: AssetRecord[]
  nodes: AssetRecord[]
  compositions: AssetRecord[]
  models: AssetRecord[]
}

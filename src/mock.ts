import type {
  AssetRecord,
  AssetState,
  CreateRunRequest,
  RunManifest,
  RunPreview,
  RunStatusSummary,
  WorkflowDef
} from './types'

export const mockAssets: AssetState = {
  workflows: [
    {
      id: 'workflow.text_plan',
      kind: 'Workflow',
      title: 'Text Plan',
      description: 'Turn a prompt into a structured migration plan through one CortexFS API step.',
      source_path: 'lightflow/workflows/text_plan.rs',
      builtin: false
    },
    {
      id: 'workflow.research_brief',
      kind: 'Workflow',
      title: 'Research Brief',
      description: 'Draft a compact research brief with planning and synthesis steps.',
      source_path: 'lightflow/workflows/research_brief.rs',
      builtin: false
    }
  ],
  nodes: [
    {
      id: 'node.llm.prompt',
      kind: 'Node',
      title: 'LLM Prompt',
      description: 'Prepare an OpenAI-compatible chat request from workflow inputs.',
      source_path: 'lightflow/nodes/llm_prompt.rs',
      builtin: false
    },
    {
      id: 'node.artifact.index',
      kind: 'Node',
      title: 'Artifact Index',
      description: 'Attach generated artifacts to a run manifest and trace stream.',
      source_path: 'lightflow/nodes/artifact_index.rs',
      builtin: false
    }
  ],
  compositions: [
    {
      id: 'composition.plan_review',
      kind: 'Composition',
      title: 'Plan Review',
      description: 'Reusable planning and review chain for agent-authored changes.',
      source_path: 'lightflow/compositions/plan_review.rs',
      builtin: false
    }
  ],
  models: [
    {
      id: 'llm.planner',
      kind: 'Model',
      title: 'Planner',
      description: 'Default planning model alias resolved by CortexFS provider policy.',
      source_path: 'lightflow/models/planner.rs',
      builtin: false
    },
    {
      id: 'llm.reviewer',
      kind: 'Model',
      title: 'Reviewer',
      description: 'Review model alias for validation, critique, and summarization.',
      source_path: 'lightflow/models/reviewer.rs',
      builtin: false
    }
  ]
}

export const mockWorkflowDef: WorkflowDef = {
  id: 'workflow.text_plan',
  title: 'Text Plan',
  description: 'Plan a LightFlow task and preserve the request/response exchange in CortexFS.',
  steps: [
    {
      id: 'draft',
      title: 'Draft plan',
      target: { type: 'api', format: 'openai.chat' },
      request: {
        type: 'openai_chat_prompt',
        model_asset_id: 'llm.planner',
        prompt_input: 'prompt'
      }
    },
    {
      id: 'review',
      title: 'Review plan',
      target: { type: 'api', format: 'openai.chat' },
      request: {
        type: 'openai_chat_prompt',
        model_asset_id: 'llm.reviewer',
        prompt_input: 'prompt'
      }
    },
    {
      id: 'publish',
      title: 'Publish trace',
      target: { type: 'tool', tool_id: 'artifact.index' }
    }
  ]
}

export function createMockPreview(request: CreateRunRequest): RunPreview {
  const workflow = mockAssets.workflows.find((item) => item.id === request.workflow_asset_id) ?? mockAssets.workflows[0]
  const runId = request.run_id || `run-${new Date().toISOString().slice(0, 10)}`
  return {
    run_id: runId,
    workflow,
    definition: mockWorkflowDef,
    validation_issues: [],
    steps: mockWorkflowDef.steps.map((step) => ({
      step_id: step.id,
      title: step.title,
      target: step.target,
      request_template: step.request,
      cortex_request_path: `/ctx/home/1000/api/openai.chat/${runId}/${step.id}.req.json`,
      rendered_request: step.request
        ? {
            model: step.request.model_asset_id,
            messages: [
              {
                role: 'user',
                content: String(request.inputs[step.request.prompt_input] ?? '')
              }
            ]
          }
        : undefined
    }))
  }
}

export function createMockManifest(request: CreateRunRequest): RunManifest {
  const preview = createMockPreview(request)
  return {
    run_id: preview.run_id,
    workflow_asset_id: preview.workflow.id,
    created_at: new Date().toISOString(),
    steps: preview.steps.map((step) => ({
      step_id: step.step_id,
      title: step.title,
      status: 'planned',
      cortex_request_path: step.cortex_request_path
    }))
  }
}

export function submitMockStep(manifest: RunManifest, stepId: string): RunManifest {
  return {
    ...manifest,
    steps: manifest.steps.map((step) =>
      step.step_id === stepId && step.status === 'planned'
        ? {
            ...step,
            status: 'submitted',
            submitted_request_path: step.cortex_request_path
          }
        : step
    )
  }
}

export function refreshMockRun(manifest: RunManifest): RunManifest {
  return {
    ...manifest,
    steps: manifest.steps.map((step) =>
      step.status === 'submitted'
        ? {
            ...step,
            status: 'succeeded',
            response_path: step.cortex_request_path.replace('.req.json', '.resp.json'),
            response_fingerprint: 'sha256:9bc7b8df1f4e',
            audit_correlation: '/ctx/audit/events.jsonl#mock'
          }
        : step
    )
  }
}

export function summarizeRun(manifest?: RunManifest): RunStatusSummary | undefined {
  if (!manifest) return undefined
  const counts = manifest.steps.reduce(
    (acc, step) => {
      acc[`${step.status}_steps`] += 1
      return acc
    },
    {
      planned_steps: 0,
      submitted_steps: 0,
      succeeded_steps: 0,
      failed_steps: 0
    } as Record<'planned_steps' | 'submitted_steps' | 'succeeded_steps' | 'failed_steps', number>
  )
  const status =
    counts.failed_steps > 0
      ? 'failed'
      : counts.succeeded_steps === manifest.steps.length
        ? 'succeeded'
        : counts.submitted_steps > 0 || counts.succeeded_steps > 0
          ? 'running'
          : 'planned'

  return {
    run_id: manifest.run_id,
    workflow_asset_id: manifest.workflow_asset_id,
    status,
    total_steps: manifest.steps.length,
    ...counts
  }
}

export const mockEvents = [
  { event: 'run.created', step_id: null, detail: 'Created run manifest' },
  { event: 'step.submitted', step_id: 'draft', detail: 'Committed CortexFS request' },
  { event: 'step.succeeded', step_id: 'draft', detail: 'Observed response fingerprint' }
]

export const mockTrace = [
  { event: 'cortex.request.committed', path: '/ctx/home/1000/api/openai.chat/run-001/draft.req.json' },
  { event: 'cortex.response.observed', path: '/ctx/home/1000/api/openai.chat/run-001/draft.resp.json' }
]

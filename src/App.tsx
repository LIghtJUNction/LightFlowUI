import {
  Activity,
  Boxes,
  Braces,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Database,
  GitBranch,
  Globe2,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Server,
  Settings2,
  Sparkles,
  TerminalSquare,
  Workflow,
  XCircle
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { LightFlowApi } from './api'
import {
  createMockManifest,
  createMockPreview,
  mockAssets,
  mockEvents,
  mockTrace,
  refreshMockRun,
  submitMockStep,
  summarizeRun
} from './mock'
import type { AssetKind, AssetRecord, AssetState, CreateRunRequest, RunManifest, RunPreview } from './types'

type Mode = 'mock' | 'live'
type AssetTab = 'workflows' | 'nodes' | 'compositions' | 'models'
type Notice = { type: 'info' | 'error' | 'success'; text: string }

const tabs: Array<{ id: AssetTab; label: string; icon: typeof Workflow }> = [
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'nodes', label: 'Nodes', icon: CircleDot },
  { id: 'compositions', label: 'Compositions', icon: Layers3 },
  { id: 'models', label: 'Models', icon: Database }
]

const kindTone: Record<AssetKind, string> = {
  Workflow: 'tone-blue',
  Node: 'tone-green',
  Composition: 'tone-amber',
  Model: 'tone-violet'
}

function safeJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Inputs must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function formatTarget(target: RunPreview['steps'][number]['target']): string {
  if (target.type === 'api') return `api:${target.format}`
  if (target.type === 'tool') return `tool:${target.tool_id}`
  return `thread:${target.thread_id}`
}

function statusIcon(status?: string) {
  if (status === 'succeeded') return <CheckCircle2 size={16} />
  if (status === 'failed') return <XCircle size={16} />
  if (status === 'submitted' || status === 'running') return <Loader2 size={16} className="spin" />
  return <CircleDot size={16} />
}

export function App() {
  const [mode, setMode] = useState<Mode>('mock')
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [assets, setAssets] = useState<AssetState>(mockAssets)
  const [tab, setTab] = useState<AssetTab>('workflows')
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(mockAssets.workflows[0].id)
  const [runId, setRunId] = useState('run-001')
  const [inputs, setInputs] = useState('{\n  "prompt": "Write a migration plan for LightFlowUI"\n}')
  const [preview, setPreview] = useState<RunPreview>(() =>
    createMockPreview({
      workflow_asset_id: selectedWorkflowId,
      run_id: runId,
      inputs: { prompt: 'Write a migration plan for LightFlowUI' }
    })
  )
  const [manifest, setManifest] = useState<RunManifest | undefined>()
  const [events, setEvents] = useState(mockEvents.map((item) => JSON.stringify(item)).join('\n'))
  const [trace, setTrace] = useState(mockTrace.map((item) => JSON.stringify(item)).join('\n'))
  const [notice, setNotice] = useState<Notice>({ type: 'info', text: 'Mock data is active.' })
  const [busy, setBusy] = useState<string | null>(null)

  const api = useMemo(() => new LightFlowApi(baseUrl), [baseUrl])
  const selectedWorkflow = assets.workflows.find((asset) => asset.id === selectedWorkflowId) ?? assets.workflows[0]
  const status = summarizeRun(manifest)
  const activeAssets = assets[tab]

  function runRequest(): CreateRunRequest {
    return {
      workflow_asset_id: selectedWorkflowId,
      run_id: runId.trim() || undefined,
      inputs: safeJson(inputs)
    }
  }

  async function withBusy<T>(key: string, action: () => Promise<T>, success: string): Promise<T | undefined> {
    setBusy(key)
    try {
      const result = await action()
      setNotice({ type: 'success', text: success })
      return result
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : String(error) })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function syncAssets() {
    if (mode === 'mock') {
      setAssets(mockAssets)
      setNotice({ type: 'success', text: 'Mock assets refreshed.' })
      return
    }

    await withBusy(
      'sync',
      async () => {
        const next = await api.assets()
        setAssets(next)
        if (!next.workflows.some((asset) => asset.id === selectedWorkflowId) && next.workflows[0]) {
          setSelectedWorkflowId(next.workflows[0].id)
        }
      },
      'Assets loaded from LightFlow API.'
    )
  }

  async function previewRun() {
    await withBusy(
      'preview',
      async () => {
        const request = runRequest()
        const next = mode === 'mock' ? createMockPreview(request) : await api.previewRun(request)
        setPreview(next)
      },
      'Run preview is ready.'
    )
  }

  async function createRun() {
    await withBusy(
      'create',
      async () => {
        const request = runRequest()
        const next = mode === 'mock' ? createMockManifest(request) : await api.createRun(request)
        setManifest(next)
      },
      'Run manifest created.'
    )
  }

  async function submitStep(stepId: string) {
    if (!manifest) return
    await withBusy(
      `submit:${stepId}`,
      async () => {
        const next = mode === 'mock' ? submitMockStep(manifest, stepId) : await api.submitStep(manifest.run_id, stepId)
        setManifest(next)
      },
      `${stepId} submitted.`
    )
  }

  async function refreshRun() {
    if (!manifest) return
    await withBusy(
      'refresh',
      async () => {
        const next = mode === 'mock' ? refreshMockRun(manifest) : await api.refreshRun(manifest.run_id)
        setManifest(next)
        if (mode === 'live') {
          const [eventText, traceText] = await Promise.all([api.events(next.run_id), api.trace(next.run_id)])
          setEvents(eventText)
          setTrace(traceText)
        }
      },
      'Run state refreshed.'
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <strong>LightFlowUI</strong>
            <span>Workflow console</span>
          </div>
        </div>

        <div className="mode-switch" role="group" aria-label="Runtime mode">
          <button className={mode === 'mock' ? 'active' : ''} onClick={() => setMode('mock')}>
            <Boxes size={15} />
            Mock
          </button>
          <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>
            <Server size={15} />
            Live
          </button>
        </div>

        <label className="field-label" htmlFor="api-url">
          API Endpoint
        </label>
        <div className="endpoint-row">
          <Globe2 size={16} />
          <input id="api-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </div>

        <nav className="asset-tabs" aria-label="Asset type">
          {tabs.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                <Icon size={16} />
                {item.label}
                <span>{assets[item.id].length}</span>
              </button>
            )
          })}
        </nav>

        <button className="wide-action" onClick={syncAssets} disabled={busy === 'sync'}>
          {busy === 'sync' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          Sync assets
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Selected workflow</p>
            <h1>{selectedWorkflow?.title ?? 'No workflow selected'}</h1>
          </div>
          <div className={`notice ${notice.type}`}>{notice.text}</div>
        </header>

        <section className="content-grid">
          <div className="asset-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Assets</p>
                <h2>{tabs.find((item) => item.id === tab)?.label}</h2>
              </div>
              <Settings2 size={18} />
            </div>
            <div className="asset-list">
              {activeAssets.map((asset) => (
                <button
                  key={asset.id}
                  className={`asset-row ${asset.id === selectedWorkflowId ? 'selected' : ''}`}
                  onClick={() => {
                    if (asset.kind === 'Workflow') setSelectedWorkflowId(asset.id)
                  }}
                >
                  <span className={`asset-kind ${kindTone[asset.kind]}`}>{asset.kind}</span>
                  <strong>{asset.title}</strong>
                  <small>{asset.id}</small>
                  <p>{asset.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="graph-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Preview graph</p>
                <h2>{preview.definition.title}</h2>
              </div>
              <GitBranch size={18} />
            </div>
            <WorkflowGraph preview={preview} manifest={manifest} />
          </div>

          <div className="run-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Run planner</p>
                <h2>Request</h2>
              </div>
              <ClipboardList size={18} />
            </div>
            <label className="field-label" htmlFor="run-id">
              Run ID
            </label>
            <input id="run-id" className="text-input" value={runId} onChange={(event) => setRunId(event.target.value)} />

            <label className="field-label" htmlFor="inputs">
              Inputs JSON
            </label>
            <textarea id="inputs" value={inputs} onChange={(event) => setInputs(event.target.value)} />

            <div className="button-row">
              <button onClick={previewRun} disabled={busy === 'preview'}>
                {busy === 'preview' ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                Preview
              </button>
              <button onClick={createRun} disabled={busy === 'create'}>
                {busy === 'create' ? <Loader2 size={16} className="spin" /> : <Activity size={16} />}
                Create run
              </button>
            </div>
          </div>

          <div className="manifest-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Run state</p>
                <h2>{manifest?.run_id ?? 'No manifest'}</h2>
              </div>
              <Braces size={18} />
            </div>

            <div className="status-strip">
              <div>
                <span>Status</span>
                <strong className={`state ${status?.status ?? 'planned'}`}>
                  {statusIcon(status?.status)}
                  {status?.status ?? 'idle'}
                </strong>
              </div>
              <div>
                <span>Steps</span>
                <strong>{status?.total_steps ?? preview.steps.length}</strong>
              </div>
              <div>
                <span>Done</span>
                <strong>{status?.succeeded_steps ?? 0}</strong>
              </div>
            </div>

            <div className="step-list">
              {(manifest?.steps ?? preview.steps).map((step) => {
                const statusValue = 'status' in step ? step.status : 'planned'
                const stepId = step.step_id
                return (
                  <div key={stepId} className="step-row">
                    <span className={`step-status ${statusValue}`}>{statusIcon(statusValue)}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <small>{'target' in step ? formatTarget(step.target) : step.cortex_request_path}</small>
                    </div>
                    {'status' in step && step.status === 'planned' ? (
                      <button onClick={() => submitStep(step.step_id)} disabled={busy === `submit:${step.step_id}`}>
                        {busy === `submit:${step.step_id}` ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <button className="wide-action" disabled={!manifest || busy === 'refresh'} onClick={refreshRun}>
              {busy === 'refresh' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              Refresh run
            </button>
          </div>

          <div className="streams-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">Streams</p>
                <h2>Events & trace</h2>
              </div>
              <TerminalSquare size={18} />
            </div>
            <div className="stream-grid">
              <pre>{events}</pre>
              <pre>{trace}</pre>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function WorkflowGraph({ preview, manifest }: { preview: RunPreview; manifest?: RunManifest }) {
  const width = 720
  const height = 260
  const nodes = preview.steps.map((step, index) => ({
    ...step,
    x: 86 + index * 250,
    y: index % 2 === 0 ? 74 : 152,
    status: manifest?.steps.find((item) => item.step_id === step.step_id)?.status ?? 'planned'
  }))

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Workflow execution graph">
        <defs>
          <linearGradient id="flowLine" x1="0" x2="1">
            <stop offset="0%" stopColor="#1f7aec" />
            <stop offset="100%" stopColor="#13a879" />
          </linearGradient>
        </defs>
        {nodes.slice(0, -1).map((node, index) => {
          const next = nodes[index + 1]
          return (
            <path
              key={`${node.step_id}-${next.step_id}`}
              d={`M ${node.x + 86} ${node.y + 32} C ${node.x + 145} ${node.y + 32}, ${next.x - 58} ${next.y + 32}, ${next.x} ${next.y + 32}`}
              fill="none"
              stroke="url(#flowLine)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )
        })}
        {nodes.map((node) => (
          <g key={node.step_id} transform={`translate(${node.x}, ${node.y})`}>
            <rect className={`graph-node ${node.status}`} width="172" height="70" rx="8" />
            <text x="16" y="27" className="graph-title">
              {node.title}
            </text>
            <text x="16" y="50" className="graph-subtitle">
              {formatTarget(node.target)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

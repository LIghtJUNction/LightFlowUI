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
  Languages,
  Layers3,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Send,
  Server,
  Settings2,
  Sparkles,
  Sun,
  TerminalSquare,
  Workflow,
  XCircle
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
type Locale = 'en' | 'zh'
type Theme = 'light' | 'dark'
type Notice = { type: 'info' | 'error' | 'success'; text: string }

const tabDefs: Array<{ id: AssetTab; labelKey: 'workflows' | 'nodes' | 'compositions' | 'models'; icon: typeof Workflow }> = [
  { id: 'workflows', labelKey: 'workflows', icon: Workflow },
  { id: 'nodes', labelKey: 'nodes', icon: CircleDot },
  { id: 'compositions', labelKey: 'compositions', icon: Layers3 },
  { id: 'models', labelKey: 'models', icon: Database }
]

const kindTone: Record<AssetKind, string> = {
  Workflow: 'tone-blue',
  Node: 'tone-green',
  Composition: 'tone-amber',
  Model: 'tone-violet'
}

const dictionaries = {
  en: {
    workflowConsole: 'Workflow console',
    runtimeMode: 'Runtime mode',
    mock: 'Mock',
    live: 'Live',
    apiEndpoint: 'API Endpoint',
    workflows: 'Workflows',
    nodes: 'Nodes',
    compositions: 'Compositions',
    models: 'Models',
    syncAssets: 'Sync assets',
    selectedWorkflow: 'Selected workflow',
    noWorkflow: 'No workflow selected',
    assets: 'Assets',
    previewGraph: 'Preview graph',
    runPlanner: 'Run planner',
    request: 'Request',
    runId: 'Run ID',
    inputsJson: 'Inputs JSON',
    preview: 'Preview',
    createRun: 'Create run',
    runState: 'Run state',
    noManifest: 'No manifest',
    status: 'Status',
    steps: 'Steps',
    done: 'Done',
    refreshRun: 'Refresh run',
    streams: 'Streams',
    eventsTrace: 'Events & trace',
    theme: 'Theme',
    language: 'Language',
    light: 'Light',
    dark: 'Dark',
    english: 'English',
    chinese: '中文',
    idle: 'idle',
    planned: 'planned',
    submitted: 'submitted',
    running: 'running',
    succeeded: 'succeeded',
    failed: 'failed',
    kind: {
      Workflow: 'Workflow',
      Node: 'Node',
      Composition: 'Composition',
      Model: 'Model'
    },
    notice: {
      mockActive: 'Mock data is active.',
      mockRefreshed: 'Mock assets refreshed.',
      assetsLoaded: 'Assets loaded from LightFlow API.',
      previewReady: 'Run preview is ready.',
      manifestCreated: 'Run manifest created.',
      submitted: (stepId: string) => `${stepId} submitted.`,
      refreshed: 'Run state refreshed.'
    },
    errors: {
      inputsObject: 'Inputs must be a JSON object.'
    }
  },
  zh: {
    workflowConsole: '工作流控制台',
    runtimeMode: '运行模式',
    mock: '模拟',
    live: '实时',
    apiEndpoint: 'API 地址',
    workflows: '工作流',
    nodes: '节点',
    compositions: '组合',
    models: '模型',
    syncAssets: '同步资产',
    selectedWorkflow: '当前工作流',
    noWorkflow: '未选择工作流',
    assets: '资产',
    previewGraph: '预览图',
    runPlanner: 'Run 规划',
    request: '请求',
    runId: 'Run ID',
    inputsJson: '输入 JSON',
    preview: '预览',
    createRun: '创建 Run',
    runState: 'Run 状态',
    noManifest: '无 manifest',
    status: '状态',
    steps: '步骤',
    done: '完成',
    refreshRun: '刷新 Run',
    streams: '流',
    eventsTrace: '事件与 trace',
    theme: '主题',
    language: '语言',
    light: '亮色',
    dark: '暗色',
    english: 'English',
    chinese: '中文',
    idle: '空闲',
    planned: '已规划',
    submitted: '已提交',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    kind: {
      Workflow: '工作流',
      Node: '节点',
      Composition: '组合',
      Model: '模型'
    },
    notice: {
      mockActive: '当前使用模拟数据。',
      mockRefreshed: '模拟资产已刷新。',
      assetsLoaded: '已从 LightFlow API 加载资产。',
      previewReady: 'Run 预览已生成。',
      manifestCreated: 'Run manifest 已创建。',
      submitted: (stepId: string) => `${stepId} 已提交。`,
      refreshed: 'Run 状态已刷新。'
    },
    errors: {
      inputsObject: 'Inputs 必须是 JSON 对象。'
    }
  }
} as const

function storedChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const value = localStorage.getItem(key)
  return allowed.includes(value as T) ? (value as T) : fallback
}

function safeJson(value: string, errorMessage: string): Record<string, unknown> {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(errorMessage)
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
  const [locale, setLocale] = useState<Locale>(() => storedChoice('lightflow-ui-locale', 'en', ['en', 'zh']))
  const [theme, setTheme] = useState<Theme>(() => storedChoice('lightflow-ui-theme', 'light', ['light', 'dark']))
  const [mode, setMode] = useState<Mode>('mock')
  const [baseUrl, setBaseUrl] = useState('http://localhost:5174')
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
  const [notice, setNotice] = useState<Notice>({ type: 'info', text: dictionaries.en.notice.mockActive })
  const [busy, setBusy] = useState<string | null>(null)

  const t = dictionaries[locale]
  const api = useMemo(() => new LightFlowApi(baseUrl), [baseUrl])
  const selectedWorkflow = assets.workflows.find((asset) => asset.id === selectedWorkflowId) ?? assets.workflows[0]
  const status = summarizeRun(manifest)
  const activeAssets = assets[tab]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    localStorage.setItem('lightflow-ui-theme', theme)
    localStorage.setItem('lightflow-ui-locale', locale)
  }, [theme, locale])

  useEffect(() => {
    setNotice((current) =>
      current.type === 'info' || current.text === dictionaries.en.notice.mockActive || current.text === dictionaries.zh.notice.mockActive
        ? { type: 'info', text: t.notice.mockActive }
        : current
    )
  }, [t])

  function runRequest(): CreateRunRequest {
    return {
      workflow_asset_id: selectedWorkflowId,
      run_id: runId.trim() || undefined,
      inputs: safeJson(inputs, t.errors.inputsObject)
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
      setNotice({ type: 'success', text: t.notice.mockRefreshed })
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
      t.notice.assetsLoaded
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
      t.notice.previewReady
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
      t.notice.manifestCreated
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
      t.notice.submitted(stepId)
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
      t.notice.refreshed
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
            <span>{t.workflowConsole}</span>
          </div>
        </div>

        <div className="mode-switch" role="group" aria-label={t.runtimeMode}>
          <button className={mode === 'mock' ? 'active' : ''} onClick={() => setMode('mock')}>
            <Boxes size={15} />
            {t.mock}
          </button>
          <button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>
            <Server size={15} />
            {t.live}
          </button>
        </div>

        <div className="prefs-grid">
          <button
            className="pref-button"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={t.theme}
            aria-label={t.theme}
          >
            {theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'light' ? t.light : t.dark}
          </button>
          <button
            className="pref-button"
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            title={t.language}
            aria-label={t.language}
          >
            <Languages size={16} />
            {locale === 'en' ? t.english : t.chinese}
          </button>
        </div>

        <label className="field-label" htmlFor="api-url">
          {t.apiEndpoint}
        </label>
        <div className="endpoint-row">
          <Globe2 size={16} />
          <input id="api-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </div>

        <nav className="asset-tabs" aria-label={t.assets}>
          {tabDefs.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                <Icon size={16} />
                {t[item.labelKey]}
                <span>{assets[item.id].length}</span>
              </button>
            )
          })}
        </nav>

        <button className="wide-action" onClick={syncAssets} disabled={busy === 'sync'}>
          {busy === 'sync' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          {t.syncAssets}
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.selectedWorkflow}</p>
            <h1>{selectedWorkflow?.title ?? t.noWorkflow}</h1>
          </div>
          <div className={`notice ${notice.type}`}>{notice.text}</div>
        </header>

        <section className="content-grid">
          <div className="asset-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">{t.assets}</p>
                <h2>{t[tabDefs.find((item) => item.id === tab)?.labelKey ?? 'workflows']}</h2>
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
                  <span className={`asset-kind ${kindTone[asset.kind]}`}>{t.kind[asset.kind]}</span>
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
                <p className="eyebrow">{t.previewGraph}</p>
                <h2>{preview.definition.title}</h2>
              </div>
              <GitBranch size={18} />
            </div>
            <WorkflowGraph preview={preview} manifest={manifest} />
          </div>

          <div className="run-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">{t.runPlanner}</p>
                <h2>{t.request}</h2>
              </div>
              <ClipboardList size={18} />
            </div>
            <label className="field-label" htmlFor="run-id">
              {t.runId}
            </label>
            <input id="run-id" className="text-input" value={runId} onChange={(event) => setRunId(event.target.value)} />

            <label className="field-label" htmlFor="inputs">
              {t.inputsJson}
            </label>
            <textarea id="inputs" value={inputs} onChange={(event) => setInputs(event.target.value)} />

            <div className="button-row">
              <button onClick={previewRun} disabled={busy === 'preview'}>
                {busy === 'preview' ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                {t.preview}
              </button>
              <button onClick={createRun} disabled={busy === 'create'}>
                {busy === 'create' ? <Loader2 size={16} className="spin" /> : <Activity size={16} />}
                {t.createRun}
              </button>
            </div>
          </div>

          <div className="manifest-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">{t.runState}</p>
                <h2>{manifest?.run_id ?? t.noManifest}</h2>
              </div>
              <Braces size={18} />
            </div>

            <div className="status-strip">
              <div>
                <span>{t.status}</span>
                <strong className={`state ${status?.status ?? 'planned'}`}>
                  {statusIcon(status?.status)}
                  {status ? t[status.status] : t.idle}
                </strong>
              </div>
              <div>
                <span>{t.steps}</span>
                <strong>{status?.total_steps ?? preview.steps.length}</strong>
              </div>
              <div>
                <span>{t.done}</span>
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
              {t.refreshRun}
            </button>
          </div>

          <div className="streams-pane">
            <div className="pane-header">
              <div>
                <p className="eyebrow">{t.streams}</p>
                <h2>{t.eventsTrace}</h2>
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

import type {
  AssetList,
  AssetState,
  CreateRunRequest,
  RunList,
  RunManifest,
  RunPreview,
  RunStatusSummary
} from './types'

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

async function requestText(baseUrl: string, path: string): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  return response.text()
}

export class LightFlowApi {
  constructor(private readonly baseUrl: string) {}

  async assets(): Promise<AssetState> {
    const [workflows, nodes, compositions, models] = await Promise.all([
      requestJson<AssetList>(this.baseUrl, '/workflows'),
      requestJson<AssetList>(this.baseUrl, '/nodes'),
      requestJson<AssetList>(this.baseUrl, '/compositions'),
      requestJson<AssetList>(this.baseUrl, '/models')
    ])

    return {
      workflows: workflows.assets,
      nodes: nodes.assets,
      compositions: compositions.assets,
      models: models.assets
    }
  }

  previewRun(request: CreateRunRequest): Promise<RunPreview> {
    return requestJson<RunPreview>(this.baseUrl, '/runs/preview', {
      method: 'POST',
      body: JSON.stringify(request)
    })
  }

  createRun(request: CreateRunRequest): Promise<RunManifest> {
    return requestJson<RunManifest>(this.baseUrl, '/runs', {
      method: 'POST',
      body: JSON.stringify(request)
    })
  }

  listRuns(): Promise<RunList> {
    return requestJson<RunList>(this.baseUrl, '/runs')
  }

  status(runId: string): Promise<RunStatusSummary> {
    return requestJson<RunStatusSummary>(this.baseUrl, `/runs/${encodeURIComponent(runId)}/status`)
  }

  submitStep(runId: string, stepId: string, body?: Record<string, unknown>): Promise<RunManifest> {
    return requestJson<RunManifest>(
      this.baseUrl,
      `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/submit`,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined
      }
    )
  }

  refreshRun(runId: string): Promise<RunManifest> {
    return requestJson<RunManifest>(this.baseUrl, `/runs/${encodeURIComponent(runId)}/refresh`, {
      method: 'POST'
    })
  }

  events(runId: string): Promise<string> {
    return requestText(this.baseUrl, `/runs/${encodeURIComponent(runId)}/events`)
  }

  trace(runId: string): Promise<string> {
    return requestText(this.baseUrl, `/runs/${encodeURIComponent(runId)}/trace`)
  }
}

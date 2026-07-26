import { state } from "./app-state.js";

export async function apiGet(path) {
  const response = await fetch(`${state.apiBase}${path}`);
  return readResponse(response);
}

export async function apiPost(path, body) {
  const response = await fetch(`${state.apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse(response);
}

export async function apiDelete(path) {
  const response = await fetch(`${state.apiBase}${path}`, { method: "DELETE" });
  return readResponse(response);
}

/**
 * Structured API failure that preserves run history handles from the backend.
 * Failed workflow runs include run_id / run_dir / trace_path for inspect/replay.
 */
export class ApiError extends Error {
  constructor(body, status) {
    const message =
      (body && (body.message || body.error)) || `${status} request failed`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.run_id = body?.run_id;
    this.run_dir = body?.run_dir;
    this.trace_path = body?.trace_path;
    this.body = body || {};
  }
}

async function readResponse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON bodies (proxy error pages, plain-text panics) must not
      // mask the HTTP status behind a SyntaxError.
      body = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    throw new ApiError(body, response.status);
  }
  return body;
}

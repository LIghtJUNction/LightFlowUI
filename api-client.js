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

async function readResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

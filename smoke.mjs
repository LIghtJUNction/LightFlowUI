import {
  requireArray,
  requireBoolean,
  requireCommandArray,
  requireEqual,
  requireErrorContaining,
  requireExecutor,
  requireIncludes,
  requireIssueContaining,
  requireModel,
  requireNode,
  requireNumber,
  requireObject,
  requireString,
  validateLoopReport,
  validatePublishCatalog,
  validateReleaseReport,
  validateReplayResponse,
  validateRunEvents,
  validateRunTrace,
} from "./smoke-validators.mjs";

const apiBase = (process.argv[2] || "http://127.0.0.1:5174").replace(/\/+$/, "");
const workflowId = process.argv[3] || "lightflow.text_plan";
const context = {
  lastRunId: "",
  replayRunId: "",
};

const checks = [
  ["nodes", "/nodes", (body) => {
    requireArray(body, "nodes");
    requireArray(body, "categories");
    requireNode(body.nodes[0], "nodes[0]");
  }],
  ["executors", "/executors", (body) => {
    requireArray(body, "executors");
    requireExecutor(body.executors[0], "executors[0]");
  }],
  ["models", "/models", (body) => {
    requireNumber(body, "total");
    requireArray(body, "models");
    requireArray(body, "issues");
    requireModel(body.models[0], "models[0]");
  }],
  ["blocked models", "/models?status=blocked", (body) => {
    requireNumber(body, "total");
    requireArray(body, "models");
    requireArray(body, "issues");
  }],
  ["runs", "/runs", (body) => {
    requireArray(body, "runs");
    requireNumber(body, "total");
    if (body.last || body.runs[0]?.run_id) {
      context.lastRunId = body.last || body.runs[0].run_id;
    }
    const replayable = body.runs.find((run) => run.status === "completed");
    if (replayable?.run_id) {
      context.replayRunId = replayable.run_id;
    }
  }],
  ["limited runs", "/runs?limit=1", (body) => {
    requireArray(body, "runs");
    requireNumber(body, "total");
  }],
  ["artifacts", "/artifacts", (body) => requireArray(body, "artifacts")],
  ["patches", "/patches", (body) => requireArray(body, "patches")],
  ["loop", "/loop", (body) => validateLoopReport(body)],
  ["loop changes", "/loop/changes", (body) => {
    requireBoolean(body, "valid");
    requireArray(body, "changed_workflows");
    requireArray(body, "issues");
    requireArray(body, "blockers");
  }],
  ["loop projects", "/loop/projects", (body) => {
    requireBoolean(body, "valid");
    requireArray(body, "workspaces");
    requireNumber(body, "linked_count");
  }],
  ["publish", "/publish", validatePublishCatalog],
  ["release", "/release", (body) => validateReleaseReport(body)],
  ["workflow", `/workflows/${encodeURIComponent(workflowId)}`, (body) => {
    requireEqual(body, "id", workflowId);
    requireArray(body, "inputs");
    requireArray(body, "outputs");
  }],
  ["workflow plan", `/workflows/${encodeURIComponent(workflowId)}/plan`, (body) => {
    requireEqual(body, "workflow_id", workflowId);
    requireString(body, "kind");
  }],
  ["workflow loop", `/workflows/${encodeURIComponent(workflowId)}/loop`, (body) => {
    validateLoopReport(body, workflowId);
    requireEqual(body, "workflow_id", workflowId);
  }],
  ["strict workflow loop", `/workflows/${encodeURIComponent(workflowId)}/loop?require_replay=true`, (body) => {
    validateLoopReport(body, workflowId);
    requireEqual(body, "workflow_id", workflowId);
  }],
  ["workflow publish", `/workflows/${encodeURIComponent(workflowId)}/publish`, (body) => {
    requireEqual(body, "workflow_id", workflowId);
    requireBoolean(body, "publishable");
    requireArray(body, "issues");
    requireCommandArray(body, "command");
    requireIncludes(body.command, "cargo", "workflow publish command");
    requireIncludes(body.command, "publish", "workflow publish command");
    requireIncludes(body.command, "--dry-run", "workflow publish command");
  }],
  ["workflow release", `/release?workflow_id=${encodeURIComponent(workflowId)}`, (body) => {
    validateReleaseReport(body, workflowId);
    requireEqual(body, "workflow_id", workflowId);
  }],
];

const postChecks = [
  ["patch validation", `/patches/validate?workflow_id=${encodeURIComponent(workflowId)}`, { nodes: {} }, (body) => {
    requireBoolean(body, "valid");
    requireEqual(body, "valid", false);
    requireArray(body, "issues");
    requireObject(body, "patch");
  }],
  [
    "selected patch validation rejects unknown node",
    `/patches/validate?workflow_id=${encodeURIComponent(workflowId)}`,
    { nodes: { "smoke.missing": { disable: true } } },
    (body) => {
      requireBoolean(body, "valid");
      requireEqual(body, "valid", false);
      requireArray(body, "issues");
      requireIssueContaining(body.issues, "does not match any node");
      requireObject(body, "patch");
    },
  ],
  [
    "workflow run rejects invalid patch",
    `/workflows/${encodeURIComponent(workflowId)}/run`,
    {
      inputs: { value: "smoke invalid patch" },
      patch: { nodes: { "smoke.missing": { disable: true } } },
    },
    (body, response) => {
      if (response.ok) {
        throw new Error("invalid patched workflow run must not succeed");
      }
      requireErrorContaining(body, "does not match any node");
    },
    false,
  ],
];

const results = [];
for (const [name, path, validate] of checks) {
  const started = Date.now();
  try {
    const response = await fetch(`${apiBase}${path}`);
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
    }
    validate(body);
    results.push({ name, path, ok: true, status: response.status, ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      path,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error.message,
    });
  }
}

if (context.lastRunId) {
  await runGetCheck("last run trace", "/runs/last", (body) => {
    validateRunTrace(body);
    requireEqual(body, "run_id", context.lastRunId);
  });
  await runGetCheck("last run events", "/runs/last/events", (body) => {
    validateRunEvents(body);
    requireEqual(body, "run_id", context.lastRunId);
  });
}

if (context.replayRunId) {
  await runReplayCheck(context.replayRunId);
}

for (const [name, path, requestBody, validate, expectedOk = true] of postChecks) {
  const started = Date.now();
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (expectedOk && !response.ok) {
      throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
    }
    if (!expectedOk && response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    validate(body, response);
    results.push({ name, path, ok: true, status: response.status, ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      path,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error.message,
    });
  }
}

const failed = results.filter((result) => !result.ok);
console.table(results);
if (failed.length) {
  console.error(`LightFlowUI smoke failed: ${failed.length} endpoint(s) failed`);
  process.exit(1);
}

console.log(`LightFlowUI smoke passed for ${apiBase} (${workflowId})`);

async function runGetCheck(name, path, validate) {
  const started = Date.now();
  try {
    const response = await fetch(`${apiBase}${path}`);
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
    }
    validate(body, response);
    results.push({ name, path, ok: true, status: response.status, ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      path,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error.message,
    });
  }
}

async function runReplayCheck(runId) {
  let replayedRunId = "";
  await runPostCheck(
    "replay completed run",
    `/runs/${encodeURIComponent(runId)}/replay`,
    {},
    (body) => {
      validateReplayResponse(body, runId);
      replayedRunId = body.run_id;
    },
  );
  if (!replayedRunId) {
    return;
  }
  await runGetCheck("replayed run trace", `/runs/${encodeURIComponent(replayedRunId)}`, (body) => {
    validateRunTrace(body);
    requireEqual(body, "run_id", replayedRunId);
    requireObject(body.execution, "replay");
    requireEqual(body.execution, "replayed_from", runId);
  });
  await runDeleteCheck("cleanup replayed run", `/runs/${encodeURIComponent(replayedRunId)}`, (body) => {
    requireEqual(body, "run_id", replayedRunId);
    requireBoolean(body, "removed");
    requireEqual(body, "removed", true);
  });
}

async function runPostCheck(name, path, requestBody, validate) {
  const started = Date.now();
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
    }
    validate(body, response);
    results.push({ name, path, ok: true, status: response.status, ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      path,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error.message,
    });
  }
}

async function runDeleteCheck(name, path, validate) {
  const started = Date.now();
  try {
    const response = await fetch(`${apiBase}${path}`, { method: "DELETE" });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
    }
    validate(body, response);
    results.push({ name, path, ok: true, status: response.status, ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      path,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error.message,
    });
  }
}

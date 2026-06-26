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

function validateLoopReport(body, expectedWorkflowId) {
  requireBoolean(body, "valid");
  requireArray(body, "checks");
  requireArray(body, "issues");
  requireArray(body, "warning_messages");
  requireNumber(body, "passed");
  requireNumber(body, "warnings");
  requireNumber(body, "failed");
  requireArray(body, "next_commands");
  if (!body.next_commands.length) {
    throw new Error("loop report must include next_commands");
  }
  for (const command of body.next_commands) {
    requireCommandValue(command, "loop next command");
  }
  requireCommandStartingWith(body.next_commands, ["lfw", "loop", "changes"], "loop next_commands");
  requireCommandStartingWith(body.next_commands, ["lfw", "loop", "projects"], "loop next_commands");
  if (expectedWorkflowId) {
    requireCommandStartingWith(body.next_commands, ["lfw", "publish", expectedWorkflowId], "workflow loop next_commands");
  } else {
    requireCommandStartingWith(body.next_commands, ["lfw", "publish", "--workflows"], "project loop next_commands");
  }
}

function validatePublishCatalog(body) {
  requireBoolean(body, "publishable");
  requireArray(body, "checks");
  requireArray(body, "commands");
  requireArray(body, "issues");
  requireNumber(body, "total");
  requireNumber(body, "publishable_count");
  requireNumber(body, "blocked_count");
  if (body.total > 0 && !body.commands.length) {
    throw new Error("publish catalog with workflow crates must include commands");
  }
  for (const command of body.commands) {
    requireCommandValue(command, "publish catalog command");
    requireIncludes(command, "cargo", "publish catalog command");
    requireIncludes(command, "publish", "publish catalog command");
    requireIncludes(command, "--dry-run", "publish catalog command");
  }
  requirePublishCheck(body.checks[0], "checks[0]");
}

function validateReleaseReport(body, expectedWorkflowId) {
  requireBoolean(body, "dry_run");
  requireBoolean(body, "valid");
  requireArray(body, "checks");
  requireArray(body, "issues");
  requireArray(body, "warnings");
  requireNumber(body, "passed");
  requireNumber(body, "warning_count");
  requireNumber(body, "failed");
  requireNumber(body, "planned");
  requireNumber(body, "skipped");
  const commands = body.checks.filter((check) => Array.isArray(check.command));
  if (!commands.length) {
    throw new Error("release checks must include command gates");
  }
  for (const check of commands) {
    requireString(check, "id");
    requireEqual(check, "kind", "command");
    requireString(check, "status");
    requireString(check, "message");
    requireNonEmptyArray(check, "command");
  }
  if (expectedWorkflowId) {
    const selectedLoop = commands.find((check) => check.id === "release.command.selected_workflow_loop");
    if (!selectedLoop) {
      throw new Error("release checks must include release.command.selected_workflow_loop");
    }
    if (!selectedLoop.command.includes(expectedWorkflowId)) {
      throw new Error(`selected workflow loop command must include ${expectedWorkflowId}`);
    }
  }
}

function validateRunTrace(body) {
  requireString(body, "run_id");
  requireString(body, "run_dir");
  requireObject(body, "manifest");
  requireObject(body, "execution");
  requireArray(body, "events");
  requireEqual(body.manifest, "run_id", body.run_id);
}

function validateRunEvents(body) {
  requireString(body, "run_id");
  requireArray(body, "events");
  if (body.events.length) {
    requireString(body.events[0], "event");
  }
}

function validateReplayResponse(body, replayedFrom) {
  requireString(body, "run_id");
  requireString(body, "run_dir");
  requireString(body, "trace_path");
  requireEqual(body, "replayed_from", replayedFrom);
  requireObject(body, "replay");
  requireBoolean(body.replay, "runtime_changed");
  requireBoolean(body.replay, "model_lock_changed");
  requireArray(body.replay, "original_runtime");
  requireArray(body.replay, "replayed_runtime");
  if (body.run_id === replayedFrom) {
    throw new Error("replay must create a new run id");
  }
}

function requireNode(value, path) {
  if (value === undefined) {
    return;
  }
  if (typeof value.id !== "string") {
    throw new Error(`${path}.id must be a string`);
  }
  if (typeof value.name !== "string") {
    throw new Error(`${path}.name must be a string`);
  }
  if (!Array.isArray(value.inputs)) {
    throw new Error(`${path}.inputs must be an array`);
  }
  if (!Array.isArray(value.outputs)) {
    throw new Error(`${path}.outputs must be an array`);
  }
  if (!Array.isArray(value.models)) {
    throw new Error(`${path}.models must be an array`);
  }
  if (!Array.isArray(value.runtimes)) {
    throw new Error(`${path}.runtimes must be an array`);
  }
}

function requireModel(value, path) {
  if (value === undefined) {
    return;
  }
  requireArray(value, "sync_command");
  requireArray(value, "verify_command");
  requireString(value, "workflow_id");
  requireString(value, "workflow_name");
}

function requireExecutor(value, path) {
  if (value === undefined) {
    return;
  }
  requireString(value, "id");
  requireString(value, "kind");
  requireString(value, "status");
  requireString(value, "status_reason");
  requireArray(value, "capabilities");
  requireBoolean(value, "available");
  requireString(value, "data_policy");
  requireBoolean(value, "plans_models");
}

function requirePublishCheck(value, path) {
  if (value === undefined) {
    return;
  }
  requireString(value, "workspace");
  requireString(value, "workflow_id");
  requireString(value, "package");
  requireBoolean(value, "publishable");
  requireArray(value, "internal_dependencies");
  requireCommandArray(value, "command");
  requireArray(value, "issues");
}

function requireString(body, path) {
  const value = atPath(body, path);
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

function requireNumber(body, path) {
  const value = atPath(body, path);
  if (typeof value !== "number") {
    throw new Error(`${path} must be a number`);
  }
}

function requireBoolean(body, path) {
  const value = atPath(body, path);
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
}

function requireArray(body, path) {
  const value = atPath(body, path);
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
}

function requireNonEmptyArray(body, path) {
  const value = atPath(body, path);
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${path} must be a non-empty array`);
  }
}

function requireCommandArray(body, path) {
  const value = atPath(body, path);
  requireCommandValue(value, path);
}

function requireCommandValue(value, path) {
  if (!Array.isArray(value) || !value.length || value.some((part) => typeof part !== "string" || !part)) {
    throw new Error(`${path} must be a non-empty string array`);
  }
}

function requireIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(`${label} must include ${expected}`);
  }
}

function requireCommandStartingWith(commands, expectedPrefix, label) {
  const found = commands.some((command) =>
    expectedPrefix.every((part, index) => command[index] === part)
  );
  if (!found) {
    throw new Error(`${label} must include ${expectedPrefix.join(" ")}`);
  }
}

function requireObject(body, path) {
  const value = atPath(body, path);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function requireEqual(body, path, expected) {
  const value = atPath(body, path);
  if (value !== expected) {
    throw new Error(`${path} must be ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
}

function requireIssueContaining(issues, expected) {
  if (!Array.isArray(issues) || !issues.some((issue) => String(issue).includes(expected))) {
    throw new Error(`issues must include ${expected}`);
  }
}

function requireErrorContaining(body, expected) {
  const message = [body.message, body.error].filter(Boolean).join(" ");
  if (!message.includes(expected)) {
    throw new Error(`error response must include ${expected}`);
  }
}

function atPath(body, path) {
  return path.split(".").reduce((value, part) => value?.[part], body);
}

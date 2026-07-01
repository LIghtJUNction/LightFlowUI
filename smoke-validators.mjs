export function validateLoopReport(body, expectedWorkflowId) {
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

export function validatePublishCatalog(body) {
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

export function validateReleaseReport(body, expectedWorkflowId) {
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

export function validateRunTrace(body) {
  requireString(body, "run_id");
  requireString(body, "run_dir");
  requireObject(body, "manifest");
  requireObject(body, "execution");
  requireArray(body, "events");
  requireEqual(body.manifest, "run_id", body.run_id);
}

export function validateRunEvents(body) {
  requireString(body, "run_id");
  requireArray(body, "events");
  if (body.events.length) {
    requireString(body.events[0], "event");
  }
}

export function validateReplayResponse(body, replayedFrom) {
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

export function requireNode(value, path) {
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

export function requireModel(value, path) {
  if (value === undefined) {
    return;
  }
  requireArray(value, "sync_command");
  requireArray(value, "verify_command");
  requireString(value, "workflow_id");
  requireString(value, "workflow_name");
}

export function requireExecutor(value, path) {
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

export function requireString(body, path) {
  const value = atPath(body, path);
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

export function requireNumber(body, path) {
  const value = atPath(body, path);
  if (typeof value !== "number") {
    throw new Error(`${path} must be a number`);
  }
}

export function requireBoolean(body, path) {
  const value = atPath(body, path);
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
}

export function requireArray(body, path) {
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

export function requireCommandArray(body, path) {
  const value = atPath(body, path);
  requireCommandValue(value, path);
}

function requireCommandValue(value, path) {
  if (!Array.isArray(value) || !value.length || value.some((part) => typeof part !== "string" || !part)) {
    throw new Error(`${path} must be a non-empty string array`);
  }
}

export function requireIncludes(values, expected, label) {
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

export function requireObject(body, path) {
  const value = atPath(body, path);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

export function requireEqual(body, path, expected) {
  const value = atPath(body, path);
  if (value !== expected) {
    throw new Error(`${path} must be ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
}

export function requireIssueContaining(issues, expected) {
  if (!Array.isArray(issues) || !issues.some((issue) => String(issue).includes(expected))) {
    throw new Error(`issues must include ${expected}`);
  }
}

export function requireErrorContaining(body, expected) {
  const message = [body.message, body.error].filter(Boolean).join(" ");
  if (!message.includes(expected)) {
    throw new Error(`error response must include ${expected}`);
  }
}

function atPath(body, path) {
  return path.split(".").reduce((value, part) => value?.[part], body);
}

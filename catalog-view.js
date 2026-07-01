import { els, state } from "./app-state.js";
import { badge, el, emptyNode, metric, table } from "./ui-elements.js";

export function renderExecutors() {
  const summary = executorCatalogSummary();
  if (!state.executors.length) {
    els.executorList.replaceChildren(summary, emptyNode("No executors"));
    return;
  }
  els.executorList.replaceChildren(
    summary,
    table(
      [
        "Executor",
        "Status",
        "Capabilities",
        "Policy",
        "Models",
        "Activation",
        "Command",
      ],
      state.executors.map((executor) => [
        `${executor.id}\n${executor.kind}`,
        `${executor.available ? "available" : "unavailable"}\n${executor.status}\n${executor.status_reason}`,
        (executor.capabilities || []).join("\n"),
        executor.data_policy || "",
        executor.plans_models ? "plans models" : "no model plan",
        executorActivationText(executor),
        executor.command || "",
      ]),
    ),
  );
}

function executorCatalogSummary() {
  const executors = state.executors || [];
  const available = executors.filter((executor) => executor.available).length;
  const modelPlanners = executors.filter((executor) => executor.plans_models).length;
  const capabilities = new Set(executors.flatMap((executor) => executor.capabilities || []));
  return el("div", { className: "panel-summary" }, [
    el("div", { className: "inline-list" }, [
      badge(available ? "ok" : "warn", available ? "runtime paths ready" : "no executors ready"),
      badge(null, `${executors.length} executors`),
      badge("ok", `${available} available`),
      badge(null, `${capabilities.size} capabilities`),
      modelPlanners ? badge(null, `${modelPlanners} plan models`) : null,
    ].filter(Boolean)),
    el("div", { className: "meta-grid" }, [
      metric("Executors", String(executors.length)),
      metric("Available", String(available)),
      metric("Capabilities", String(capabilities.size)),
      metric("Model Planners", String(modelPlanners)),
    ]),
  ]);
}

function executorActivationText(executor) {
  return [
    executor.features?.length ? `features ${executor.features.join(", ")}` : "",
    executor.env ? `env ${executor.env}` : "",
  ].filter(Boolean).join("\n");
}

export function renderModels() {
  const summary = modelCatalogSummary();
  if (!state.models.length) {
    els.modelList.replaceChildren(
      el("div", { className: "detail-stack" }, [
        summary,
        emptyNode("No model requirements"),
      ]),
    );
    return;
  }
  els.modelList.replaceChildren(
    summary,
    table(
      [
        "Workflow",
        "Requirement",
        "Capability",
        "Lock",
        "Variant",
        "Format",
        "Hash",
        "Paths",
        "Commands",
        "Bindings",
      ],
      state.models.map((model) => [
        `${model.workflow_name}\n${model.workflow_id}`,
        model.requirement.id,
        model.requirement.capability,
        modelLockStatusText(model.lock),
        model.lock?.variant_id || variantsText(model.requirement),
        model.lock?.format || formatsText(model.requirement),
        modelHashText(model.lock),
        modelPathsText(model.lock),
        modelCommandsText(model),
        (model.bindings || []).map((binding) => `${binding.direction}:${binding.port}`).join("\n"),
      ]),
    ),
  );
}

function modelCatalogSummary() {
  const catalog = state.modelCatalog || {};
  const total = catalog.total ?? state.models.length;
  const available = catalog.available_count ?? state.models.filter((model) => model.lock?.status === "available").length;
  const blocked = catalog.blocked_count ?? Math.max(0, total - available);
  const filters = modelFilterSummary();
  return el("div", { className: "panel-summary" }, [
    el("div", { className: "inline-list" }, [
      badge(blocked ? "warn" : "ok", blocked ? "locks blocked" : "locks ready"),
      badge(null, `${total} requirements`),
      available ? badge("ok", `${available} available`) : null,
      blocked ? badge("warn", `${blocked} blocked`) : null,
      catalog.issues?.length ? badge("warn", `${catalog.issues.length} issues`) : null,
      ...filters,
    ]),
    el("div", { className: "meta-grid" }, [
      metric("Requirements", String(total)),
      metric("Available", String(available)),
      metric("Blocked", String(blocked)),
      metric("Issues", String(catalog.issues?.length || 0)),
    ]),
    catalog.issues?.length
      ? el("pre", { className: "compact-output" }, catalog.issues.join("\n"))
      : null,
  ]);
}

function modelFilterSummary() {
  const filters = state.modelFilters;
  return [
    filters.workflow ? badge(null, filters.workflow) : null,
    filters.status && filters.status !== "all" ? badge(null, filters.status) : null,
  ].filter(Boolean);
}

function modelLockStatusText(lock) {
  if (!lock) {
    return "unknown";
  }
  return [
    lock.status,
    lock.key,
    lock.repo,
    lock.file,
    lock.snapshot_revision ? `rev ${lock.snapshot_revision}` : "",
  ].filter(Boolean).join("\n");
}

function modelHashText(lock) {
  if (!lock) {
    return "";
  }
  return [lock.hash_algorithm, lock.sha256, lock.size_bytes ? `${lock.size_bytes} bytes` : ""]
    .filter(Boolean)
    .join("\n");
}

function modelPathsText(lock) {
  if (!lock) {
    return "";
  }
  const missing = (lock.missing_paths || []).map((path) => `missing ${path}`);
  const local = (lock.local_paths || []).map((path) => `local ${path}`);
  return [...missing, ...local].join("\n");
}

function modelCommandsText(model) {
  return [
    model.sync_command?.length ? `sync: ${model.sync_command.join(" ")}` : "",
    model.verify_command?.length ? `verify: ${model.verify_command.join(" ")}` : "",
  ].filter(Boolean).join("\n");
}

function variantsText(requirement) {
  return (requirement.variants || []).map((variant) => variant.id || variant.format).join("\n");
}

function formatsText(requirement) {
  return [...new Set((requirement.variants || []).map((variant) => variant.format))]
    .filter(Boolean)
    .join("\n");
}

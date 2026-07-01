import { apiDelete, apiGet, apiPost } from "./api-client.js";
import { renderExecutors, renderModels } from "./catalog-view.js";
import { configureLoopView, renderLoop } from "./loop-view.js";
import { els, state } from "./app-state.js";
import {
  badge,
  el,
  emptyNode,
  jsonBlock,
  kv,
  metric,
  option,
  panel,
  portList,
  runtimeList,
  sectionTitle,
  table,
} from "./ui-elements.js";

configureLoopView({ linkRunIds });

els.apiBase.value = state.apiBase;

els.connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.apiBase = els.apiBase.value.trim().replace(/\/+$/, "");
  localStorage.setItem("lightflow.apiBase", state.apiBase);
  loadAll();
});

els.nodeFilter.addEventListener("input", renderNodeList);
els.categoryFilter.addEventListener("change", renderNodeList);
els.modelFilterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.modelFilters = readModelFilters();
  refreshModels();
});
els.modelFilterReset.addEventListener("click", () => {
  state.modelFilters = { workflow: "", status: "all" };
  syncModelFilterInputs();
  refreshModels();
});
els.runFilterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.runFilters = readRunFilters();
  state.selectedRunId = null;
  refreshHistory();
});
els.runFilterReset.addEventListener("click", () => {
  state.runFilters = defaultRunFilters();
  syncRunFilterInputs();
  state.selectedRunId = null;
  refreshHistory();
});
els.artifactFilterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.artifactFilters = readArtifactFilters();
  refreshArtifacts();
});
els.artifactFilterReset.addEventListener("click", () => {
  state.artifactFilters = { run: "", workflow: "", kind: "", limit: "100" };
  syncArtifactFilterInputs();
  refreshArtifacts();
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});

loadAll();

async function loadAll() {
  setStatus("Connecting");
  try {
    syncArtifactFilterInputs();
    syncModelFilterInputs();
    syncRunFilterInputs();
    const [nodes, executors, models, runs, artifacts, patches] = await Promise.all([
      apiGet("/nodes"),
      apiGet("/executors"),
      apiGet(modelQueryPath()),
      apiGet(runQueryPath()),
      apiGet(artifactQueryPath()),
      apiGet("/patches"),
    ]);
    const [loopReport, loopChanges, projectWorkspaces, publishCatalog, releaseReport] =
      await Promise.allSettled([
        apiGet("/loop"),
        apiGet("/loop/changes"),
        apiGet("/loop/projects"),
        apiGet("/publish"),
        apiGet("/release"),
      ]);
    state.nodes = nodes.nodes || [];
    state.categories = nodes.categories || [];
    state.executorCatalog = executors;
    state.executors = executors.executors || [];
    state.modelCatalog = models;
    state.models = models.models || [];
    state.runCatalog = runs;
    state.runs = runs.runs || [];
    state.artifacts = artifacts.artifacts || [];
    state.patches = patches.patches || [];
    applyPanelResult(loopReport, "loopReport", "loopError");
    applyPanelResult(loopChanges, "loopChanges", "loopChangesError");
    applyPanelResult(projectWorkspaces, "projectWorkspaces", "projectWorkspacesError");
    applyPanelResult(publishCatalog, "publishCatalog", "publishCatalogError");
    applyPanelResult(releaseReport, "releaseReport", "releaseError");
    state.workflows = {};
    state.workflowErrors = {};
    state.workflowLoading.clear();
    state.plans = {};
    state.planErrors = {};
    state.planLoading.clear();
    state.loopReports = {};
    state.loopErrors = {};
    state.loopLoading.clear();
    state.publishChecks = {};
    state.publishErrors = {};
    state.publishLoading.clear();
    state.releaseReports = {};
    state.releaseErrors = {};
    state.releaseLoading.clear();
    state.selectedNodeId = state.selectedNodeId || state.nodes[0]?.id || null;
    state.selectedRunId = runs.last || state.runs[0]?.run_id || null;

    renderCategoryFilter();
    renderNodeList();
    renderNodeDetail();
    renderExecutors();
    renderModels();
    renderRuns();
    renderPatches();
    renderArtifacts();
    renderLoop();
    setStatus(`${state.nodes.length} nodes`);
  } catch (error) {
    setStatus("Disconnected");
    renderError(error);
  }
}

function applyPanelResult(result, valueKey, errorKey) {
  if (result.status === "fulfilled") {
    state[valueKey] = result.value;
    state[errorKey] = "";
    return;
  }
  state[valueKey] = null;
  state[errorKey] = result.reason?.message || String(result.reason);
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function selectTab(name) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${name}View`);
  });
}

function renderCategoryFilter() {
  const selected = els.categoryFilter.value || "all";
  els.categoryFilter.replaceChildren(
    option("all", "All"),
    ...state.categories.map((category) =>
      option(category.category, `${category.category} (${category.nodes})`),
    ),
  );
  els.categoryFilter.value = [...els.categoryFilter.options].some((item) => item.value === selected)
    ? selected
    : "all";
}

function renderNodeList() {
  const term = els.nodeFilter.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const nodes = state.nodes.filter((node) => {
    const matchesCategory = category === "all" || (node.category || "uncategorized") === category;
    const haystack = `${node.id} ${node.name} ${node.description || ""}`.toLowerCase();
    return matchesCategory && haystack.includes(term);
  });

  if (!nodes.length) {
    els.nodeList.replaceChildren(emptyNode("No nodes"));
    return;
  }

  els.nodeList.replaceChildren(
    ...nodes.map((node) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "node-item";
      button.classList.toggle("is-active", node.id === state.selectedNodeId);
      button.addEventListener("click", () => {
        state.selectedNodeId = node.id;
        renderNodeList();
        renderNodeDetail();
        renderPatchDetail();
        selectTab("node");
      });
      button.append(
        el("div", { className: "node-name" }, [
          el("strong", {}, node.name),
          el("span", {}, node.id),
        ]),
        badge(node.validation?.valid ? "ok" : "danger", node.validation?.valid ? "valid" : "issue"),
      );
      return button;
    }),
  );
}

function renderNodeDetail() {
  const node = state.nodes.find((item) => item.id === state.selectedNodeId);
  if (!node) {
    els.nodeDetail.replaceChildren(emptyNode("No node selected"));
    return;
  }

  const overview = panel("Overview", [
    el("div", { className: "stack" }, [
      el("div", {}, [
        el("h2", {}, node.name),
        el("p", { className: "muted" }, node.description || node.id),
      ]),
      el("div", { className: "inline-list" }, [
        badge(null, node.kind),
        badge(node.validation?.valid ? "ok" : "danger", node.validation?.valid ? "valid" : "issue"),
        ...(node.runtimes || []).map((runtime) =>
          badge(runtime.available ? "ok" : "warn", runtime.capability),
        ),
      ]),
      el("div", { className: "meta-grid" }, [
        metric("Version", node.version),
        metric("Category", node.category || "uncategorized"),
        metric("Inputs", String(node.inputs.length)),
        metric("Outputs", String(node.outputs.length)),
        metric("Graph", `${node.graph.nodes} / ${node.graph.edges}`),
        metric("Models", String(node.models.length)),
        metric("Dependencies", String(node.dependencies.length)),
        metric("Runtimes", String(node.runtimes.length)),
      ]),
    ]),
  ]);

  const ports = panel("Ports", [
    sectionTitle("Inputs"),
    portList(node.inputs),
    sectionTitle("Outputs"),
    portList(node.outputs),
  ]);

  const runtime = panel("Runtime", [
    node.runtimes.length ? runtimeList(node.runtimes) : emptyNode("No runtime requirement"),
    sectionTitle("Validation"),
    node.validation?.issues?.length
      ? list(node.validation.issues)
      : el("p", { className: "muted" }, "No validation issues."),
  ]);
  const graph = panel("Graph", [graphView(node)]);
  const plan = panel("Plan", [planView(node)]);
  const loop = panel("Workflow Loop", [workflowLoopView(node)]);
  const publish = panel("Publish", [publishView(node)]);
  const release = panel("Release", [selectedReleaseView(node)]);

  const run = panel("Run", [runForm(node)]);

  els.nodeDetail.replaceChildren(
    el("div", { className: "stack" }, [overview, ports, runtime, graph, plan, loop]),
    el("div", { className: "stack" }, [run, publish, release]),
  );
  ensureWorkflowSpec(node.id);
  ensureNodePlan(node.id);
  ensureWorkflowLoop(node.id, state.selectedLoopRequireReplay);
  ensurePublishCheck(node.id);
  ensureReleaseCheck(node.id);
}

function ensureWorkflowSpec(workflowId) {
  if (
    state.workflows[workflowId] ||
    state.workflowErrors[workflowId] ||
    state.workflowLoading.has(workflowId)
  ) {
    return;
  }
  state.workflowLoading.add(workflowId);
  apiGet(`/workflows/${encodeURIComponent(workflowId)}`)
    .then((workflow) => {
      state.workflows[workflowId] = workflow;
      delete state.workflowErrors[workflowId];
    })
    .catch((error) => {
      state.workflowErrors[workflowId] = error.message;
    })
    .finally(() => {
      state.workflowLoading.delete(workflowId);
      if (state.selectedNodeId === workflowId) {
        renderNodeDetail();
      }
    });
}

function ensureNodePlan(workflowId) {
  if (state.plans[workflowId] || state.planErrors[workflowId] || state.planLoading.has(workflowId)) {
    return;
  }
  state.planLoading.add(workflowId);
  apiGet(`/workflows/${encodeURIComponent(workflowId)}/plan`)
    .then((plan) => {
      state.plans[workflowId] = plan;
      delete state.planErrors[workflowId];
    })
    .catch((error) => {
      state.planErrors[workflowId] = error.message;
    })
    .finally(() => {
      state.planLoading.delete(workflowId);
      if (state.selectedNodeId === workflowId) {
        renderNodeDetail();
      }
    });
}

function loopCacheKey(workflowId, requireReplay = false) {
  return requireReplay ? `${workflowId}::require_replay` : workflowId;
}

function workflowLoopPath(workflowId, requireReplay = false) {
  const encoded = encodeURIComponent(workflowId);
  return requireReplay
    ? `/workflows/${encoded}/loop?require_replay=true`
    : `/workflows/${encoded}/loop`;
}

function ensureWorkflowLoop(workflowId, requireReplay = false) {
  const key = loopCacheKey(workflowId, requireReplay);
  if (
    state.loopReports[key] ||
    state.loopErrors[key] ||
    state.loopLoading.has(key)
  ) {
    return;
  }
  state.loopLoading.add(key);
  apiGet(workflowLoopPath(workflowId, requireReplay))
    .then((report) => {
      state.loopReports[key] = report;
      delete state.loopErrors[key];
    })
    .catch((error) => {
      state.loopErrors[key] = error.message;
    })
    .finally(() => {
      state.loopLoading.delete(key);
      if (state.selectedNodeId === workflowId) {
        renderNodeDetail();
      }
    });
}

function ensurePublishCheck(workflowId) {
  if (
    state.publishChecks[workflowId] ||
    state.publishErrors[workflowId] ||
    state.publishLoading.has(workflowId)
  ) {
    return;
  }
  state.publishLoading.add(workflowId);
  apiGet(`/workflows/${encodeURIComponent(workflowId)}/publish`)
    .then((check) => {
      state.publishChecks[workflowId] = check;
      delete state.publishErrors[workflowId];
    })
    .catch((error) => {
      state.publishErrors[workflowId] = error.message;
    })
    .finally(() => {
      state.publishLoading.delete(workflowId);
      if (state.selectedNodeId === workflowId) {
        renderNodeDetail();
      }
    });
}

function ensureReleaseCheck(workflowId) {
  if (
    state.releaseReports[workflowId] ||
    state.releaseErrors[workflowId] ||
    state.releaseLoading.has(workflowId)
  ) {
    return;
  }
  state.releaseLoading.add(workflowId);
  apiGet(`/release?workflow_id=${encodeURIComponent(workflowId)}`)
    .then((report) => {
      state.releaseReports[workflowId] = report;
      delete state.releaseErrors[workflowId];
    })
    .catch((error) => {
      state.releaseErrors[workflowId] = error.message;
    })
    .finally(() => {
      state.releaseLoading.delete(workflowId);
      if (state.selectedNodeId === workflowId) {
        renderNodeDetail();
      }
    });
}

function graphView(node) {
  const workflow = state.workflows[node.id];
  if (workflow) {
    return workflowGraphView(workflow);
  }
  const error = state.workflowErrors[node.id];
  if (error) {
    return el("pre", {}, error);
  }
  return el("p", { className: "muted" }, "Loading graph...");
}

function workflowLoopView(node) {
  const requireReplay = state.selectedLoopRequireReplay;
  const key = loopCacheKey(node.id, requireReplay);
  const toggle = el("label", { className: "toggle-line" }, [
    el("input", { type: "checkbox" }),
    el("span", {}, "Require replay evidence"),
  ]);
  const input = toggle.querySelector("input");
  input.checked = requireReplay;
  input.addEventListener("change", () => {
    state.selectedLoopRequireReplay = input.checked;
    ensureWorkflowLoop(node.id, state.selectedLoopRequireReplay);
    renderNodeDetail();
  });
  const report = state.loopReports[key];
  if (report) {
    return el("div", { className: "stack" }, [
      toggle,
      loopReportView(report, { compact: true }),
    ]);
  }
  const error = state.loopErrors[key];
  if (error) {
    return el("div", { className: "stack" }, [toggle, el("pre", {}, error)]);
  }
  return el("div", { className: "stack" }, [
    toggle,
    el("p", { className: "muted" }, "Loading loop readiness..."),
  ]);
}

function publishView(node) {
  const check = state.publishChecks[node.id];
  if (check) {
    return publishCheckView(check);
  }
  const error = state.publishErrors[node.id];
  if (error) {
    return el("pre", {}, error);
  }
  return el("p", { className: "muted" }, "Loading publish preflight...");
}

function selectedReleaseView(node) {
  const report = state.releaseReports[node.id];
  if (report) {
    return releaseReportView(report, { compact: true });
  }
  const error = state.releaseErrors[node.id];
  if (error) {
    return el("pre", {}, error);
  }
  return el("p", { className: "muted" }, "Loading release readiness...");
}

function publishCheckView(check) {
  return el("div", { className: "stack" }, [
    el("div", { className: "inline-list" }, [
      badge(check.publishable ? "ok" : "warn", check.publishable ? "publishable" : "blocked"),
      badge(null, check.workflow_id),
      badge(null, `${check.issues?.length || 0} issues`),
    ]),
    el("dl", { className: "kv-list" }, [
      kv("Package", check.package || ""),
      kv("Version", check.version || ""),
      kv("Manifest", check.manifest || ""),
      kv("Internal Deps", (check.internal_dependencies || []).join(", ")),
    ]),
    check.command?.length ? sectionTitle("Command") : null,
    check.command?.length ? commandList([check.command]) : null,
    check.issues?.length ? list(check.issues) : el("p", { className: "muted" }, "No publish blockers."),
  ].filter(Boolean));
}

function workflowGraphView(workflow) {
  return el("div", { className: "stack" }, [
    el("div", { className: "inline-list" }, [
      badge(null, workflow.nodes?.length ? "composite" : "leaf"),
      badge(null, `${workflow.nodes?.length || 0} nodes`),
      badge(null, `${workflow.edges?.length || 0} edges`),
    ]),
    sectionTitle("Nodes"),
    workflow.nodes?.length ? graphNodeTable(workflow.nodes) : emptyNode("No graph nodes"),
    sectionTitle("Edges"),
    workflow.edges?.length ? graphEdgeTable(workflow.edges) : emptyNode("No graph edges"),
  ]);
}

function graphNodeTable(nodes) {
  return table(["Node", "Workflow", "State", "Config"], nodes.map((node) => [
    [node.id, node.title].filter(Boolean).join("\n"),
    workflowCandidates(node).join("\n"),
    [
      node.kind || "workflow",
      node.disabled ? "disabled" : "enabled",
      node.condition ? compactJson(node.condition) : "",
    ].filter(Boolean).join("\n"),
    node.config === undefined || node.config === null ? "" : compactJson(node.config),
  ]));
}

function graphEdgeTable(edges) {
  return table(["From", "To"], edges.map((edge) => [
    endpointText(edge.from),
    endpointText(edge.to),
  ]));
}

function workflowCandidates(node) {
  if ((node.kind || "workflow") === "if") {
    return [
      node.then_workflow_id ? `then ${node.then_workflow_id}` : "",
      node.else_workflow_id ? `else ${node.else_workflow_id}` : "",
    ].filter(Boolean);
  }
  return [node.workflow_id || ""].filter(Boolean);
}

function endpointText(endpoint) {
  return endpoint ? `${endpoint.node}.${endpoint.port}` : "";
}

function planView(node) {
  const plan = state.plans[node.id];
  if (plan) {
    return workflowPlanView(plan);
  }
  const error = state.planErrors[node.id];
  if (error) {
    return el("pre", {}, error);
  }
  return el("p", { className: "muted" }, "Loading plan...");
}

function workflowPlanView(plan) {
  const children = [
    el("div", { className: "inline-list" }, [
      badge(null, plan.kind),
      badge(null, plan.workflow_id),
      badge(null, plan.version),
    ]),
  ];
  if (plan.runtime) {
    children.push(runtimePlanView(plan.runtime));
  }
  if (plan.nodes?.length) {
    children.push(sectionTitle("Graph"));
    children.push(planNodeTable(plan.nodes));
  }
  return el("div", { className: "stack" }, children);
}

function runtimePlanView(runtime) {
  return el("div", { className: "stack" }, [
    el("div", { className: "meta-grid" }, [
      metric("Executor", runtime.executor_id),
      metric("Status", runtime.executor_status),
      metric("Policy", runtime.data_policy),
      metric("Models", String(runtime.models?.length || 0)),
    ]),
    el("div", { className: "inline-list" }, [
      badge(runtime.executor_available ? "ok" : "warn", runtime.executor_kind),
      badge(runtime.plans_models ? "ok" : null, runtime.plans_models ? "models" : "no models"),
      ...((runtime.capabilities || []).map((capability) => badge(null, capability))),
    ]),
    runtime.executor_status_reason
      ? el("small", { className: "muted" }, runtime.executor_status_reason)
      : null,
    runtime.atoms?.length
      ? table(["Atom", "Capability"], runtime.atoms.map((atom) => [atom.id, atom.capability]))
      : emptyNode("No atoms"),
    runtime.models?.length
      ? table(["Requirement", "Capability", "Format"], runtime.models.map((model) => [
          model.requirement_id,
          model.capability,
          model.preferred_format || "",
        ]))
      : null,
  ].filter(Boolean));
}

function planNodeTable(nodes) {
  return table(["Node", "Workflow", "Runtime", "Policy", "Models"], nodes.map((node) => [
    `${node.node_id}\n${node.kind}${node.disabled ? "\ndisabled" : ""}`,
    [
      node.selected_workflow_id || node.workflow_id || "",
      ...(node.candidate_workflow_ids || []).filter(
        (workflowId) => workflowId !== node.selected_workflow_id,
      ),
    ].filter(Boolean).join("\n"),
    node.runtime?.executor_id || node.child_kind || "",
    node.runtime?.data_policy || "",
    String(node.runtime?.models?.length || 0),
  ]));
}

function runForm(node) {
  const form = el("form", { className: "run-form" });
  const fields = node.inputs.map((port) => {
    const field = renderInputField(port);
    form.append(field.wrapper);
    return { port, input: field.input };
  });
  const runOptions = renderRunOptionsFields();
  form.append(...runOptions.fields);
  const validatePatch = el("button", { type: "button" }, "Validate patch");
  const submit = el("button", { className: "primary", type: "submit" }, "Run");
  const result = el("div", { className: "result-block" });
  form.append(el("div", { className: "inline-list" }, [validatePatch, submit]), result);
  validatePatch.addEventListener("click", async () => {
    await patchAction(result, async () => {
      const patch = patchValue(runOptions.patch);
      if (patch === undefined) {
        throw new Error("Patch JSON is empty.");
      }
      return apiPost(
        `/patches/validate?workflow_id=${encodeURIComponent(node.id)}`,
        patch,
      );
    }, (validation) => patchValidationView(validation, node.id));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    result.replaceChildren(el("pre", {}, "Running..."));
    try {
      const inputs = {};
      for (const field of fields) {
        const value = fieldValue(field.port, field.input);
        if (value !== undefined) {
          inputs[field.port.name] = value;
        }
      }
      const body = {
        inputs,
        disabled_nodes: nodeIdList(runOptions.disabledNodes),
        enabled_nodes: nodeIdList(runOptions.enabledNodes),
      };
      const patch = patchValue(runOptions.patch);
      if (patch !== undefined) {
        body.patch = patch;
      }
      const execution = await apiPost(`/workflows/${encodeURIComponent(node.id)}/run`, body);
      result.replaceChildren(jsonBlock(execution));
      if (execution.run_id) {
        state.selectedRunId = execution.run_id;
      }
      await refreshHistory();
    } catch (error) {
      result.replaceChildren(el("pre", {}, error.message));
    }
  });
  return form;
}

function renderRunOptionsFields() {
  const registeredPatch = document.createElement("select");
  registeredPatch.name = "registered_patch";
  registeredPatch.append(
    option("", "None"),
    ...state.patches.map((patch) => option(patch.name, patch.name)),
  );

  const disabledNodes = document.createElement("textarea");
  disabledNodes.rows = 2;
  disabledNodes.name = "disabled_nodes";
  disabledNodes.placeholder = "node_id";

  const enabledNodes = document.createElement("textarea");
  enabledNodes.rows = 2;
  enabledNodes.name = "enabled_nodes";
  enabledNodes.placeholder = "node_id";

  const patch = document.createElement("textarea");
  patch.rows = 5;
  patch.name = "patch";
  patch.placeholder = '{\n  "nodes": {}\n}';
  patch.value = state.runPatchDraft;
  patch.addEventListener("input", () => {
    state.runPatchDraft = patch.value;
  });
  registeredPatch.addEventListener("change", async () => {
    if (!registeredPatch.value) {
      return;
    }
    const registered = await apiGet(`/patches/${encodeURIComponent(registeredPatch.value)}`);
    patch.value = JSON.stringify(registered.patch, null, 2);
    state.runPatchDraft = patch.value;
  });

  return {
    registeredPatch,
    disabledNodes,
    enabledNodes,
    patch,
    fields: [
      formField("Registered patch", "Optional", registeredPatch),
      formField("Disabled nodes", "Optional", disabledNodes),
      formField("Enabled nodes", "Optional", enabledNodes),
      formField("Patch JSON", "Optional", patch),
    ],
  };
}

function formField(label, hint, input) {
  const id = `run-${input.name}`;
  input.id = id;
  return el("div", { className: "field" }, [
    el("label", { htmlFor: id }, [el("span", {}, label), el("small", {}, hint)]),
    input,
  ]);
}

function nodeIdList(input) {
  return input.value
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function patchValue(input) {
  const value = input.value.trim();
  if (!value) {
    return undefined;
  }
  return JSON.parse(value);
}

async function refreshHistory() {
  const [runs, artifacts] = await Promise.all([apiGet(runQueryPath()), apiGet(artifactQueryPath())]);
  state.runCatalog = runs;
  state.runs = runs.runs || [];
  state.artifacts = artifacts.artifacts || [];
  if (!state.runs.some((run) => run.run_id === state.selectedRunId)) {
    state.selectedRunId = runs.last || state.runs[0]?.run_id || null;
  }
  renderRuns();
  renderArtifacts();
}

function defaultRunFilters() {
  return { workflow: "", status: "", limit: "100" };
}

function focusedRunFilters() {
  return { workflow: "", status: "", limit: "" };
}

async function focusRun(runId) {
  state.runFilters = focusedRunFilters();
  syncRunFilterInputs();
  state.selectedRunId = runId;
  await refreshHistory();
  if (!state.runs.some((run) => run.run_id === runId)) {
    await selectRun(runId, false);
  }
}

async function refreshArtifacts() {
  const artifacts = await apiGet(artifactQueryPath());
  state.artifacts = artifacts.artifacts || [];
  renderArtifacts();
}

async function refreshModels() {
  const models = await apiGet(modelQueryPath());
  state.modelCatalog = models;
  state.models = models.models || [];
  renderModels();
}

function readModelFilters() {
  return {
    workflow: els.modelWorkflowFilter.value.trim(),
    status: els.modelStatusFilter.value,
  };
}

function syncModelFilterInputs() {
  els.modelWorkflowFilter.value = state.modelFilters.workflow;
  els.modelStatusFilter.value = state.modelFilters.status;
}

function modelQueryPath() {
  const params = new URLSearchParams();
  const filters = state.modelFilters;
  if (filters.workflow) {
    params.set("workflow_id", filters.workflow);
  }
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  const query = params.toString();
  return query ? `/models?${query}` : "/models";
}

function readRunFilters() {
  return {
    workflow: els.runWorkflowFilter.value.trim(),
    status: els.runStatusFilter.value,
    limit: els.runLimitFilter.value.trim(),
  };
}

function syncRunFilterInputs() {
  els.runWorkflowFilter.value = state.runFilters.workflow;
  els.runStatusFilter.value = state.runFilters.status;
  els.runLimitFilter.value = state.runFilters.limit;
}

function runQueryPath() {
  const params = new URLSearchParams();
  const filters = state.runFilters;
  if (filters.workflow) {
    params.set("workflow_id", filters.workflow);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.limit) {
    params.set("limit", filters.limit);
  }
  const query = params.toString();
  return query ? `/runs?${query}` : "/runs";
}

function readArtifactFilters() {
  return {
    run: els.artifactRunFilter.value.trim(),
    workflow: els.artifactWorkflowFilter.value.trim(),
    kind: els.artifactKindFilter.value.trim(),
    limit: els.artifactLimitFilter.value.trim(),
  };
}

function syncArtifactFilterInputs() {
  els.artifactRunFilter.value = state.artifactFilters.run;
  els.artifactWorkflowFilter.value = state.artifactFilters.workflow;
  els.artifactKindFilter.value = state.artifactFilters.kind;
  els.artifactLimitFilter.value = state.artifactFilters.limit;
}

function artifactQueryPath() {
  const params = new URLSearchParams();
  const filters = state.artifactFilters;
  if (filters.run) {
    params.set("run_id", filters.run);
  }
  if (filters.workflow) {
    params.set("workflow_id", filters.workflow);
  }
  if (filters.kind) {
    params.set("kind", filters.kind);
  }
  if (filters.limit) {
    params.set("limit", filters.limit);
  }
  const query = params.toString();
  return query ? `/artifacts?${query}` : "/artifacts";
}

function renderInputField(port) {
  const id = `input-${port.name}`;
  const wrapper = el("div", { className: "field" });
  const hint = [
    port.type,
    port.required ? "required" : "optional",
    port.widget || null,
    port.model_requirement ? `model ${port.model_requirement}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  wrapper.append(
    el("label", { htmlFor: id }, [el("span", {}, port.name), el("small", {}, hint)]),
  );

  const input = inputForPort(port);
  input.id = id;
  input.name = port.name;
  if (port.description) {
    wrapper.append(el("small", {}, port.description));
  }
  wrapper.append(input);
  return { wrapper, input };
}

function inputForPort(port) {
  if (port.enum?.length) {
    const select = document.createElement("select");
    select.append(...port.enum.map((value) => option(String(value), String(value))));
    select.value = defaultText(port);
    return select;
  }
  if (port.widget === "toggle" || port.type === "boolean") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(port.default);
    return checkbox;
  }
  if (port.widget === "number" || port.widget === "seed" || port.type === "integer" || port.type === "number") {
    const input = document.createElement("input");
    input.type = "number";
    if (port.min !== undefined) input.min = port.min;
    if (port.max !== undefined) input.max = port.max;
    if (port.step !== undefined) input.step = port.step;
    input.value = defaultText(port);
    return input;
  }
  if (port.widget === "textarea" || port.widget === "json" || port.type === "json") {
    const textarea = document.createElement("textarea");
    textarea.value = defaultText(port, port.type === "json" && port.required ? "{}" : "");
    return textarea;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.value = defaultText(port);
  return input;
}

function fieldValue(port, input) {
  if (input.type === "checkbox") {
    return input.checked;
  }
  if (!input.value && !port.required && port.default === undefined) {
    return undefined;
  }
  if (port.type === "json") {
    return input.value ? JSON.parse(input.value) : null;
  }
  if (port.type === "integer") {
    return input.value ? Number.parseInt(input.value, 10) : null;
  }
  if (port.type === "number" || port.widget === "number" || port.widget === "seed") {
    return input.value ? Number(input.value) : null;
  }
  return input.value;
}

function defaultText(port, fallback = "") {
  if (port.default === undefined || port.default === null) {
    return fallback;
  }
  return typeof port.default === "string" ? port.default : JSON.stringify(port.default, null, 2);
}

function compactJson(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function renderRuns() {
  if (!state.runs.length) {
    els.runList.replaceChildren(runCatalogSummary(), emptyNode("No runs"));
    els.runDetail.replaceChildren();
    return;
  }
  els.runList.replaceChildren(
    runCatalogSummary(),
    ...state.runs.map((run) => {
      const button = el("button", { className: "run-item", type: "button" }, [
        el("strong", {}, run.run_id),
        el("div", { className: "inline-list" }, [
          badge(run.status === "completed" ? "ok" : "danger", run.status),
          badge(null, workflowLabel(run)),
          run.surface ? badge(null, run.surface) : null,
          run.stages > 1 ? badge(null, `${run.stages} stages`) : null,
          run.duration_ms !== undefined ? badge(null, formatDuration(run.duration_ms)) : null,
        ]),
        el("small", { className: "muted" }, run.run_dir || ""),
      ]);
      button.classList.toggle("is-active", run.run_id === state.selectedRunId);
      button.addEventListener("click", () => selectRun(run.run_id));
      return button;
    }),
  );
  selectRun(state.selectedRunId || state.runs[0].run_id, false);
}

function runCatalogSummary() {
  const catalog = state.runCatalog || {};
  const total = catalog.total ?? state.runs.length;
  const completed = catalog.completed_count ?? state.runs.filter((run) => run.status === "completed").length;
  const failed = catalog.failed_count ?? state.runs.filter((run) => run.status === "failed").length;
  const unknown = catalog.unknown_count ?? Math.max(0, total - completed - failed);
  const filters = runFilterSummary();
  const children = [
    el("div", { className: "inline-list" }, [
      badge(null, `${total} runs`),
      completed ? badge("ok", `${completed} completed`) : null,
      failed ? badge("danger", `${failed} failed`) : null,
      unknown ? badge("warn", `${unknown} unknown`) : null,
      catalog.issues?.length ? badge("warn", `${catalog.issues.length} issues`) : null,
      ...filters,
    ].filter(Boolean)),
  ];
  if (catalog.unknown_run_ids?.length) {
    children.push(el("div", { className: "compact-line muted" }, [
      "Unknown runs: ",
      ...linkRunIds(catalog.unknown_run_ids.slice(0, 5).join(", ")),
      catalog.unknown_run_ids.length > 5 ? ` and ${catalog.unknown_run_ids.length - 5} more` : "",
    ]));
  }
  return el("div", { className: "stack tight" }, children);
}

function runFilterSummary() {
  const filters = state.runFilters;
  return [
    filters.workflow ? badge(null, filters.workflow) : null,
    filters.status ? badge(null, filters.status) : null,
    filters.limit ? badge(null, `limit ${filters.limit}`) : null,
  ].filter(Boolean);
}

async function selectRun(runId, rerenderList = true) {
  state.selectedRunId = runId;
  if (rerenderList) {
    renderRuns();
  }
  els.runDetail.replaceChildren(panel("Run", [jsonBlock({ loading: runId })]));
  try {
    const run = await apiGet(`/runs/${encodeURIComponent(runId)}`);
    const artifacts = runArtifacts(run);
    els.runDetail.replaceChildren(
      panel("Run", [
        runActionButtons(run.run_id),
        el("dl", { className: "kv-list" }, [
          kv("ID", run.run_id),
          kv("Directory", run.run_dir),
          kv("Status", run.manifest?.status || run.execution?.status || "unknown"),
          kv("Surface", runSurface(run)),
          kv("Workflows", runWorkflowIds(run).join(", ")),
          kv("Stages", String((run.manifest?.stages || []).length)),
          kv("Started", formatTime(run.manifest?.started_at_ms)),
          kv("Completed", formatTime(run.manifest?.completed_at_ms)),
          kv("Duration", formatDuration(runDurationMs(run))),
          kv("Events", String(run.events.length)),
          kv("Artifacts", String(artifacts.length)),
        ]),
        sectionTitle("Timeline"),
        eventTimeline(run.events),
        sectionTitle("Stages"),
        stageList(run),
        replayReportView(run.execution?.replay),
        sectionTitle("Node Trace"),
        nodeTraceTable(run),
        sectionTitle("Artifacts"),
        artifactRows(run.run_id, artifacts),
        sectionTitle("Raw Trace"),
        jsonBlock({
          manifest: run.manifest,
          execution: run.execution,
          events: run.events,
        }),
      ]),
    );
  } catch (error) {
    els.runDetail.replaceChildren(panel("Run", [el("pre", {}, error.message)]));
  }
}

function runActionButtons(runId) {
  const output = el("div", { className: "result-block" });
  const replay = el("button", { type: "button" }, "Replay");
  replay.addEventListener("click", async () => {
    replay.disabled = true;
    output.replaceChildren(el("pre", {}, "Replaying..."));
    try {
      const replayed = await apiPost(`/runs/${encodeURIComponent(runId)}/replay`, {});
      if (replayed.run_id) {
        await focusRun(replayed.run_id);
      } else {
        await refreshHistory();
      }
      output.replaceChildren(jsonBlock(replayed));
    } catch (error) {
      output.replaceChildren(el("pre", {}, error.message));
    } finally {
      replay.disabled = false;
    }
  });

  const remove = el("button", { type: "button" }, "Delete");
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    output.replaceChildren(el("pre", {}, "Deleting..."));
    try {
      const removed = await apiDelete(`/runs/${encodeURIComponent(runId)}`);
      state.selectedRunId = null;
      await refreshHistory();
      output.replaceChildren(jsonBlock(removed));
    } catch (error) {
      output.replaceChildren(el("pre", {}, error.message));
    } finally {
      remove.disabled = false;
    }
  });

  return el("div", { className: "stack" }, [
    el("div", { className: "inline-list" }, [replay, remove]),
    output,
  ]);
}

function renderArtifacts() {
  const summary = artifactFilterSummary();
  if (!state.artifacts.length) {
    els.artifactList.replaceChildren(
      el("div", { className: "detail-stack" }, [
        el("div", { className: "inline-list" }, summary),
        emptyNode("No artifacts"),
      ]),
    );
    return;
  }
  els.artifactList.replaceChildren(
    el("div", { className: "stack" }, [
      el("div", { className: "inline-list" }, [
        badge("ok", `${state.artifacts.length} artifacts`),
        ...summary,
      ]),
      ...state.artifacts.map((entry) => {
        const button = el("button", { className: "run-item", type: "button" }, [
          el("strong", {}, entry.artifact.path || entry.artifact.id || entry.run_id),
          el("div", { className: "inline-list" }, [
            badge(null, entry.artifact.kind || "artifact"),
            badge(null, entry.workflow_id || "workflow"),
            entry.node_id ? badge(null, entry.node_id) : null,
            entry.stage_index !== undefined ? badge(null, `stage ${entry.stage_index + 1}`) : null,
          ].filter(Boolean)),
          el("small", { className: "muted" }, entry.run_id),
        ]);
        button.addEventListener("click", () => {
          selectRun(entry.run_id);
          selectTab("runs");
        });
        return button;
      }),
    ]),
  );
}

function artifactFilterSummary() {
  const filters = state.artifactFilters;
  return [
    filters.run ? badge(null, `run ${filters.run}`) : null,
    filters.workflow ? badge(null, filters.workflow) : null,
    filters.kind ? badge(null, filters.kind) : null,
    filters.limit ? badge(null, `limit ${filters.limit}`) : null,
  ].filter(Boolean);
}

async function focusArtifacts(filters) {
  state.artifactFilters = {
    run: filters.run || "",
    workflow: filters.workflow || "",
    kind: filters.kind || "",
    limit: "100",
  };
  syncArtifactFilterInputs();
  selectTab("artifacts");
  await refreshArtifacts();
}

function renderPatches() {
  renderPatchList();
  renderPatchDetail();
}

function renderPatchList() {
  const newButton = el("button", { className: "run-item", type: "button" }, [
    el("strong", {}, "New patch"),
    el("div", { className: "inline-list" }, [badge(null, "draft")]),
  ]);
  newButton.classList.toggle("is-active", !state.selectedPatchName);
  newButton.addEventListener("click", () => {
    state.selectedPatchName = "";
    state.patchDraft = '{\n  "nodes": {}\n}';
    renderPatches();
  });

  const patchButtons = state.patches.map((patch) => {
    const button = el("button", { className: "run-item", type: "button" }, [
      el("strong", {}, patch.name),
      el("small", { className: "muted" }, patch.path || ""),
    ]);
    button.classList.toggle("is-active", patch.name === state.selectedPatchName);
    button.addEventListener("click", () => loadPatch(patch.name));
    return button;
  });

  els.patchList.replaceChildren(newButton, ...patchButtons);
}

async function loadPatch(name) {
  els.patchDetail.replaceChildren(panel("Patch", [jsonBlock({ loading: name })]));
  try {
    const registered = await apiGet(`/patches/${encodeURIComponent(name)}`);
    state.selectedPatchName = registered.name;
    state.patchDraft = JSON.stringify(registered.patch, null, 2);
    renderPatches();
  } catch (error) {
    els.patchDetail.replaceChildren(panel("Patch", [el("pre", {}, error.message)]));
  }
}

function renderPatchDetail() {
  const nameInput = document.createElement("input");
  nameInput.name = "patch_name";
  nameInput.spellcheck = false;
  nameInput.value = state.selectedPatchName;

  const patchInput = document.createElement("textarea");
  patchInput.name = "patch_payload";
  patchInput.value = state.patchDraft;
  patchInput.rows = 14;
  patchInput.addEventListener("input", () => {
    state.patchDraft = patchInput.value;
  });

  const workflowSelect = document.createElement("select");
  workflowSelect.name = "patch_workflow";
  workflowSelect.append(
    option("", "Project catalog"),
    ...state.nodes.map((node) => option(node.id, node.id)),
  );
  workflowSelect.value = state.nodes.some((node) => node.id === state.selectedNodeId)
    ? state.selectedNodeId
    : "";

  const result = el("div", { className: "result-block" });
  const validateButton = el("button", { type: "button" }, "Validate");
  const useInRunButton = el("button", { type: "button" }, "Use in selected run");
  const saveButton = el("button", { className: "primary", type: "button" }, "Save");
  const deleteButton = el("button", { type: "button" }, "Delete");

  validateButton.addEventListener("click", async () => {
    const workflowId = workflowSelect.value;
    await patchAction(result, async () => {
      const query = workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : "";
      return apiPost(`/patches/validate${query}`, JSON.parse(patchInput.value));
    }, (validation) => patchValidationView(validation, workflowId));
  });

  saveButton.addEventListener("click", async () => {
    await patchAction(result, async () => {
      const name = nameInput.value.trim();
      if (!name) {
        throw new Error("Patch name is required.");
      }
      const saved = await apiPost(`/patches/${encodeURIComponent(name)}`, JSON.parse(patchInput.value));
      state.selectedPatchName = saved.name;
      state.patchDraft = JSON.stringify(saved.patch, null, 2);
      patchInput.value = state.patchDraft;
      await reloadPatchList();
      return saved;
    });
  });

  useInRunButton.addEventListener("click", async () => {
    const selectedWorkflowId = state.selectedNodeId;
    if (!selectedWorkflowId) {
      result.replaceChildren(el("pre", {}, "Select a workflow before using this patch in a run."));
      return;
    }
    await patchAction(result, async () => {
      const patch = JSON.parse(patchInput.value);
      const validation = await apiPost(
        `/patches/validate?workflow_id=${encodeURIComponent(selectedWorkflowId)}`,
        patch,
      );
      if (!validation.valid) {
        return validation;
      }
      state.runPatchDraft = JSON.stringify(patch, null, 2);
      state.patchDraft = state.runPatchDraft;
      selectTab("node");
      renderNodeDetail();
      return validation;
    }, (validation) => {
      if (!validation.valid) {
        return patchValidationView(validation, selectedWorkflowId);
      }
      return el("div", { className: "stack" }, [
        el("div", { className: "inline-list" }, [
          badge("ok", "valid"),
          badge(null, selectedWorkflowId),
        ]),
        el("p", { className: "muted" }, "Patch copied to the selected workflow run form."),
      ]);
    });
  });

  deleteButton.addEventListener("click", async () => {
    await patchAction(result, async () => {
      const name = nameInput.value.trim();
      if (!name) {
        throw new Error("Patch name is required.");
      }
      const removed = await apiDelete(`/patches/${encodeURIComponent(name)}`);
      state.selectedPatchName = "";
      state.patchDraft = '{\n  "nodes": {}\n}';
      nameInput.value = "";
      patchInput.value = state.patchDraft;
      await reloadPatchList();
      return removed;
    });
  });

  els.patchDetail.replaceChildren(
    panel("Patch", [
      formField("Name", "Required", nameInput),
      formField("Validate against", "Optional", workflowSelect),
      formField("Patch JSON", "Serializable workflow patch", patchInput),
      el("div", { className: "inline-list" }, [
        validateButton,
        useInRunButton,
        saveButton,
        deleteButton,
      ]),
      result,
    ]),
  );
}

async function patchAction(result, action, render = jsonBlock) {
  result.replaceChildren(el("pre", {}, "Working..."));
  try {
    const value = await action();
    result.replaceChildren(render(value));
  } catch (error) {
    result.replaceChildren(el("pre", {}, error.message));
  }
}

function patchValidationView(validation, workflowId) {
  return el("div", { className: "stack" }, [
    el("div", { className: "inline-list" }, [
      badge(validation.valid ? "ok" : "danger", validation.valid ? "valid" : "blocked"),
      workflowId ? badge(null, workflowId) : badge(null, "project catalog"),
      validation.issues?.length ? badge("danger", `${validation.issues.length} issues`) : null,
    ].filter(Boolean)),
    validation.issues?.length
      ? list(validation.issues)
      : el("p", { className: "muted" }, "No patch validation issues."),
    sectionTitle("Normalized Patch"),
    jsonBlock(validation.patch || {}),
  ]);
}

async function reloadPatchList() {
  const patches = await apiGet("/patches");
  state.patches = patches.patches || [];
  renderPatchList();
  renderNodeDetail();
}

function eventTimeline(events) {
  if (!events?.length) {
    return emptyNode("No events");
  }
  return el("ol", { className: "timeline" }, events.map((event) =>
    el("li", {}, [
      el("div", { className: "timeline-head" }, [
        el("strong", {}, event.event || "event"),
        el("span", {}, formatTime(event.at_ms)),
      ]),
      el("div", { className: "inline-list" }, [
        event.surface ? badge(null, event.surface) : null,
        event.workflow_id ? badge(null, event.workflow_id) : null,
        event.node_id ? badge(event.status === "skipped" ? "warn" : "ok", event.node_id) : null,
        event.status ? badge(event.status === "skipped" ? "warn" : "ok", event.status) : null,
        event.duration_ms !== undefined ? badge(null, `${event.duration_ms}ms`) : null,
        event.attempts ? badge(null, `${event.attempts} attempt`) : null,
        event.runtime ? badge("ok", runtimeText(event.runtime)) : null,
        event.artifacts?.length ? badge(null, `${event.artifacts.length} artifacts`) : null,
      ].filter(Boolean)),
      event.error ? el("pre", {}, JSON.stringify(event.error, null, 2)) : null,
    ].filter(Boolean)),
  ));
}

function stageList(run) {
  const manifestStages = run.manifest?.stages || [];
  const executionStages = run.execution?.pipeline ? run.execution.stages || [] : [run.execution];
  if (!manifestStages.length && !executionStages.length) {
    return emptyNode("No stages");
  }
  const rows = executionStages.map((stage, index) => {
    const manifest = manifestStages[index] || {};
    const nodes = stage?.nodes || [];
    const completed = nodes.filter((node) => node.status !== "skipped").length;
    const skipped = nodes.filter((node) => node.status === "skipped").length;
    const workflowId = stage?.workflow_id || manifest.workflow_id || "";
    return [
      String(index + 1),
      workflowId,
      stage?.status || run.manifest?.status || "",
      `${completed} completed / ${skipped} skipped`,
      String(stageArtifacts(stage).length),
    ];
  });
  return table(["Stage", "Workflow", "Status", "Nodes", "Artifacts"], rows);
}

function replayReportView(report) {
  if (!report) {
    return null;
  }
  return el("div", { className: "stack" }, [
    sectionTitle("Replay Drift"),
    el("div", { className: "inline-list" }, [
      badge(report.runtime_changed ? "warn" : "ok", report.runtime_changed ? "runtime changed" : "runtime same"),
      badge(
        report.model_lock_changed ? "warn" : "ok",
        report.model_lock_changed ? "model lock changed" : "model lock same",
      ),
      report.replayed_from ? badge(null, `from ${report.replayed_from}`) : null,
    ].filter(Boolean)),
    replayFingerprintTable("Original runtime", report.original_runtime),
    replayFingerprintTable("Replayed runtime", report.replayed_runtime),
    replayModelLockTable("Original model locks", report.original_model_locks),
    replayModelLockTable("Replayed model locks", report.replayed_model_locks),
  ].filter(Boolean));
}

function replayFingerprintTable(title, fingerprints) {
  if (!fingerprints?.length) {
    return null;
  }
  return el("div", { className: "stack" }, [
    sectionTitle(title),
    table(["Workflow", "Node", "Runtime", "Policy"], fingerprints.map((fingerprint) => [
      fingerprint.workflow_id || "",
      fingerprint.node_id || "",
      runtimeText(fingerprint.runtime),
      fingerprint.runtime?.data_policy || "",
    ])),
  ]);
}

function replayModelLockTable(title, fingerprints) {
  if (!fingerprints?.length) {
    return null;
  }
  return el("div", { className: "stack" }, [
    sectionTitle(title),
    table(["Stage", "Workflow", "Node", "Requirement", "Status", "Key", "Paths", "SHA256"], fingerprints.map((fingerprint) => {
      const lock = fingerprint.lock || {};
      return [
        fingerprint.stage_index === undefined ? "" : String(fingerprint.stage_index + 1),
        fingerprint.workflow_id || "",
        fingerprint.node_id || "",
        fingerprint.requirement_id || "",
        lock.status || "",
        lock.key || "",
        modelLockPaths(lock),
        lock.sha256 || "",
      ];
    })),
  ]);
}

function modelLockPaths(lock) {
  return [
    ...(lock.local_paths || []).map((path) => `local ${path}`),
    ...(lock.missing_paths || []).map((path) => `missing ${path}`),
  ].join("\n");
}

function nodeTraceTable(run) {
  const stages = run.execution?.pipeline ? run.execution.stages || [] : [run.execution];
  const rows = stages.flatMap((stage, stageIndex) =>
    (stage?.nodes || []).map((node) => [
      String(stageIndex + 1),
      node.node_id || "",
      node.selected_workflow_id || node.workflow_id || "",
      node.status || "",
      node.duration_ms !== undefined ? `${node.duration_ms}ms` : "",
      node.attempts !== undefined ? String(node.attempts) : "",
      node.runtime ? runtimeText(node.runtime) : "",
      String((node.artifacts || []).length),
    ]),
  );
  if (!rows.length) {
    return emptyNode("No node trace");
  }
  return table(["Stage", "Node", "Workflow", "Status", "Duration", "Attempts", "Runtime", "Artifacts"], rows);
}

function runtimeText(runtime) {
  if (!runtime) {
    return "";
  }
  return [runtime.executor_id, runtime.executor_kind, runtime.data_policy].filter(Boolean).join("\n");
}

function runArtifacts(run) {
  const stages = run.execution?.pipeline ? run.execution.stages || [] : [run.execution];
  return stages.flatMap((stage, stageIndex) =>
    stageArtifacts(stage, stageIndex).map((artifact) => ({
      workflow_id: stage?.workflow_id || "",
      ...artifact,
    })),
  );
}

function stageArtifacts(stage, stageIndex = 0) {
  const topLevel = (stage?.artifacts || []).map((artifact) => ({
    stage_index: stageIndex,
    node_id: "",
    artifact,
  }));
  const nodeArtifacts = (stage?.nodes || []).flatMap((node, nodeIndex) =>
    (node.artifacts || []).map((artifact) => ({
      stage_index: stageIndex,
      node_index: nodeIndex,
      node_id: node.node_id || "",
      artifact,
    })),
  );
  return [...topLevel, ...nodeArtifacts];
}

function artifactRows(runId, artifacts) {
  if (!artifacts.length) {
    return emptyNode("No artifacts");
  }
  return table(["Stage", "Node Index", "Workflow", "Node", "Kind", "Path"], artifacts.map((entry) => [
    entry.stage_index === undefined ? "" : String(entry.stage_index + 1),
    entry.node_index === undefined ? "" : String(entry.node_index + 1),
    entry.workflow_id,
    entry.node_id,
    entry.artifact?.kind || "",
    artifactLink(runId, entry),
  ]));
}

function artifactLink(runId, entry) {
  const text = entry.artifact?.path || entry.artifact?.id || entry.artifact?.kind || "artifact";
  const button = el("button", { className: "link-button", type: "button" }, text);
  button.addEventListener("click", () => {
    focusArtifacts({
      run: runId,
      workflow: entry.workflow_id,
      kind: entry.artifact?.kind || "",
    });
  });
  return button;
}

function workflowLabel(run) {
  const workflows = run.workflow_ids || [];
  if (workflows.length > 1) {
    return `${workflows.length} workflows`;
  }
  return run.workflow_id || workflows[0] || "pipeline";
}

function runWorkflowIds(run) {
  if (run.workflow_ids?.length) {
    return run.workflow_ids;
  }
  return (run.manifest?.stages || [])
    .map((stage) => stage.workflow_id)
    .filter(Boolean);
}

function runSurface(run) {
  return run.events?.find((event) => event.surface)?.surface || "";
}

function runDurationMs(run) {
  const started = Number(run.manifest?.started_at_ms);
  const completed = Number(run.manifest?.completed_at_ms);
  if (Number.isFinite(started) && Number.isFinite(completed)) {
    return Math.max(0, completed - started);
  }
  return undefined;
}

function formatTime(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return new Date(number).toLocaleString();
}

function formatDuration(value) {
  if (value === undefined || value === null) {
    return "";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  if (number < 1000) {
    return `${number}ms`;
  }
  return `${(number / 1000).toFixed(2)}s`;
}

function renderError(error) {
  const node = emptyNode(error.message);
  els.nodeList.replaceChildren(node.cloneNode(true));
  els.nodeDetail.replaceChildren(node.cloneNode(true));
  els.executorList.replaceChildren(node.cloneNode(true));
  els.modelList.replaceChildren(node.cloneNode(true));
  els.runList.replaceChildren(node.cloneNode(true));
  els.runDetail.replaceChildren();
  els.patchList.replaceChildren(node.cloneNode(true));
  els.patchDetail.replaceChildren();
  els.artifactList.replaceChildren(node);
  els.loopDetail.replaceChildren(node.cloneNode(true));
}

function list(items) {
  return el("ul", {}, items.map((item) => el("li", {}, linkRunIds(String(item)))));
}

function linkRunIds(text) {
  const parts = text.split(/(run-[A-Za-z0-9._-]+)/g).filter((part) => part.length);
  return parts.map((part) => {
    if (!/^run-[A-Za-z0-9._-]+$/.test(part)) {
      return part;
    }
    const button = el("button", { className: "link-button", type: "button" }, part);
    button.addEventListener("click", () => {
      focusRun(part);
      selectTab("runs");
    });
    return button;
  });
}

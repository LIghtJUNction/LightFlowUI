const state = {
  apiBase: localStorage.getItem("lightflow.apiBase") || "http://127.0.0.1:5174",
  nodes: [],
  categories: [],
  executorCatalog: null,
  executors: [],
  modelCatalog: null,
  models: [],
  runCatalog: null,
  runs: [],
  artifacts: [],
  patches: [],
  loopReport: null,
  loopError: "",
  loopChanges: null,
  loopChangesError: "",
  projectWorkspaces: null,
  projectWorkspacesError: "",
  publishCatalog: null,
  publishCatalogError: "",
  releaseReport: null,
  releaseError: "",
  workflows: {},
  workflowErrors: {},
  workflowLoading: new Set(),
  plans: {},
  planErrors: {},
  planLoading: new Set(),
  loopReports: {},
  loopErrors: {},
  loopLoading: new Set(),
  selectedLoopRequireReplay: false,
  publishChecks: {},
  publishErrors: {},
  publishLoading: new Set(),
  releaseReports: {},
  releaseErrors: {},
  releaseLoading: new Set(),
  selectedNodeId: null,
  selectedRunId: null,
  selectedPatchName: "",
  modelFilters: {
    workflow: "",
    status: "all",
  },
  runFilters: {
    workflow: "",
    status: "",
    limit: "100",
  },
  artifactFilters: {
    run: "",
    workflow: "",
    kind: "",
    limit: "100",
  },
  runPatchDraft: "",
  patchDraft: '{\n  "nodes": {}\n}',
};

const els = {
  statusText: document.querySelector("#statusText"),
  connectionForm: document.querySelector("#connectionForm"),
  apiBase: document.querySelector("#apiBase"),
  nodeFilter: document.querySelector("#nodeFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  nodeList: document.querySelector("#nodeList"),
  nodeDetail: document.querySelector("#nodeDetail"),
  executorList: document.querySelector("#executorList"),
  modelFilterForm: document.querySelector("#modelFilterForm"),
  modelWorkflowFilter: document.querySelector("#modelWorkflowFilter"),
  modelStatusFilter: document.querySelector("#modelStatusFilter"),
  modelFilterReset: document.querySelector("#modelFilterReset"),
  modelList: document.querySelector("#modelList"),
  runFilterForm: document.querySelector("#runFilterForm"),
  runWorkflowFilter: document.querySelector("#runWorkflowFilter"),
  runStatusFilter: document.querySelector("#runStatusFilter"),
  runLimitFilter: document.querySelector("#runLimitFilter"),
  runFilterReset: document.querySelector("#runFilterReset"),
  runList: document.querySelector("#runList"),
  runDetail: document.querySelector("#runDetail"),
  patchList: document.querySelector("#patchList"),
  patchDetail: document.querySelector("#patchDetail"),
  artifactFilterForm: document.querySelector("#artifactFilterForm"),
  artifactRunFilter: document.querySelector("#artifactRunFilter"),
  artifactWorkflowFilter: document.querySelector("#artifactWorkflowFilter"),
  artifactKindFilter: document.querySelector("#artifactKindFilter"),
  artifactLimitFilter: document.querySelector("#artifactLimitFilter"),
  artifactFilterReset: document.querySelector("#artifactFilterReset"),
  artifactList: document.querySelector("#artifactList"),
  loopDetail: document.querySelector("#loopDetail"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
};

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

async function apiGet(path) {
  const response = await fetch(`${state.apiBase}${path}`);
  return readResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(`${state.apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse(response);
}

async function apiDelete(path) {
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

function renderExecutors() {
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

function renderModels() {
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

function renderLoop() {
  if (state.loopError) {
    els.loopDetail.replaceChildren(panel("Local Loop", [el("pre", {}, state.loopError)]));
    return;
  }
  if (!state.loopReport) {
    els.loopDetail.replaceChildren(emptyNode("No loop report"));
    return;
  }
  const children = [loopReportView(state.loopReport, { compact: true })];
  if (state.loopChanges) {
    children.push(loopChangesView(state.loopChanges));
  }
  if (state.loopChangesError) {
    children.push(panel("Source Change Safety", [el("pre", {}, state.loopChangesError)]));
  }
  if (state.projectWorkspaces) {
    children.push(projectWorkspacesView(state.projectWorkspaces));
  }
  if (state.projectWorkspacesError) {
    children.push(panel("Project Workspaces", [el("pre", {}, state.projectWorkspacesError)]));
  }
  if (state.publishCatalog) {
    children.push(publishCatalogView(state.publishCatalog));
  }
  if (state.publishCatalogError) {
    children.push(panel("Publish Readiness", [el("pre", {}, state.publishCatalogError)]));
  }
  if (state.releaseReport) {
    children.push(releaseReportView(state.releaseReport));
  }
  if (state.releaseError) {
    children.push(panel("Release Readiness", [el("pre", {}, state.releaseError)]));
  }
  els.loopDetail.replaceChildren(el("div", { className: "stack" }, children));
}

function loopReportView(report, options = {}) {
  const checks = report.checks || [];
  const failed = report.failed ?? checks.filter((check) => check.status === "failed").length;
  const warning = report.warnings ?? checks.filter((check) => check.status === "warning").length;
  const passed = report.passed ?? checks.filter((check) => check.status === "passed").length;
  const body = [
    el("div", { className: "inline-list" }, [
      badge(report.valid ? "ok" : "danger", report.valid ? "valid" : "blocked"),
      report.workflow_id ? badge(null, report.workflow_id) : badge(null, "project"),
      badge("ok", `${passed} passed`),
      warning ? badge("warn", `${warning} warning`) : null,
      failed ? badge("danger", `${failed} failed`) : null,
      report.issues?.length ? badge("danger", `${report.issues.length} issues`) : null,
      report.warning_messages?.length ? badge("warn", `${report.warning_messages.length} warnings`) : null,
    ].filter(Boolean)),
    el("div", { className: "meta-grid" }, [
      metric("Project", report.project_root || ""),
      metric("Workflow", report.workflow_id || "all workflows"),
      report.replay_run_id ? kv("Replay Run", linkRunIds(report.replay_run_id)) : null,
      metric("Checks", String(checks.length)),
      metric("Next Commands", String(report.next_commands?.length || 0)),
    ].filter(Boolean)),
    report.issues?.length ? list(report.issues) : null,
    report.warning_messages?.length ? list(report.warning_messages) : null,
    sectionTitle("Checks"),
    loopCheckTable(checks),
  ];
  if (options.compact && report.workflow_id && report.next_commands?.length) {
    body.push(sectionTitle("Next Commands"), commandList(report.next_commands));
  } else if (!options.compact) {
    body.push(sectionTitle("Next Commands"), commandList(report.next_commands || []));
  }
  if (options.compact) {
    return el("div", { className: "stack" }, body);
  }
  return panel("Local Workflow Loop", body);
}

function loopCheckTable(checks) {
  if (!checks.length) {
    return emptyNode("No checks");
  }
  return table(["Status", "Check", "Message", "Path", "Count"], checks.map((check) => [
    check.status || "",
    check.id || "",
    check.message || "",
    check.path || "",
    check.count === undefined ? "" : String(check.count),
  ]));
}

function loopChangesView(report) {
  const changes = report.changed_workflows || [];
  const failed = report.failed ?? changes.filter((change) => change.status === "failed").length;
  const warning = report.warnings ?? changes.filter((change) => change.status === "warning").length;
  const passed = report.passed ?? changes.filter((change) => change.status === "passed").length;
  return panel("Source Change Safety", [
    el("div", { className: "inline-list" }, [
      badge(report.valid ? "ok" : "danger", report.valid ? "valid" : "blocked"),
      changes.length ? badge(null, `${changes.length} changed workflows`) : badge("ok", "no workflow changes"),
      passed ? badge("ok", `${passed} passed`) : null,
      warning ? badge("warn", `${warning} warning`) : null,
      failed ? badge("danger", `${failed} failed`) : null,
      report.issues?.length ? badge("warn", `${report.issues.length} issues`) : null,
      report.blockers?.length ? badge("danger", `${report.blockers.length} blockers`) : null,
      report.warning_messages?.length ? badge("warn", `${report.warning_messages.length} warnings`) : null,
    ].filter(Boolean)),
    report.issues?.length ? list(report.issues) : null,
    report.blockers?.length ? list(report.blockers) : null,
    report.warning_messages?.length ? list(report.warning_messages) : null,
    changes.length
      ? table(["Status", "Workflow", "Changed", "Message", "Workflow Paths", "Skill Paths", "Patch Paths"], changes.map((change) => [
        change.status || "",
        change.workflow_key || "",
        changeFlags(change),
        change.message || "",
        (change.workflow_paths || []).join(", "),
        (change.skill_paths || []).join(", "),
        (change.patch_paths || []).join(", "),
      ]))
      : emptyNode("No workflow source changes"),
  ].filter(Boolean));
}

function changeFlags(change) {
  return [
    change.workflow_changed ? "workflow" : "",
    change.skill_changed ? "skill" : "",
    change.patch_changed ? "patch" : "",
  ].filter(Boolean).join(", ");
}

function projectWorkspacesView(report) {
  const workspaces = report.workspaces || [];
  return panel("Project Workspaces", [
    el("div", { className: "inline-list" }, [
      badge(report.valid ? "ok" : "warn", report.valid ? "linked" : "incomplete"),
      badge(null, `${report.linked_count ?? 0}/${report.expected_count ?? 0} linked`),
      badge(null, `${report.workflow_crate_count ?? 0} workflow crates`),
      report.missing_count ? badge("warn", `${report.missing_count} missing`) : null,
      report.not_symlink_count ? badge("warn", `${report.not_symlink_count} not symlink`) : null,
      report.broken_count ? badge("danger", `${report.broken_count} broken`) : null,
      report.issues?.length ? badge("warn", `${report.issues.length} issues`) : null,
    ].filter(Boolean)),
    el("div", { className: "meta-grid" }, [
      metric("Projects Dir", report.projects_dir || ""),
      metric("Present", String(report.present_count ?? workspaces.filter((workspace) => workspace.exists).length)),
      metric("Expected", String(report.expected_count ?? 0)),
      metric("Crates", String(report.workflow_crate_count ?? 0)),
    ]),
    report.issues?.length ? list(report.issues) : null,
    workspaces.length
      ? table(["Status", "Workspace", "Crates", "Path", "Target", "Resolved", "Issues"], workspaces.map((workspace) => [
        workspaceStatus(workspace),
        workspace.label || workspace.name || "",
        String(workspace.workflow_crate_count ?? 0),
        workspace.path || "",
        workspace.target || "",
        workspace.resolved_path || "",
        (workspace.issues || []).join("; "),
      ]))
      : emptyNode("No project workspaces"),
  ].filter(Boolean));
}

function workspaceStatus(workspace) {
  if (workspace.broken) {
    return "broken";
  }
  if (!workspace.exists) {
    return workspace.expected ? "missing" : "absent";
  }
  if (workspace.expected && !workspace.is_symlink) {
    return "not symlink";
  }
  if (workspace.is_symlink) {
    return "linked";
  }
  return workspace.expected ? "present" : "extra";
}

function publishCatalogView(catalog) {
  const checks = catalog.checks || [];
  const total = catalog.total ?? checks.length;
  const blocked = catalog.blocked_count ?? checks.filter((check) => !check.publishable).length;
  const publishable = catalog.publishable_count ?? checks.filter((check) => check.publishable).length;
  return panel("Publish Readiness", [
    el("div", { className: "inline-list" }, [
      badge(catalog.publishable ? "ok" : "warn", catalog.publishable ? "publishable" : "blocked"),
      badge(null, `${total} crates`),
      checks.length ? badge(null, "dependency ordered") : null,
      publishable ? badge("ok", `${publishable} publishable`) : null,
      blocked ? badge("warn", `${blocked} blocked`) : null,
      catalog.commands?.length ? badge(null, `${catalog.commands.length} commands`) : null,
      catalog.issues?.length ? badge("warn", `${catalog.issues.length} issues`) : null,
    ].filter(Boolean)),
    catalog.commands?.length ? sectionTitle("Commands") : null,
    catalog.commands?.length ? commandList(catalog.commands) : null,
    checks.length
      ? table(["Order", "Workspace", "Workflow", "Package", "Version", "Status", "Internal Deps", "Command", "Manifest", "Issues"], checks.map((check, index) => [
        String(index + 1),
        check.workspace || "",
        check.workflow_id || "",
        check.package || "",
        check.version || "",
        check.publishable ? "publishable" : "blocked",
        (check.internal_dependencies || []).join(", "),
        (check.command || []).join(" "),
        check.manifest || "",
        (check.issues || []).join("; "),
      ]))
      : emptyNode("No workflow crates"),
  ]);
}

function releaseReportView(report, options = {}) {
  const checks = report.checks || [];
  const failed = report.failed ?? checks.filter((check) => check.status === "failed").length;
  const planned = report.planned ?? checks.filter((check) => check.status === "planned").length;
  const passed = report.passed ?? checks.filter((check) => check.status === "passed").length;
  const warning = report.warning_count ?? checks.filter((check) => check.status === "warning").length;
  const skipped = report.skipped ?? checks.filter((check) => check.status === "skipped").length;
  const review = checks.filter((check) => check.kind === "review").length;
  const commandChecks = releaseCommandChecks(checks);
  return panel("Release Readiness", [
    el("div", { className: "inline-list" }, [
      badge(report.valid ? "ok" : "danger", report.valid ? "valid" : "blocked"),
      badge(report.dry_run ? null : "warn", report.dry_run ? "dry run" : "apply"),
      report.workflow_id ? badge(null, report.workflow_id) : null,
      review ? badge(null, `${review} review`) : null,
      passed ? badge("ok", `${passed} passed`) : null,
      warning ? badge("warn", `${warning} warning`) : null,
      planned ? badge(null, `${planned} planned`) : null,
      skipped ? badge("warn", `${skipped} skipped`) : null,
      failed ? badge("danger", `${failed} failed`) : null,
      report.issues?.length ? badge("danger", `${report.issues.length} issues`) : null,
      report.warnings?.length ? badge("warn", `${report.warnings.length} warnings`) : null,
    ].filter(Boolean)),
    options.compact ? null : el("div", { className: "meta-grid" }, [
      metric("Project", report.project_root || ""),
      metric("Workflow", report.workflow_id || ""),
      metric("Checks", String(checks.length)),
    ]),
    report.issues?.length ? list(report.issues) : null,
    report.warnings?.length ? list(report.warnings) : null,
    commandChecks.length ? sectionTitle("Command Gates") : null,
    commandChecks.length ? releaseCommandList(commandChecks) : null,
    checks.length
      ? table(["Status", "Kind", "Gate", "Message", "Details", "Count", "Command", "Path"], checks.map((check) => [
        check.status || "",
        check.kind || "",
        check.id || "",
        check.message || "",
        (check.details || []).join("\n"),
        check.count === undefined ? "" : String(check.count),
        (check.command || []).join(" "),
        check.path || "",
      ]))
      : emptyNode("No release checks"),
  ].filter(Boolean));
}

function releaseCommandChecks(checks) {
  return checks.filter((check) => check.command?.length);
}

function releaseCommandList(checks) {
  return el("div", { className: "command-list" }, checks.map((check) =>
    el("div", { className: "command-gate" }, [
      el("div", { className: "inline-list" }, [
        badge(check.status === "failed" ? "danger" : check.status === "passed" ? "ok" : check.status === "skipped" ? "warn" : null, check.status || ""),
        badge(null, check.id || "command"),
      ]),
      check.message ? el("small", { className: "muted" }, check.message) : null,
      commandRow(check.command),
    ].filter(Boolean)),
  ));
}

function commandList(commands) {
  if (!commands.length) {
    return emptyNode("No commands");
  }
  return el("div", { className: "command-list" }, commands.map(commandRow));
}

function commandRow(command) {
  const text = Array.isArray(command) ? command.join(" ") : String(command);
  const output = el("small", { className: "muted" }, "");
  const copy = el("button", { type: "button" }, "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      output.textContent = "Copied";
    } catch (error) {
      output.textContent = "Copy failed";
    }
  });
  return el("div", { className: "command-row" }, [
    el("code", {}, text),
    copy,
    output,
  ]);
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

function panel(title, children) {
  return el("section", { className: "panel" }, [
    el("div", { className: "panel-header" }, [el("h3", {}, title)]),
    el("div", { className: "panel-body stack" }, children),
  ]);
}

function sectionTitle(text) {
  return el("h3", {}, text);
}

function portList(ports) {
  if (!ports.length) {
    return emptyNode("No ports");
  }
  return el("div", { className: "port-list" }, ports.map((port) =>
    el("div", { className: "port-row" }, [
      el("strong", {}, port.name),
      el("code", {}, port.type),
      el("div", {}, [
        el("div", { className: "inline-list" }, [
          port.required ? badge("warn", "required") : badge(null, "optional"),
          port.widget ? badge(null, port.widget) : null,
          port.artifact_kind ? badge(null, port.artifact_kind) : null,
          port.model_requirement ? badge(null, port.model_requirement) : null,
        ].filter(Boolean)),
        port.description ? el("small", { className: "muted" }, port.description) : null,
      ].filter(Boolean)),
    ]),
  ));
}

function runtimeList(runtimes) {
  return el("div", { className: "stack" }, runtimes.map((runtime) =>
    el("div", { className: "metric" }, [
      el("strong", {}, runtime.capability),
      el("span", {}, runtime.engine || runtime.id),
      el("div", { className: "inline-list" }, runtime.executors.map((executor) =>
        badge(executor.available ? "ok" : "warn", `${executor.kind}:${executor.id}`),
      )),
    ]),
  ));
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

function metric(label, value) {
  return el("div", { className: "metric" }, [
    el("span", {}, label),
    el("strong", {}, value),
  ]);
}

function table(headers, rows) {
  return el("div", { className: "table-wrap" }, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, headers.map((header) => el("th", {}, header)))]),
      el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell) => {
        const value = cell instanceof Node ? cell : String(cell);
        return el("td", {}, value);
      })))),
    ]),
  ]);
}

function jsonBlock(value) {
  return el("pre", {}, JSON.stringify(value, null, 2));
}

function badge(kind, text) {
  return el("span", { className: ["badge", kind].filter(Boolean).join(" ") }, text);
}

function option(value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function kv(key, value) {
  return el("div", {}, [el("dt", {}, key), el("dd", {}, value)]);
}

function emptyNode(text) {
  const node = els.emptyTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("h2").textContent = text;
  node.querySelector("p").textContent = "";
  return node;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (key === "className") {
      node.className = value;
    } else if (key === "htmlFor") {
      node.htmlFor = value;
    } else {
      node.setAttribute(key, value);
    }
  });
  const childList = Array.isArray(children) ? children : [children];
  childList.filter((child) => child !== null && child !== undefined).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

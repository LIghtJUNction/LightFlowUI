import { apiDelete, apiGet, apiPost } from "./api-client.js";
import { els, state } from "./app-state.js";
import { badge, el, emptyNode, jsonBlock, kv, panel, sectionTitle, table } from "./ui-elements.js";

const callbacks = {
  focusRun: async () => {},
  linkRunIds: (text) => [text],
  refreshArtifacts: async () => {},
  refreshHistory: async () => {},
  selectTab: () => {},
  syncArtifactFilterInputs: () => {},
};

export function configureRunView(options) {
  Object.assign(callbacks, options);
}

export function renderRuns() {
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
      ...callbacks.linkRunIds(catalog.unknown_run_ids.slice(0, 5).join(", ")),
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

export async function selectRun(runId, rerenderList = true) {
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
        await callbacks.focusRun(replayed.run_id);
      } else {
        await callbacks.refreshHistory();
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
      await callbacks.refreshHistory();
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

export function renderArtifacts() {
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
          callbacks.selectTab("runs");
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
  callbacks.syncArtifactFilterInputs();
  callbacks.selectTab("artifacts");
  await callbacks.refreshArtifacts();
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

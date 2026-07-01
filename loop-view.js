import { els, state } from "./app-state.js";
import {
  badge,
  el,
  emptyNode,
  jsonBlock,
  kv,
  metric,
  panel,
  sectionTitle,
  table,
} from "./ui-elements.js";

let renderRunLinks = (text) => text;

export function configureLoopView(options) {
  renderRunLinks = options.linkRunIds;
}

function linkedList(items) {
  return el("ul", {}, items.map((item) => el("li", {}, renderRunLinks(String(item)))));
}

export function renderLoop() {
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

function loopReportView(report, options = {}

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
    report.issues?.length ? linkedList(report.issues) : null,
    report.blockers?.length ? linkedList(report.blockers) : null,
    report.warning_messages?.length ? linkedList(report.warning_messages) : null,
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
    report.issues?.length ? linkedList(report.issues) : null,
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

function releaseReportView(report, options = {}

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

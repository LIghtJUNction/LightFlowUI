import { apiDelete, apiGet, apiPost } from "./api-client.js";
import { els, state } from "./app-state.js";
import { badge, el, jsonBlock, option, panel } from "./ui-elements.js";

const callbacks = {
  formField: (label, hint, input) => input,
  patchAction: async () => {},
  patchValidationView: () => el("div"),
  renderNodeDetail: () => {},
  selectTab: () => {},
};

export function configurePatchView(options) {
  Object.assign(callbacks, options);
}

export function renderPatches() {
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

export function renderPatchDetail() {
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
    await callbacks.patchAction(result, async () => {
      const query = workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : "";
      return apiPost(`/patches/validate${query}`, JSON.parse(patchInput.value));
    }, (validation) => callbacks.patchValidationView(validation, workflowId));
  });

  saveButton.addEventListener("click", async () => {
    await callbacks.patchAction(result, async () => {
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
    await callbacks.patchAction(result, async () => {
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
      callbacks.selectTab("node");
      callbacks.renderNodeDetail();
      return validation;
    }, (validation) => {
      if (!validation.valid) {
        return callbacks.patchValidationView(validation, selectedWorkflowId);
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
    await callbacks.patchAction(result, async () => {
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
      callbacks.formField("Name", "Required", nameInput),
      callbacks.formField("Validate against", "Optional", workflowSelect),
      callbacks.formField("Patch JSON", "Serializable workflow patch", patchInput),
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

async function reloadPatchList() {
  const patches = await apiGet("/patches");
  state.patches = patches.patches || [];
  renderPatchList();
  callbacks.renderNodeDetail();
}

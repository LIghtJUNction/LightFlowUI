# LightFlowUI

LightFlowUI is a small backend-backed editor client for LightFlow. It treats
the Rust workflow crates and the HTTP API as the source of truth.

## Run

Start the backend from the LightFlow repository root:

```bash
cargo run --bin lfw -- serve --port 5174
```

Open `http://127.0.0.1:5174/ui` in a browser. Opening `index.html` directly
also works when you want a file-backed fallback. The API base defaults to
`http://127.0.0.1:5174` and can be changed in the header.

Check the API contract used by the static client:

```bash
node smoke.mjs http://127.0.0.1:5174 lightflow.text_plan
```

Parse every module in ES-module mode (catches module-only syntax errors that
`node --check` misses):

```bash
node --experimental-vm-modules parse-check.mjs
```

## Scope

- Node catalog and node detail from `/nodes`.
- Read-only workflow graph nodes and edges from `/workflows/{workflow_id}`.
- Executor registry status from `/executors`, including availability reasons,
  data policies, capability coverage, and model-planning flags.
- Runtime plan preview from `/workflows/{workflow_id}/plan`.
- Filtered model catalog and lock status from `/models`, including variants,
  hashes, local paths, missing paths, and sync/verify commands.
- Filtered run history, timeline traces, node runtime details, replay drift,
  run deletion, trace-to-artifact navigation, and filtered artifact inspection
  from `/runs` and `/artifacts`.
- Replay evidence and warning rows link directly to run traces, even when the
  current run list is filtered.
- Replay actions clear run filters and focus the newly recorded replay trace.
- Runtime run forms generated from Node Schema metadata, with selected-workflow
  patch preflight before execution.
- Temporary enabled/disabled node lists and patch JSON passed through the HTTP
  run contract.
- Patch registry list/load/validate/save/delete from `/patches`, with
  readable validation results and registered patches expanded into run patch
  JSON before execution.
- Patch drafts are validated against the selected workflow before being handed
  into its run form for a non-destructive patched run.
- Project and selected-workflow readiness from `/loop` and
  `/workflows/{workflow_id}/loop`, including strict replay-evidence checks.
- Source change safety from `/loop/changes`, including aggregate counts and
  blockers for workflow edits that need colocated agent skill updates before
  review or publish.
- Dependency-ordered workspace and selected-workflow publish preflight from
  `/publish` and `/workflows/{workflow_id}/publish`, including copyable dry-run
  commands.
- Project and selected-workflow release gate planning from `/release`, including
  required artifacts, document sections, source-change review, and copyable
  command gates without executing them.

The editor does not store a separate workflow format. Write support should stay
behind backend contracts and reviewable Rust source changes.

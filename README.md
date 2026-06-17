# LightFlowUI

Frontend development is paused.

This repository is intentionally reset to an empty placeholder. The previous Rust/WASM workflow canvas was removed because the frontend should not drive the product shape before the backend API is stable.

Next frontend work should start from the backend API contract, not from this old implementation.

## Current Scope

- Keep this repository minimal.
- Do not add UI behavior until the LightFlow backend API is designed.
- Treat backend workflow, asset, run, and API contracts as the source of truth.
- Reinitialize the frontend stack later when there is a concrete API surface to build against.

## Reinitialization Checklist

1. Define the backend API contract first.
2. Decide the frontend runtime and framework from the API needs.
3. Add only the minimal scaffold needed to verify one backend-backed workflow.
4. Add generated clients or shared schemas after the backend contract is stable.

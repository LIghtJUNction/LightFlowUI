# LightFlowUI

Frontend control console for [LightFlow](https://github.com/LIghtJUNction/LightFlow).

LightFlowUI is a backend-first workflow console. It is designed around the current LightFlow API boundary: assets, run preview, run creation, step submission, refresh, events, and trace inspection.

## Local Development

```bash
bun install
bun run dev
```

## Production Build

```bash
bun run build
```

The app is deployed to GitHub Pages:

```text
https://lightjunction.github.io/LightFlowUI/
```

## Runtime Modes

- Mock mode uses local demo data and is useful while the LightFlow HTTP adapter is still evolving.
- Live mode calls a Linux-hosted LightFlow API endpoint.

The UI does not parse Rust asset files or write CortexFS paths directly. It treats LightFlow as the backend source of truth.

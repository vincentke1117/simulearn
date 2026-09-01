# J-Circuit - Interactive Circuit Simulation Editor

A browser-based editor for circuit design and simulation. Supports common analysis methods, transient analysis, multi-scenario precomputation for switches with instant result switching, voltage overlays, and branch current visualization.

## Highlights

- Editor: drag components, strict port connections, rotation, parameter editing
- Methods: node-voltage, branch-current, mesh-current, Thevenin, transient analysis
- Switches: auto precompute open/closed states; click switch to instantly switch cached results
- Result Panel: tables/waveforms, export to `JSON`/`CSV`
- Voltage Display: `node` vs `element` overlay modes
- Branch Currents: toggle on the top bar to show/hide per-branch currents on canvas
- Shortcuts: `Ctrl+R` run, `Ctrl+Shift+R` toggle result panel

## Tech Stack

- Frontend: `React 19`, `TypeScript`, `Vite`, `@xyflow/react`, `framer-motion`, `Plotly.js basic dist`
- Backend: `Julia` (JCircuitServer), HTTP simulation service

## Quick Start (Windows)

1. Requirements
   - Node.js ≥ 20.19
   - Julia ≥ 1.10
2. Start the backend (repository root):
   ```powershell
   julia --project=packages/lab-backend packages/lab-backend/run_server.jl
   ```
3. Start the frontend (repository root):
   ```powershell
   npm install
   npm run dev:lab
   ```
4. Open the Vite URL shown in the terminal (normally `http://127.0.0.1:3000/editor`)

## Environment Variables

- `VITE_API_BASE_URL`: simulation API base URL; the development server proxies `/api/lab` to `127.0.0.1:8080`

## Usage

- Canvas: drag components from the left panel, connect ports, add `ground` before running
- Top Bar:
  - Select analysis method (node/branch/mesh/Thevenin/transient)
  - Transient params: `tStop`, `nSamples`
  - Voltage display: `node` or `element`
  - Branch current overlay: toggle on/off
- Switch Interactions: first run precomputes all switch combinations; clicking the switch instantly applies cached results
- Result Panel: shows data based on method; supports exporting to `JSON`/`CSV`

## Structure (key parts)

```
packages/
  lab-backend/               # Julia simulation service
  lab-web/
    ├── src/workspace/       # editor workspace and top bar
    ├── src/simulation/      # requests, results, mapping, and payloads
    ├── src/canvas/          # nodes and custom edges
    ├── src/circuit/         # component library and icons
    ├── src/pages/Editor.tsx # router entry
    └── vite.config.ts       # Vite configuration
```

## Troubleshooting

- Backend not ready: health/metrics errors on home can be ignored; refresh once backend is up
- Browser extensions causing CORS (e.g., `h.trace.qq.com`): unrelated to this project, ignore
- Font CDN timeouts: harmless; use local fonts if preferred

## Build & Preview

```powershell
npm run build:lab
npm run preview -w @simulearn/lab-web
npm run test:lab
```

## License & Contributing

- License: Apache License 2.0 (see repository root `LICENSE`)
- Contributions welcome via Issues and PRs

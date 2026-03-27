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

- Frontend: `React 19`, `TypeScript`, `Vite`, `@xyflow/react`, `framer-motion`, `react-plotly.js`
- Backend: `Julia` (JCircuitServer), HTTP simulation service

## Quick Start (Windows)

1. Requirements
   - Node.js ≥ 18
   - Julia ≥ 1.9
2. Start backend (project root):
   ```powershell
   julia --project=server server/start_server.jl
   ```
3. Start frontend (`web/`):
   ```powershell
   npm install
   npm run dev
   ```
4. Open the editor: `http://localhost:3000/editor`

## Environment Variables

- `VITE_API_BASE_URL`: backend base URL, defaults to `http://localhost:8080`

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
server/                      # Julia backend
web/
  ├── src/
  │   ├── workspace/         # editor workspace & top bar
  │   ├── simulation/        # requests, result panel, mapping & payload
  │   ├── canvas/            # nodes, custom edges
  │   ├── circuit/           # component library & icons
  │   ├── pages/Editor.tsx   # router entry (editor only)
  │   ├── types/             # TypeScript types
  │   └── utils/             # utilities
  ├── README.md              # Chinese docs
  ├── README.en.md           # English docs
  ├── DEVELOPER_GUIDE.md     # Developer Guide (CN)
  ├── DEVELOPER_GUIDE.en.md  # Developer Guide (EN)
  ├── PERFORMANCE_OPTIMIZATION.md      # Performance (CN)
  └── PERFORMANCE_OPTIMIZATION.en.md   # Performance (EN)
```

## Troubleshooting

- Backend not ready: health/metrics errors on home can be ignored; refresh once backend is up
- Browser extensions causing CORS (e.g., `h.trace.qq.com`): unrelated to this project, ignore
- Font CDN timeouts: harmless; use local fonts if preferred

## Build & Preview

```powershell
npm run build
npm run preview
```

## License & Contributing

- License: Apache License 2.0 (see repository root `LICENSE`)
- Contributions welcome via Issues and PRs

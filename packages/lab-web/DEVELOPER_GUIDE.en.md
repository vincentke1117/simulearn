# Developer Guide (J-Circuit)

## Overview

- Frontend: `web/` (React + TypeScript + Vite)
- Backend: `server/` (Julia, HTTP simulation service)
- Routing: `/editor` entry (`/` redirects to `/editor`)

## Local Development

### Requirements
- Node.js ≥ 18
- Julia ≥ 1.9

### Start Services
1. Backend (project root):
   ```powershell
   julia --project=server server/start_server.jl
   ```
2. Frontend (`web/`):
   ```powershell
   npm install
   npm run dev
   ```
3. Open: `http://localhost:3000/editor`

## Structure (key)

```
server/
web/
  ├── src/
  │   ├── workspace/         # editor workspace & top bar
  │   ├── simulation/        # requests, result panel, mapping & payload
  │   ├── canvas/            # nodes & custom edges
  │   ├── circuit/           # component library & icons (including switch)
  │   ├── pages/Editor.tsx   # single route (editor)
  │   ├── types/             # TypeScript types
  │   └── utils/             # helpers
  ├── README.md / README.en.md
  ├── DEVELOPER_GUIDE.md / DEVELOPER_GUIDE.en.md
  ├── PERFORMANCE_OPTIMIZATION.md / PERFORMANCE_OPTIMIZATION.en.md
```

## Key Modules

- `simulation/payload.ts`: build backend payload (rotation port mapping, switch->resistor)
- `workspace/CircuitWorkspace.tsx`: main editor logic, orchestration, result cache & overlay
- `canvas/CircuitNode.tsx`: node rendering & interactions (switch click toggling)
- `circuit/components.ts`: component definitions (ports, params, labels)
- `circuit/icons.tsx`: SVG icons (switch endpoints aligned left/right)

## Switch & Multi-Scenario Simulation

- First run: enumerate all switch combinations, build payloads, request backend, cache results
- Interaction: clicking a switch instantly applies cached result; no re-simulation
- Payload conversion: switch becomes resistor (closed `≈1e-6Ω`, open `≈1e9Ω`)

## Transient & Display Controls

- Top bar transient params: `tStop`, `nSamples`
- Voltage overlay modes: `node` / `element`
- Branch current overlay: toggle visibility on canvas

## QA & Commands

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Build: `npm run build`

## Troubleshooting

- Backend not ready: health/metrics errors can be ignored; refresh after backend starts
- Browser extension CORS (e.g., `h.trace.qq.com`): unrelated to project, ignore
- Font CDN timeout: harmless; switch to local fonts if needed

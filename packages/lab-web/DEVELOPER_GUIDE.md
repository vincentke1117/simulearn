# 开发者指南（J-Circuit）

中文 | [English](./DEVELOPER_GUIDE.en.md)

## 项目概览

- 前端：`web/`（React + TypeScript + Vite）
- 后端：`server/`（Julia，HTTP 仿真服务）
- 入口路由：`/editor`（`/` 重定向到 `/editor`）

## 本地开发

### 环境要求
- Node.js ≥ 18
- Julia ≥ 1.9

### 启动服务
1. 启动后端（仓库根目录）：
   ```powershell
   julia --project=server server/start_server.jl
   ```
2. 启动前端（`web/` 目录）：
   ```powershell
   npm install
   npm run dev
   ```
3. 访问地址：`http://localhost:3000/editor`

## 目录结构（关键）

```
server/
web/
  ├── src/
  │   ├── workspace/         # 编辑器工作区与顶栏
  │   ├── simulation/        # 仿真请求、结果面板、映射与载荷构建
  │   ├── canvas/            # 画布节点与自定义边
  │   ├── circuit/           # 元件库与图标（含开关）
  │   ├── pages/Editor.tsx   # 单一路由页面（编辑器）
  │   ├── types/             # 类型定义
  │   └── utils/             # 工具函数
  ├── README.md              # 使用说明（中文）
  ├── README.en.md           # 使用说明（英文）
  ├── DEVELOPER_GUIDE.md     # 开发者指南（中文）
  ├── DEVELOPER_GUIDE.en.md  # 开发者指南（英文）
  ├── PERFORMANCE_OPTIMIZATION.md      # 性能优化（中文）
  └── PERFORMANCE_OPTIMIZATION.en.md   # 性能优化（英文）
```

## 关键模块说明

- `simulation/payload.ts`：构建后端仿真载荷（含旋转端口映射、开关转电阻等）
- `workspace/CircuitWorkspace.tsx`：编辑器主逻辑、仿真 orchestrator、结果缓存与覆盖应用
- `canvas/CircuitNode.tsx`：节点渲染与交互（开关点击切换）
- `circuit/components.ts`：元件定义（端口、参数、标签）
- `circuit/icons.tsx`：SVG 图标（开关左右端口对齐）

## 开关与多场景仿真

- 首次仿真：枚举电路中所有开关的开/关组合，分别构建载荷并调用后端，结果缓存
- 交互切换：点击开关立即根据当前组合从缓存读取结果并应用，无需再次请求
- 载荷转换：开关按状态转换为电阻（闭合 `≈1e-6Ω`，断开 `≈1e9Ω`）

## 瞬态参数与显示控制

- 顶栏可设置瞬态参数：`tStop`、`nSamples`
- 电压显示模式：`node` / `element`
- 支路电流显示：可切换在画布覆盖中显示/隐藏

## 代码规范与校验

- 类型检查：`npm run typecheck`
- 代码规范：`npm run lint`
- 构建：`npm run build`

## 常见问题

- 后端未就绪导致健康检查报错：启动后刷新即可
- 浏览器扩展触发跨域请求报错（如 `h.trace.qq.com`）：与项目无关，可忽略
- 字体 CDN 加载超时：不影响功能，可忽略或改用本地字体

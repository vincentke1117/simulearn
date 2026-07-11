# SimuLearn — 电气工程仿真学习平台

一个域名下的两间实验室，Julia 计算内核驱动，本机运行、数据不出本地：

| 模块 | 路径 | 内核 | 能力 |
|---|---|---|---|
| **电路实验室** | `/circuit/` | `packages/lab-backend`（ModelingToolkit / DifferentialEquations，端口 8080） | 电路瞬态分析、DC 教学解法（节点电压/支路电流/网孔/戴维南）、控制系统信号流、电路+控制混合仿真、开关多场景对比 |
| **配电网实验室** | `/grid/` | `packages/grid-backend`（PowerModels / JuMP / Ipopt / Juniper，端口 8123） | AC 潮流、网络重构 + 分布式电源联合优化（网损最小）、IEEE 33 节点金标准算例 |

前端分别为 `packages/lab-web`（React 19 + React Flow）与 `packages/grid-web`（TypeScript + JointJS），由 **Caddy 网关（端口 8100）** 统一托管并反代 API（`/api/lab/*` → 8080，`/api/grid/*` → 8123）。

## 快速开始

```powershell
# 0. 首次：安装依赖 + 构建前端（Julia 环境按 Manifest 精确锁定）
npm install
npm run build:lab && npm run build -w @simulearn/grid-web
julia --project=packages/lab-backend  -e "using Pkg; Pkg.instantiate()"
julia --project=packages/grid-backend -e "using Pkg; Pkg.instantiate()"

# 1. 一键启动（2 个 Julia 后端 + 网关）
powershell -File scripts/start-all.ps1
```

就绪后访问 **<http://127.0.0.1:8100>**。首次启动含 Julia 编译约 1–2 分钟；之后潮流/DC 分析为毫秒级，首个瞬态仿真因 MTK JIT 需要额外等待。

可选加速：`julia packages/grid-backend/scripts/build_sysimage.jl` 构建 sysimage（一次约 20 分钟，产物 ~680MB），此后 start-all 自动使用，配电网内核启动从 ~30s 降到 ~7s（实测 4.2×）。JGDO 源码大改后建议重建。

## 仓库结构

```
gateway/            Caddyfile + 静态首页（gateway/bin/caddy.exe 本地下载，不入库）
packages/
  lab-web/          电路实验室前端（React 19 + @xyflow/react + Plotly）
  lab-backend/      电路仿真内核（Julia：MTK 9 / DiffEq 7，Manifest 锁定）
  grid-web/         配电网实验室前端（TypeScript + JointJS v4）
  grid-backend/     配电网内核（Julia：PowerModels 0.21 / JuMP，Manifest 锁定；含 IEEE33 金标准测试）
scripts/start-all.ps1   一键启动编排
src/                旧平台壳（全 mock，待重建，勿在其上开发）
```

> **两个 Julia 内核必须保持独立进程**：MTK 9 的 compat 钉死 `DataStructures 0.18` 而 PowerModels 栈需要 0.19，合并环境在依赖层面不可解。产品统一靠网关，不靠进程合一。

## 开发

```bash
npm run check          # 门禁：lab-web 类型检查(tsc -b) + vitest
npm run dev:lab        # lab-web 开发服务器（/api/lab 自动代理到 8080）
npm run dev -w @simulearn/grid-web   # grid-web 开发服务器（/api 代理到 8123）
julia --project=packages/grid-backend -e "using Pkg; Pkg.test()"   # 含 IEEE33 金标准断言
julia --project=packages/lab-backend  -e "using Pkg; Pkg.test()"
```

契约要点：统一响应封套 `{status, code?, message, data}`；工程数据 localStorage 键一律 `slp:<module>:*` 命名空间；两后端只绑 `127.0.0.1`，跨域由网关同源化解决。

## 项目源流

本仓库整合自三个项目：J-Circuit（已归档，代码演进为 `lab-*`）、PowerJulia（内核与前端迁入为 `grid-*`）、simulearn 平台壳。整合方案与路线见各自仓库的归档说明。

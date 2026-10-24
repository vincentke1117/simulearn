# SimuLearn 开发约定

给人和 AI 编码工具读的项目约定。产品方向、范围、里程碑与验收以 [`docs/design/v1-design-record.md`](docs/design/v1-design-record.md) 为准，动手前先读它；本文件只写「怎么在这个仓库里干活」。

## 项目是什么

- 电气工程仿真学习平台：电路实验室（lab）与配电网实验室（grid），Julia 计算内核 + Web 前端。
- 当前阶段：先把配电网实验室做成知帆客户端拓展 `simulearn-grid`（第十二章调压试点），之后再做 Tauri 桌面版。阶段划分见设计记录第 5 节。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `packages/lab-web` | 电路实验室前端（React 19 + @xyflow/react） |
| `packages/lab-backend` | 电路内核（Julia：MTK 9 / DiffEq，Manifest 锁定） |
| `packages/grid-web` | 配电网实验室前端（TypeScript + JointJS v4） |
| `packages/grid-backend` | 配电网内核（Julia：PowerModels 0.21 / JuMP，Manifest 锁定） |
| `contracts/{grid,lab}/*.json` | 两个内核共享的解析解金标准契约夹具 |
| `gateway/` | 开发态网关（Caddy，端口 8100）与静态首页 |
| `scripts/`、`tests/scripts/` | 启停编排与它的 Pester 测试；打包脚本也放这里 |
| `docs/` | 设计记录与帮助源文件 |

根目录的 `src/`、`index.html`、`vite.config.ts`、`tasks.json` 和几份旧 `.md` 是废弃的旧平台壳，计划在 M1 第一天删除：不要往里加东西，也不要引用它们。

## 不可破坏的约束

1. **两个 Julia 内核必须分进程**：MTK 9 钉死 `DataStructures 0.18`，PowerModels 栈需要 `0.19`，合并环境不可解。
2. **知帆拓展约定 `zhifan-ext/1`**（原文：`D:\workspace\Dev_course\course-site\拓展对接约定.md`）。同一版本号内只能加可选字段，不能改已有字段的含义。拓展必须做到：
   - 启动参数 `--port 0 --token <令牌> --data-dir <目录> --host-version <版本>`；就绪后打一行**以 `{"ready"` 开头**的 JSON。在 Julia 里用 NamedTuple 输出，不能用 `Dict`，因为 `Dict` 的键序不定，会让这一行以别的键开头，宿主就认不出来。
   - 只绑 `127.0.0.1`；所有请求校验 `X-Zhifan-Ext-Token`，不对一律返回 401（含 `/health`）。
   - 页面里只用相对路径（页面实际位于 `/ext/<id>/ui/`）；不用 WebSocket，不用 Cookie。
   - 只写 `--data-dir`，不主动联网；标准输入关闭后 5 s 内退出，连同子进程。
   - 判分在内核里重算后核对，不信页面自报的数。
   - 发布包 zip 的条目名必须用正斜杠：Windows PowerShell 5.1 的 `ZipFile.CreateFromDirectory` 会写反斜杠，知帆宿主解压时会以「不安全路径」拒装。一律用 `scripts/release-ext.ps1` 打包，它打包后会按宿主同样的规则逐条核对。
   - 嵌入页面里不能用 `confirm` / `alert` / `prompt`：宿主的 iframe 沙箱没有 `allow-modals`，浏览器会直接忽略弹窗（`confirm` 返回 `false`），按钮就成了「点了没反应」。需要确认时用页面内的两步确认（`grid-web/src/confirm.ts`）。
3. **本机服务安全（D17）**：内核不发任何跨域头；令牌由宿主或网关在转发时注入，页面拿不到。开发态由 `start-all.ps1` 每次启动生成令牌（环境变量 `SIMULEARN_TOKEN`）；没设置时内核、Caddy、Vite 代理都退回开发令牌 `simulearn-dev`，它只用于本机开发，不进发布物。
4. **响应封套**统一为 `{status, code?, message, data}`，错误码分域 `GRID_*` / `LAB_*`；封套到 HTTP 状态码的映射有测试守着。
5. **契约先行**：每项分析都对应 `contracts/` 里的解析解金标准，改内核先看它红不红。新分析或新元件要同时带「金标准契约 + 至少 1 个内置示例 + 1 页帮助」，三件齐才算完成（D1）。
6. **localStorage** 键一律用 `slp:<module>:*` 命名空间；嵌入模式下按实验 id 隔离。
7. **lab-web 路由**：用 BrowserRouter，`basename` 取自 Vite `base`（构建时为 `/circuit/`），网关侧配套 `try_files` 回退，两者必须一起改。M2 会把它改成相对路径。

## 代码约定

- 新文件不超过 500 行。`JCircuitServer.jl`（2371 行）计划在 M4a 拆分，在那之前不要再往里堆大块新功能，新能力放进单独的文件。
- 跟随周边代码的命名与注释密度；注释用中文，讲「为什么」，不复述代码。
- 用户可见文案用中文。

## 命令

```bash
npm run lint            # 两个前端的严格 ESLint（零 warning）
npm run check           # 两个前端的类型检查 + vitest
npm run build           # 构建两个前端
npm run check:bundle    # lab-web 体积预算
julia --project=packages/grid-backend -e "using Pkg; Pkg.test()"   # 含 grid 金标准契约
julia --project=packages/lab-backend  -e "using Pkg; Pkg.test()"   # 含 lab 金标准契约
powershell -File scripts/start-all.ps1   # 起开发栈（2 个内核 + 网关），访问 http://127.0.0.1:8100
powershell -File scripts/stop-all.ps1
powershell -Command "Invoke-Pester -Path tests/scripts/lifecycle.Tests.ps1"
powershell -File scripts/release-ext.ps1   # 打知帆拓展发布包 dist/ext/simulearn-grid-<版本>.zip（含 ~35 分钟的程序构建；-SkipAppBuild 复用已有程序）
node scripts/fake-zhifan-host.mjs --entry <程序目录>/bin/simulearn-grid.exe   # 假知帆宿主：按 zhifan-ext/1 启动、转发、嵌入，打开 http://127.0.0.1:8200/
node scripts/fake-zhifan-host.mjs --attach 8123 --token simulearn-dev    # 同上，但接已在跑的开发态内核
node scripts/zhifan-rehearsal.mjs   # 用真实知帆客户端（开发版）演练：生成演练课堂包 + 起假下载站，并打印客户端的启动命令
node scripts/ch12-course-kit.mjs     # 第十二章调压实验交给课程站的工程文件与场景，写到 dist/course/ch12/
```

- 改了哪块就跑哪块的门禁；提交前全部门禁都要绿。
- 不提交密钥和 `.env`；推送到远端前先问用户。

## 工作方式

- 事实先查再说：代码、契约夹具、设计记录、约定原文都在本机。不要凭印象下结论。
- 范围超出当前任务、或要改动设计记录里已定的决定时，先说明再动手；确定要改的，在设计记录末尾的「修订记录」里追加一条。

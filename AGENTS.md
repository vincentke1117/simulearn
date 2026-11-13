# SimuLearn 开发约定

给人和 AI 编码工具读的项目约定。产品方向、范围、里程碑与验收以 [`docs/design/v1-design-record.md`](docs/design/v1-design-record.md) 为准，动手前先读它；本文件只写「怎么在这个仓库里干活」。

## 项目是什么

- 电气工程仿真学习平台：电路实验室（lab）与配电网实验室（grid），Julia 计算内核 + Web 前端。
- 当前阶段：两间实验室都做成知帆客户端拓展——配电网 `simulearn-grid`（第十二章调压试点），电路 `simulearn-lab`（2026-11-02 起提前进知帆，原排在 M2）；之后再做 Tauri 桌面版。阶段划分见设计记录第 5 节与修订记录。

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
   - 拓展程序的启动程序用仓库里改过的 `scripts/ext-launcher/embedding_wrapper.c`（两个 `build_ext.jl` 的 `c_driver_program`）：PackageCompiler 自带的那份用窄字符写环境变量，中文 Windows 上安装路径带中文就启动失败。只改启动程序时用 `rebuild_launcher.jl`，不用重建镜像。
   - 拓展程序里不能有「按需下载」的 artifact（学生电脑一启动就去联网）：lab 的 `Project.toml` 设了 `LoadMKL_JLL = false`，`create_app` 配 `include_transitive_dependencies = false`，`build_ext.jl` 构建前会检查。发版前用 `scripts/ext-smoke.mjs` 在隔离环境里冒烟，并且要在系统代码页 936 的机器上跑一遍。
   - 嵌入页面里不能用 `confirm` / `alert` / `prompt`：宿主的 iframe 沙箱没有 `allow-modals`，浏览器会直接忽略弹窗（`confirm` 返回 `false`），按钮就成了「点了没反应」。需要确认时用页面内的两步确认（`grid-web/src/confirm.ts`）。
3. **本机服务安全（D17）**：内核不发任何跨域头；令牌由宿主或网关在转发时注入，页面拿不到。开发态由 `start-all.ps1` 每次启动生成令牌（环境变量 `SIMULEARN_TOKEN`）；没设置时内核、Caddy、Vite 代理都退回开发令牌 `simulearn-dev`，它只用于本机开发，不进发布物。
4. **响应封套**统一为 `{status, code?, message, data}`，错误码分域 `GRID_*` / `LAB_*`；封套到 HTTP 状态码的映射有测试守着。
5. **契约先行**：每项分析都对应 `contracts/` 里的解析解金标准，改内核先看它红不红。新分析或新元件要同时带「金标准契约 + 至少 1 个内置示例 + 1 页帮助」，三件齐才算完成（D1）。
6. **本地存储**键一律用 `slp:<module>:*` 命名空间；嵌入模式下按实验 id 隔离（`slp:<module>:exp:<实验>:`）。**嵌入模式不能用 localStorage 存要留下来的东西**：知帆客户端每次启动给拓展页面换一个本机端口，页面的 localStorage 跟着换来源，重开客户端就读不到。草稿、偏好、「上次打开的案例」都走内核的 `store` 接口（`GET store?prefix=` / `GET store?key=` / `POST store {entries}`），落在 `--data-dir/store/`；页面一侧用各自的 `kernelStore.ts` 同步镜像。非嵌入的开发态仍用 localStorage。
7. **页面只用相对路径**：两个前端都用 hash 路由，构建 `base` 为 `./`，接口地址相对页面（lab-web 是 `../api/lab`，grid-web 是 `../api/grid/`）。同一份 dist 既挂在开发态网关的 `/circuit/`、`/grid/`，也挂在拓展的 `/ext/<id>/ui/`，所以网关不做 SPA 回退，页面里也不能写以 `/` 开头的地址。

## 代码约定

- 新文件不超过 500 行。`JCircuitServer.jl`（2505 行）计划在 M4a 拆分，在那之前不要再往里堆大块新功能，新能力放进单独的文件。
- 跟随周边代码的命名与注释密度；注释用中文，讲「为什么」，不复述代码。
- 用户可见文案用中文。

## 命令

```bash
npm run lint            # 两个前端的严格 ESLint（零 warning）
npm run check           # 两个前端的类型检查 + vitest
npm run build           # 构建两个前端
npm run check:bundle    # lab-web 体积预算
LAB_E2E=1 npx vitest run src/cases/cases.e2e.test.ts   # 在 packages/lab-web 下：案例库逐个对着 8080 上的 lab 内核核对教材答案（CASE=<id> 只跑一个）
LAB_E2E=1 npx vitest run src/cases/demo/demos.e2e.test.ts   # 同上：课堂演示逐步核对读数（DEMO=<案例 id>.<演示 id> 只跑一个；KVL 演示只有离线检查）
LAB_E2E_URL=http://127.0.0.1:<端口>/simulate SIMULEARN_TOKEN=<令牌> npm run test:e2e -w @simulearn/lab-web   # 发版前：全部 e2e（案例、演示、活后端）对着打好包的拓展程序跑，而不是 8080 上的开发态内核
node scripts/demo-layout-check.mjs --size 1600x900   # 课堂演示逐帧布局检查（无头浏览器量重叠 / 穿线 / 出画面并截图，需先起假宿主 --library，见脚本头）
julia --project=packages/grid-backend -e "using Pkg; Pkg.test()"   # 含 grid 金标准契约
julia --project=packages/lab-backend  -e "using Pkg; Pkg.test()"   # 含 lab 金标准契约
powershell -File scripts/start-all.ps1   # 起开发栈（2 个内核 + 网关），访问 http://127.0.0.1:8100
powershell -File scripts/stop-all.ps1
powershell -Command "Invoke-Pester -Path tests/scripts/lifecycle.Tests.ps1"
powershell -File scripts/release-ext.ps1   # 打知帆拓展发布包 dist/ext/simulearn-grid-<版本>.zip（含 ~35 分钟的程序构建；-SkipAppBuild 复用已有程序）
powershell -File scripts/release-ext.ps1 -Id simulearn-lab   # 电路拓展 simulearn-lab（MTK 栈，程序构建 1 小时以上，构建时别开其他吃内存的程序）
node scripts/ext-smoke.mjs dist/ext/<id>-<版本>.zip   # 发版前隔离冒烟：中文和空格路径、空 depot、401 / 422、内存、退出时间、数据目录外写入；还要在代码页 936 的机器上跑
julia scripts/ext-launcher/rebuild_launcher.jl <程序目录> <可执行文件名> <入口函数>   # 只重编拓展的启动程序，不动镜像（用构建这份程序的同一个 Julia）
node scripts/fake-zhifan-host.mjs --entry <程序目录>/bin/simulearn-grid.exe   # 假知帆宿主：按 zhifan-ext/1 启动、转发、嵌入，打开 http://127.0.0.1:8200/
node scripts/fake-zhifan-host.mjs --attach 8123 --token simulearn-dev    # 同上，但接已在跑的 grid 开发态内核（它自带页面）
node scripts/fake-zhifan-host.mjs --entry <程序> --data-dir <目录> --host-port 8300   # 预演「重开客户端草稿还在」：同一个 --data-dir、换一个 --host-port 再起一次（真宿主就是数据目录固定、端口每次换）
node scripts/fake-zhifan-host.mjs --entry <程序目录>/bin/simulearn-lab.exe --id simulearn-lab --example voltage-divider   # 电路拓展
node scripts/fake-zhifan-host.mjs --entry <程序目录>/bin/simulearn-lab.exe --id simulearn-lab --library qiu-circuits   # 电路拓展的内置案例库（课程包里写 {"library": "qiu-circuits"}）
node scripts/fake-zhifan-host.mjs --attach 8080 --token simulearn-dev --id simulearn-lab --example voltage-divider   # 接 lab 开发态内核（run_server.jl 在 lab-web 构建过时才挂页面）
node scripts/zhifan-rehearsal.mjs [--zip <grid 包>] [--lab-zip <电路包>]   # 用真实知帆客户端（开发版）演练：生成演练课堂包 + 起假下载站，并打印客户端的启动命令
node scripts/ch12-course-kit.mjs     # 第十二章调压实验交给课程站的工程文件与场景，写到 dist/course/ch12/
node scripts/ch12-course-kit.mjs --classroom <course-site>/content/classrooms/ch12-l3-shiyan   # 写成课程站「电力系统分析」第十二章第 3 讲的课堂目录（已上线，场景顺序不能再改）
node scripts/circuits-course-kit.mjs --verify   # 电路课的独立课堂资源包（案例库入口）+ 给老师的说明，写到 dist/course/circuits/；--verify 用知帆的 importPackage 核对
node scripts/circuits-course-kit.mjs --version <版本> --classroom <course-site>/content/courses/course-ecd2814d/classrooms/simulearn-circuits-lab   # 主站「电路」课那一讲的课堂目录；发给老师的本地包用课程站打出的那份
```

- 改了哪块就跑哪块的门禁；提交前全部门禁都要绿。
- 不提交密钥和 `.env`；推送到远端前先问用户。

## 工作方式

- 事实先查再说：代码、契约夹具、设计记录、约定原文都在本机。不要凭印象下结论。
- 范围超出当前任务、或要改动设计记录里已定的决定时，先说明再动手；确定要改的，在设计记录末尾的「修订记录」里追加一条。

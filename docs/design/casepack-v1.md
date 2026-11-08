# 案例包格式 `simulearn.casepack/1`（草案）

> 状态：**草案，等用户过目**，还没写代码。决定与路线见设计记录修订记录 2026-11-07 那一条。
> 范围：只做电路（lab）。配电网先补「案例库 + 说明卡」这一层，之后再接同一个格式（`app.module` 已留好）。

## 1. 要解决什么

别的老师想基于电路实验室出自己的题、带课堂演示。现在案例都编进了页面（`lab-web/src/cases/data/*.json`），每加一题就要发一版拓展。案例包把「案例」从拓展里拿出来，随课程包下发：

- **拓展只发一次**：页面学会读案例包。以后加题、改题只发课程包，不发拓展。
- **谁来写**：先由我们代做（老师给题目、图、参数、标准答案），格式和核对工具同时打磨。老师自己搭电路的编写工具放到最后一步。

## 2. 怎么到达页面

不改约定 `zhifan-ext/1`。课程包场景的 `project` 写案例包文件的相对路径，宿主读出来原样放进 `load.project`（约定 §6：文件要登记在课程包文件清单里，单个不超过 8 MB；每次 `ready` 都重发 `load`）：

```json
{
  "type": "interactive",
  "title": "电路分析补充案例",
  "content": {
    "type": "extension",
    "ext": "simulearn-lab",
    "minVersion": "0.5.3",
    "experiment": "wang-supplement",
    "project": "experiments/wang-supplement.casepack.json",
    "fallback": "这个实验需要在知帆客户端里安装「仿真实验 · 电路」拓展。"
  }
}
```

- **一个文件装下全部**：宿主只读 `project` 这一个文件，没有第二个文件可取，所以**演示脚本也内联在包里**。
- **体积**：16 个内置案例连同 6 个演示一共约 287 KB（案例 107 KB、演示 180 KB，最大的一个演示 50 KB），离 8 MB 很远。一门课一个包就够，不必按章拆。
- **不配 `task`**：这类场景只看不判分，走约定 §6 的「打开满 60 秒后点『我已完成』」。判分是第 3 阶段的事（见第 7 节）。

## 3. 形状

```json
{
  "schema": "simulearn.casepack/1",
  "app": { "module": "lab" },
  "id": "wang-supplement",
  "version": "2026.11.10.1",
  "title": "电路分析补充案例",
  "subtitle": "王老师课上用的题，按章节编排",
  "author": "王某某（某某大学电气学院）",
  "source": "电路结构与参数改编自《电路》第 6 版例 2-3、4-5；说明文字为作者自写",
  "license": "仅限本课程教学使用",
  "reference": "原题",
  "minVersion": "0.5.3",
  "cases": [
    {
      "id": "series-parallel-1",
      "chapter": 2,
      "chapterTitle": "电阻电路的等效变换",
      "source": "改编自例 2-3",
      "title": "混联电阻：先合并再分流",
      "summary": "……",
      "tryIt": ["把 R2 改成 ……，预期 ……"],
      "notes": ["……"],
      "preset": { "method": "node_voltage", "showBranchCurrents": true },
      "checks": [
        { "id": "u3", "label": "R3 两端电压 u3", "path": "node_voltages.{VP1}",
          "expect": 4.8, "unit": "V", "tol": 0.001, "fromBook": true }
      ],
      "circuit": { "nodes": [ … ], "edges": [ … ] },
      "demos": [
        { "id": "thevenin", "kind": "steps", "title": "戴维宁等效", "summary": "……", "steps": [ … ] }
      ]
    }
  ]
}
```

### 3.1 包这一层

| 字段 | 必填 | 说明 |
|---|---|---|
| `schema` | 是 | 固定 `simulearn.casepack/1` |
| `app.module` | 是 | `lab`。写 `grid` 时电路页面回答「这是配电网的案例包」。与工程文件信封 `simulearn.project/1` 的 `app.module` 同一个意思 |
| `id` | 是 | `[a-z0-9-]`，1～64 个字符 |
| `version` | 是 | 作者自己的版本号，只用于显示和排查 |
| `title` | 是 | 案例列表页的大标题 |
| `subtitle` | 否 | 副标题 |
| `author` / `source` / `license` | 是 | 列表页底部显示。`source` 写清楚改编自哪里、文字是谁写的；`license` 写清楚别人能不能拿去用 |
| `reference` | 否 | 说明卡里「参考答案」的叫法，缺省「原题」。界面上用作「{reference}结果（运行后对照）」「和{reference}的差别」「* {reference}只列了方程，这个数按{reference}的数据算出」。内置库写「教材」，界面和现在一字不差 |
| `minVersion` | 否 | 需要的电路拓展版本。课程包场景的 `minVersion` 已经能挡住旧版本；这个字段用于包被拿去别的课程包、`minVersion` 写低了的情况，页面给出「这个案例包需要电路拓展 X 以上」 |
| `cases` | 是 | 1～200 个 |

### 3.2 一个案例

和内置案例（`lab-web/src/cases/types.ts` 的 `TeachingCase`）**字段同名、同义**，只有下面几处不同：

- **`chapter` / `chapterTitle` / `section` / `source` 改成可选**。有 `chapter` 的按章分组，排序方式和内置库一样；没有的归到列表末尾的「其他案例」组。
- **`checks[].id` 新增，可选**：`[a-z0-9-]`，同一案例内唯一。现在只用于报错时指明是哪个核对点；第 3 阶段判分任务按它引用核对点，所以建议现在就写上。
- **`demos[]` 内联**：每项是「索引（`id`、`kind`、`title`、`summary`）＋ 演示脚本本体」。`steps` 演示写 `steps`，`kvl` 演示写 `method`、`branches`、`loops`、`intro`，字段和现在 `cases/demos/*.json` 的一样，只是不再重复写 `caseId`。

不变的规矩：

- **结构锁定（D19）**：学生只改参数。
- **草稿**：按场景的实验 id 加案例 id 隔离（`exp:<实验>:case-<案例 id>:`，和内置库一样，存进内核 `store`）。案例的电气内容一改，旧草稿就不再恢复（`caseFingerprint`）。所以案例 `id` 发出去以后不能改。
- **只有一个案例的包**：直接打开这个案例，不显示列表。老师想「一个场景一道题」时，用课堂包脚本把一个包拆成每题一个文件（第 6 节）。

## 4. 校验

页面拿到包后先完整校验一遍，有错就不打开，列出中文原因（最多列 20 条，并向宿主发 `error`，消息取第一条）：

```
案例包有 2 处问题，没有打开：
· 第 3 个案例（series-parallel-1）：核对点 u3 的路径里 {VP9} 找不到——电路里没有叫 VP9 的探针
· 第 5 个案例（rlc-1）：元件 L1 的参数 l0 不认识（电感的参数有 value、i0）
```

校验项：

1. **包这一层**：`schema` 和 `app.module` 对得上，必填字段齐全，各 `id` 合字符规则，案例 `id` 在包内不重复。案例 `id` 的规则和 `cases.test.ts` 对内置库的要求一致，因为 `caseStoragePrefix` 拿它拼存储键。
2. **电路**：走 `loadProjectFromObject`，与「导入项目」同一条路；元件类型、参数名都要在元件定义里。
3. **预设**：`method` 是认识的分析方法。戴维宁的 `theveninPort` 两端都找得到。
4. **核对点**：路径里的 `{X}` 都能换成网络名（`resolveCheckPath`），`expect` 是有限数，`tol` > 0。
5. **演示**：每一步的电路能读出来，读数路径、高亮 / 淡显的元件 id、KVL 回路里的元件和端子都存在。
6. **文字长度**：上限只防误粘（标题 80 字、单段 2000 字）。所有文字一律按纯文本显示，不解析 HTML / Markdown；演示讲解里只认 `{key}` 占位。

实现上沿用 `loadProjectFromObject` 的「收集 errors 数组」写法，**不引入 schema 校验库**（`check:bundle` 守着 lab-web 体积）。校验和案例包读取都放在打开案例库时才加载的异步块里，单电路实验不背它。

## 5. 页面要改的地方

| 位置 | 改动 |
|---|---|
| `embed/protocol.ts` `resolveProject` | 多认一种：`schema === "simulearn.casepack/1"` → `{kind: 'casepack', pack}`。`{library}`、`{example}`、工程文件信封照旧 |
| `embed/circuit.ts` `resolveEmbedTarget` | 案例包校验通过后转成 `CaseLibrary` 的形状，复用 `CaseLibraryView` / `CaseGuide` |
| `cases/types.ts` | `CaseLibrary` 加可选 `reference`、`author`、`source`、`license`；`TeachingCase` 的 `chapter` 等改可选 |
| `CaseLibraryView` / `CaseGuide` | 「教材」换成 `reference`（缺省「原题」）；无章节的案例归「其他案例」；列表页底部显示作者、来源、许可 |
| `cases/demo/loader.ts` | 现在用 `import.meta.glob` 按文件取演示脚本；改成由 `CaseLibrary` 提供「取演示」的函数：内置库照旧按需加载文件，案例包直接返回内联的脚本 |
| 嵌入页 | 只有一个案例的包直接进案例；校验失败显示问题列表 |

内核不用改：案例包只在页面里解释，交内核算的还是原来的仿真请求。

## 6. 工具

- **核对（作者自检）**：`CASEPACK=<文件> LAB_E2E=1 npx vitest run src/cases/casepack.e2e.test.ts`。先做第 4 节的静态校验，再把每个案例按预设交给 8080 上的 lab 内核算，逐个核对点打 ✓ / ✗，演示的每一步读数也一并核对。和现在 `cases.e2e.test.ts`、`demos.e2e.test.ts` 同一套逻辑，只是数据来源换成文件。代做交付前必须全绿，再用 `scripts/demo-layout-check.mjs` 过一遍演示布局。
- **预览**：假宿主已有 `--project <文件>`，原样放进 `load.project`，案例包直接能用：`node scripts/fake-zhifan-host.mjs --attach 8080 --token simulearn-dev --id simulearn-lab --project <案例包>`。
- **出课堂包**：把 `scripts/circuits-course-kit.mjs` 推广成「任意案例包 → 课堂资源包」：`--pack <文件> --course <课程 id> --package <包 id> --title <标题>`，可选 `--split` 拆成每个案例一个场景。课程身份一经发出就不能变（同 11-06 那条）；`--verify` 照旧调用知帆的 `importPackage` 核对。
- **帮助页**：`docs/help/lab/casepack.md`，写给代做的人和以后的老师：字段表、核对点路径怎么写、一个最小示例、常见报错。

## 7. 「自检」不是判分

上面的 ✓ / ✗ 是**作者交付前的核对**，学生看不到，也不产生成绩。判分在第 3 阶段按 `simulearn.task/1` 做：

- 课程包场景配 `task`，任务里写案例 id 和要核对的核对点 `id`；
- 内核按学生最后提交的参数重算后核对（约定 §5「判定要在拓展进程里做」），并校验学生没改电路结构；
- 版本号按 D16 原定的 0.6.0。

案例包本身不需要为判分再加字段，现在只需把核对点的 `id` 写上。

## 8. 发版

- **lab 0.5.3**：页面认识案例包。课程包里用案例包的场景，`minVersion` 写 0.5.3。
- **要重建程序**：内核虽然不改，版本号 `EXT_VERSION` 却编在程序里（`Server.jl`，ready 行和 `/health` 都报它），换版本号就得在 labpc 上重建程序（约 45 分钟，再加取回约 30 分钟）。可以考虑顺手把版本号改成从包里的一个文件读：以后只改页面的版本就不用重建。要不要这么做，实现时再定。

## 9. 验收

1. **用内置库验格式**：把 `qiu-circuits`（16 个案例、6 个演示、按章分组、`*` 脚注）导出成一个案例包，走案例包这条路打开：列表、说明卡、演示和现在一致，16 个案例的核对点、6 个演示的读数在 e2e 里全绿，演示布局检查不报重叠。内置库表达不出来的地方，就是格式缺的地方。
2. 有错的包能给出第 4 节那样的中文原因，不白屏。
3. 只有一个案例的包直接打开这个案例。
4. 草稿：两个场景用同一个包，草稿互不影响；关掉客户端再打开草稿还在。
5. 通用课堂包脚本生成的包能用 `--verify` 导入，并在真客户端里打开。
6. `npm run lint`、`npm run check`、`check:bundle` 全绿；帮助页齐全。

## 10. 待定

- **老师的第一批请求还没拿到**。拿到后对照这份草案查漏：要的元件或分析现在没有的，按 D1 排进拓展版本；格式要补的字段，按「同一版本号内只加可选字段」的规矩补。
- 第 8 节：版本号要不要和程序解耦。
- 配电网的说明卡层什么时候做（用户 11-07 定：先只做电路）。

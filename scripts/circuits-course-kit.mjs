#!/usr/bin/env node
// 电路课的课堂资源包「电路仿真实验」：给电路课老师和学生用。主站还没有电路课（学生也未必有知帆账号），
// 所以不走「课程资料」在线下载，而是老师把这个 zip 发给学生，在知帆客户端「课程 → 导入课堂资源包」导入。
// 不登录（访客）也能导入、安装拓展、做实验。
//
//   node scripts/circuits-course-kit.mjs [--version 2026.11.06.1] [--out dist/course/circuits] [--verify]
//
// 输出 电路仿真实验-<版本>.zip 和 给老师的说明.md。--verify 用知帆客户端自己的 importPackage 导入到临时目录核对一遍
// （需要本机有 course-site 仓库，路径用 --course-site 指定）。
// 课堂清单不带时间戳，同样的内容同一版本号重复生成，文件逐字节相同；改了内容就换版本号——知帆拒绝导入
// 「同一 packageId、同一版本、内容不同」的包。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { coursePackage, sha256 } from './course-package.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)

// 课程身份：知帆按 courseId + packageId 认同一个课堂，以后发新版本这两个都不能变。
// 本机导入、又不在账号「我的课程」里的课程，客户端侧栏直接把 courseId 当课程名显示，所以取一个看得懂的英文名。
export const COURSE_ID = 'circuits'
export const PACKAGE_ID = 'simulearn-circuits-lab'
// 案例库和课堂演示 0.5.1 起就有；0.5.2 起学生改过的参数才在重开客户端后还在（存进拓展的数据目录），
// 所以要求 0.5.2：装着 0.5.1 的学生会被提示先更新拓展
export const MIN_VERSION = '0.5.2'
// 学生草稿按实验 id 存（拓展数据目录里的 store）：以后课堂包换版本也别改它，不然学生改过的参数就找不回来了
const EXPERIMENT = 'circuits-case-library'
const TITLE = '电路仿真实验（邱关源《电路》例题）'
const FALLBACK = '这个实验需要在知帆客户端里安装「仿真实验 · 电路」拓展（个人中心 → 拓展）。'
const CLIENT_URL = 'https://dl.zhifan.xyz/desktop/zhifan-setup-0.11.3.exe'

const today = new Date()
const version = opt('--version', `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}.1`)
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(version)) throw new Error(`版本号不合法：${version}`)
const outDir = path.resolve(opt('--out', path.join(root, 'dist', 'course', 'circuits')))
const courseSite = path.resolve(opt('--course-site', 'D:/workspace/Dev_course/course-site'))

// 案例与演示一览从 lab-web 的案例数据读，说明页和给老师的说明跟着数据走；按例题号（「例 章-号」）排
const exampleOrder = (source) => {
  const match = /(\d+)-(\d+)/.exec(source ?? '')
  return match ? Number(match[1]) * 1000 + Number(match[2]) : Number.MAX_SAFE_INTEGER
}
const casesDir = path.join(root, 'packages', 'lab-web', 'src', 'cases', 'data')
const cases = fs.readdirSync(casesDir).filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(fs.readFileSync(path.join(casesDir, name), 'utf8')))
  .sort((a, b) => exampleOrder(a.source) - exampleOrder(b.source) || a.id.localeCompare(b.id))
const withDemos = cases.filter((item) => item.demos?.length)
// 短名取第一个演示标题冒号前那段（例 2-2 的两个演示都是 Y-Δ 变换，第二个标题是「另一种方法：…」）
const demoLine = withDemos.map((item) => `${item.source}（${item.demos[0].title.split('：')[0]}）`).join('、')

// ---------------- 课堂清单 ----------------
const text = (id, left, top, width, height, html, color = '#333333') => ({
  id, type: 'text', left, top, width, height, content: html, defaultFontName: 'Microsoft YaHei', defaultColor: color, rotate: 0,
})
const para = (body, size = 18) => `<p style="font-size:${size}px;">${body}</p>`
const guide = {
  type: 'slide', title: '怎么用', order: 1,
  content: {
    canvas: {
      viewportSize: 1000, viewportRatio: 0.5625,
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        text('title', 60, 40, 880, 60, para('<strong>电路仿真实验：怎么用</strong>', 30), '#1e3a5f'),
        { id: 'rule', type: 'shape', left: 60, top: 104, width: 880, height: 3, path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z', viewBox: [1, 1], fill: '#5b9bd5', fixedRatio: false, rotate: 0 },
        text('body', 60, 124, 880, 400, [
          para('• <strong>第一次用</strong>：在「个人中心 → 拓展」安装「仿真实验 · 电路」（约 550 MB，需要知帆客户端 0.11.3 及以上，装一次就行）。'),
          para(`• <strong>下一页是案例库</strong>：${cases.length} 道邱关源《电路》例题，按章排列。电路结构固定，元件参数可以改、分析方法可以换：先点「运行仿真」，对照说明卡里的「教材结果」，再按「动手试试」改参数看变化。`),
          para(`• <strong>课堂演示</strong>：${demoLine}。在说明卡里点开后全屏逐步讲解，点「下一步」或按 → 翻页，Esc 退出。`),
          para('• 改过的参数会自动保存在你的电脑上，关掉客户端再打开也还在；「恢复初始电路」随时回到教材里的初始状态。'),
        ].join('')),
      ],
    },
  },
  actions: [],
}
const library = {
  type: 'interactive', title: '电路案例库', order: 2,
  content: { type: 'extension', ext: 'simulearn-lab', minVersion: MIN_VERSION, experiment: EXPERIMENT, project: { library: 'qiu-circuits' }, fallback: FALLBACK },
}
const files = {
  'manifest.json': Buffer.from(JSON.stringify({ stage: { name: TITLE }, scenes: [guide, library] })),
}
const zip = coursePackage({ courseId: COURSE_ID, packageId: PACKAGE_ID, version, title: TITLE, files })

// ---------------- 给老师的说明 ----------------
const caseTable = cases.map((item) => `| ${item.source} | ${item.title}${item.demos?.length ? `（课堂演示：${item.demos.map((demo) => demo.title).join('；')}）` : ''} |`).join('\n')
const zipName = `电路仿真实验-${version}.zip`
const readme = `# 电路仿真实验：给老师的说明

课堂资源包：\`${zipName}\`（版本 ${version}）。它在知帆客户端里加一门「电路仿真实验」课，里面是一页使用说明和一个电路案例库：${cases.length} 道邱关源《电路》例题，其中 ${withDemos.length} 道带课堂演示。

## 老师先试一遍

1. 装好知帆客户端（0.11.3 及以上）：${CLIENT_URL}
2. 「个人中心 → 拓展」安装「仿真实验 · 电路」（${MIN_VERSION} 及以上，约 550 MB，装一次就行；装过旧版的点更新）。
3. 「课程 → 导入课堂资源包」，选 \`${zipName}\`。侧栏的课程切换里会多一门 **circuits**（本机导入的课程，客户端拿课程编号当名字显示），课堂名是「${TITLE}」。
4. 打开课堂，翻到「电路案例库」，选一道例题。说明卡里有「课堂演示」的，点开就是全屏演示。

## 上课投屏（课堂演示）

- 演示有：${demoLine}。
- 点「下一步」或按 → / 空格翻页，← 上一步，Esc 退出；KVL 演示可以选网孔和顺时针 / 逆时针。
- 每一步的读数都是内核现算的，和教材数值对过。
- 投影时把知帆窗口最大化，屏幕分辨率越高，元件上的字越大（1280×720 的投影仪上元件名偏小，讲解文字在下方大字显示）。

## 发给学生

把 \`${zipName}\` 和下面这段话发给学生（不登录知帆账号也能用）：

> 1. 下载安装知帆客户端：${CLIENT_URL}
> 2. 打开客户端，「个人中心 → 拓展」安装「仿真实验 · 电路」（约 550 MB）。
> 3. 「课程 → 导入课堂资源包」，选老师发的 \`${zipName}\`。
> 4. 侧栏课程选 circuits，进入「${TITLE}」，在「电路案例库」里做题：先运行，对照教材结果，再按「动手试试」改参数。

## 说明

- 电路实验暂时不判分：打开满 60 秒后点「我已完成」即算学完这一页。
- 学生改过的参数自动保存在自己电脑上（拓展的数据目录），关掉客户端再打开也还在；以后发新版本的课堂资源包也不会丢。在「个人中心 → 拓展」卸载拓展并选择删除数据时会一起清掉。
- 课堂资源包要求「仿真实验 · 电路」0.5.2 及以上：装着旧版的学生打开实验时会被提示先更新拓展。
- 电路结构是锁定的（不能增删元件和连线），只能改参数、换分析方法。

## 案例一览

| 例题 | 内容 |
|---|---|
${caseTable}
`

fs.mkdirSync(outDir, { recursive: true })
const zipPath = path.join(outDir, zipName)
fs.writeFileSync(zipPath, zip)
fs.writeFileSync(path.join(outDir, '给老师的说明.md'), readme)
console.log(JSON.stringify({ zip: zipPath, bytes: zip.length, sha256: sha256(zip), courseId: COURSE_ID, packageId: PACKAGE_ID, version, scenes: 2, cases: cases.length, demoCases: withDemos.length }, null, 2))

if (args.includes('--verify')) {
  // 用知帆客户端自己的导入逻辑核对：清单、文件校验、场景数，导入到临时目录后再列出来
  const packages = path.join(courseSite, 'desktop', 'lib', 'packages.mjs')
  if (!fs.existsSync(packages)) throw new Error(`找不到知帆客户端的 packages.mjs：${packages}（用 --course-site 指定 course-site 仓库）`)
  const { importPackage, listPackages } = await import(pathToFileURL(packages).href)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'circuits-kit-'))
  try {
    const imported = await importPackage(zipPath, temp)
    const listed = listPackages(temp).map(({ courseId, packageId, version: v, title, sceneCount }) => ({ courseId, packageId, version: v, title, sceneCount }))
    const again = await importPackage(zipPath, temp) // 同版本同内容重复导入要放行
    console.log('知帆 importPackage 导入通过：', JSON.stringify({ title: imported.title, listed, reimport: again.version }))
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

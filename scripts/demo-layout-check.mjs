// 课堂演示的逐帧布局检查：用无头 Chromium 打开电路案例库，逐个演示逐步翻页，每一帧量卡片 / 气泡重叠、
// 连线穿卡片、元件出画面，截图，并收集控制台报错。演示列表从 lab-web/src/cases/data/*.json 的 demos 读。
//
//   node scripts/demo-layout-check.mjs [--size 1600x900] [--only <案例 id 或演示 id 的子串>]
//        [--url http://127.0.0.1:8201/ext/simulearn-lab/ui/#/embed?library=qiu-circuits] [--out dist/demo-check]
//
// 先起页面和内核，例如 lab 开发态内核 + 假宿主：
//   node scripts/fake-zhifan-host.mjs --attach 8080 --token simulearn-dev --id simulearn-lab --library qiu-circuits
// （假宿主默认把页面开在 8201；页面用的是 packages/lab-web/dist，改了前端先构建。）
//
// 为什么要无头浏览器：演示的位移动画、视图适配都靠 requestAnimationFrame，窗口被隐藏时（例如编辑器里收起的预览窗格）
// 它根本不跑，量出来的全是半截动画。浏览器可执行文件按 CHROME_PATH、Playwright 的 headless shell、Edge 的顺序找。
// 只用 Node 自带模块（需要 Node ≥ 22 的全局 WebSocket）。有严重问题（出画面、卡片互相重叠、连线穿卡片、控制台报错）时退出码 1；
// 气泡压线、1～3 px 的擦边只算提示。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []))
const [width, height] = (args.size ?? '1600x900').split('x').map(Number)
const url = args.url ?? 'http://127.0.0.1:8201/ext/simulearn-lab/ui/#/embed?library=qiu-circuits'
const out = resolve(args.out ?? join(repo, 'dist', 'demo-check'), `${width}x${height}`)
mkdirSync(out, { recursive: true })

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return { exe: process.env.CHROME_PATH, extra: [] }
  const playwright = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  if (existsSync(playwright)) {
    for (const dir of readdirSync(playwright).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const exe = join(playwright, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
      if (existsSync(exe)) return { exe, extra: [] }
    }
  }
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  if (existsSync(edge)) return { exe: edge, extra: ['--headless=new'] }
  throw new Error('找不到无头浏览器：设 CHROME_PATH，或装 Playwright 的 chromium headless shell')
}

// 演示列表：案例 JSON 的 source（列表上显示的「例 x-y」）+ demos 索引
const casesDir = join(repo, 'packages', 'lab-web', 'src', 'cases')
const demos = readdirSync(join(casesDir, 'data')).filter((name) => name.endsWith('.json')).flatMap((name) => {
  const item = JSON.parse(readFileSync(join(casesDir, 'data', name), 'utf8'))
  return (item.demos ?? []).map((demo, index) => ({ key: `${item.id}.${demo.id}`, source: item.source, index, kind: demo.kind }))
}).filter((demo) => !args.only || demo.key.includes(args.only))

// 注入页面的辅助函数（序列化后在页面里执行，不能引用外层变量）
function pageHelpers() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const dialog = () => document.querySelector('[role=dialog]')
  const leaf = (text) => [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === text)
  const buttonStarting = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
  async function open(source, index) {
    const current = dialog()
    if (current) { [...current.querySelectorAll('button')].find((b) => b.textContent.includes('退出演示'))?.click(); await sleep(600) }
    const back = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '案例列表')
    if (back) { back.click(); await sleep(800) }
    for (let i = 0; i < 20 && !leaf(source); i++) await sleep(300)
    if (!leaf(source)) return { error: `列表里找不到 ${source}` }
    leaf(source).click()
    let heading
    for (let i = 0; i < 30 && !heading; i++) { await sleep(300); heading = [...document.querySelectorAll('h2,h3,h4')].find((e) => e.textContent.trim() === '课堂演示') }
    if (!heading) return { error: '案例说明里没有「课堂演示」' }
    heading.parentElement.querySelectorAll('button')[index].click()
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      const viewport = dialog()?.querySelector('.react-flow__viewport')
      if (viewport && new DOMMatrix(getComputedStyle(viewport).transform).a !== 1) break
    }
    await sleep(1200)
    return { label: dialog()?.getAttribute('aria-label') }
  }
  function geometry() {
    const d = dialog()
    const frame = d.querySelector('.react-flow').getBoundingClientRect()
    const zoom = new DOMMatrix(getComputedStyle(d.querySelector('.react-flow__viewport')).transform).a
    const items = [...d.querySelectorAll('.react-flow__node')].filter((n) => !n.classList.contains('demo-leave'))
      .map((n) => ({ id: n.dataset.id, note: n.classList.contains('react-flow__node-demoNote'), r: n.getBoundingClientRect() }))
    const severe = []
    const minor = []
    for (let i = 0; i < items.length; i++) {
      const a = items[i]
      if (a.r.left < frame.left - 1 || a.r.right > frame.right + 1 || a.r.top < frame.top - 1 || a.r.bottom > frame.bottom + 1) severe.push(`出画面 ${a.id}`)
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) - 2
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) - 2
        if (w <= 0 || h <= 0) continue
        const text = `重叠 ${a.id} × ${b.id} ${Math.round(w / zoom)}x${Math.round(h / zoom)}`
        if ((!a.note && !b.note) || Math.min(w, h) / zoom > 4) severe.push(text)
        else minor.push(text)
      }
    }
    const cards = items.filter((x) => !x.note)
    const notes = items.filter((x) => x.note)
    for (const edge of d.querySelectorAll('.react-flow__edge')) {
      if (edge.classList.contains('demo-edge-leave')) continue
      const path = edge.querySelector('path')
      if (!path) continue
      const id = (edge.getAttribute('data-id') ?? edge.dataset.testid ?? '').replace(/^rf__edge-demo-/, '')
      const total = path.getTotalLength()
      const ctm = path.getScreenCTM()
      const crossed = new Set()
      const covered = new Set()
      for (let s = 0; s <= total; s += 3) {
        if (Math.min(s, total - s) * zoom < 14) continue
        const p = path.getPointAtLength(s)
        const x = ctm.a * p.x + ctm.c * p.y + ctm.e
        const y = ctm.b * p.x + ctm.d * p.y + ctm.f
        for (const c of cards) if (x > c.r.left + 3 && x < c.r.right - 3 && y > c.r.top + 3 && y < c.r.bottom - 3) crossed.add(c.id)
        for (const n of notes) if (x > n.r.left + 2 && x < n.r.right - 2 && y > n.r.top + 2 && y < n.r.bottom - 2) covered.add(n.id)
      }
      if (crossed.size) severe.push(`连线穿卡片 ${id} → ${[...crossed].join(',')}`)
      if (covered.size) minor.push(`气泡压线 ${id} ← ${[...covered].join(',')}`)
    }
    const title = d.querySelector('.react-flow__node [class*="_title_"]')
    return {
      title: d.querySelector('[class*="stepTitle"]')?.textContent.trim(),
      zoom: +zoom.toFixed(3),
      cardTitlePx: title ? +(parseFloat(getComputedStyle(title).fontSize) * zoom).toFixed(1) : null,
      severe,
      minor,
    }
  }
  async function next() {
    const b = buttonStarting(dialog(), '下一步')
    if (!b || b.disabled) return false
    b.click()
    await sleep(1700)
    return true
  }
  async function chip(text) {
    const b = [...dialog().querySelectorAll('button')].find((x) => x.textContent.trim() === text)
    if (!b) return false
    b.click()
    await sleep(1200)
    return true
  }
  window.__demoCheck = { open, geometry, next, chip }
}

const { exe, extra } = findChrome()
const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), 'demo-check-'))
const chrome = spawn(exe, [...extra, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 75 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page') } catch { /* 浏览器还没起来 */ }
  if (!page) await sleep(200)
}
if (!page) throw new Error('无头浏览器没起来')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text)
})
const send = (method, params = {}) => new Promise((resolveSend, reject) => {
  const id = ++seq
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolveSend(msg.result)))
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const shot = async (file) => writeFileSync(join(out, file), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))

let failed = false
try {
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await sleep(3000)
  await evaluate(`(${pageHelpers.toString()})()`)
  const report = {}
  for (const demo of demos) {
    const before = consoleErrors.length
    const opened = await evaluate(`window.__demoCheck.open(${JSON.stringify(demo.source)}, ${demo.index})`)
    const frames = []
    const run = async (tag) => {
      let n = 0
      do {
        n++
        frames.push({ tag, n, ...(await evaluate('window.__demoCheck.geometry()')) })
        await shot(`${demo.key}${tag ? '-' + tag : ''}-${String(n).padStart(2, '0')}.png`)
      } while (n < 30 && (await evaluate('window.__demoCheck.next()')))
    }
    if (opened.error) {
      frames.push({ severe: [opened.error] })
    } else if (demo.kind === 'kvl') {
      // KVL：第一个回路顺时针走完，其余回路逆时针各走一遍
      const [caseId, demoId] = demo.key.split('.')
      const script = JSON.parse(readFileSync(join(casesDir, 'demos', `${caseId}.${demoId}.json`), 'utf8'))
      await run(`${script.loops[0].id}-cw`)
      for (const loop of script.loops.slice(1)) {
        if (!(await evaluate(`window.__demoCheck.chip(${JSON.stringify(loop.name)})`)) || !(await evaluate('window.__demoCheck.chip("逆时针")'))) {
          frames.push({ tag: loop.id, severe: [`找不到回路 / 方向按钮：${loop.name}`] })
          continue
        }
        await run(`${loop.id}-ccw`)
      }
    } else {
      await run('')
    }
    const errors = [...new Set(consoleErrors.slice(before))]
    report[demo.key] = { opened, frames, consoleErrors: errors }
    const severe = frames.filter((f) => f.severe?.length)
    if (severe.length || errors.length) failed = true
    console.log(`== ${demo.key}（${frames.length} 帧，缩放 ${frames[0]?.zoom}，元件名 ${frames[0]?.cardTitlePx} px）`)
    for (const f of frames) {
      for (const text of f.severe ?? []) console.log(`  ✗ ${f.tag ? f.tag + ' ' : ''}#${f.n ?? '-'} ${text}`)
      for (const text of f.minor ?? []) console.log(`  · ${f.tag ? f.tag + ' ' : ''}#${f.n} ${text}`)
    }
    for (const text of errors.slice(0, 5)) console.log(`  ✗ 控制台：${text}`)
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1))
  console.log(`\n截图和 report.json：${out}`)
} finally {
  ws.close()
  chrome.kill()
  await sleep(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* 浏览器还占着就留给系统清 */ }
}
process.exit(failed ? 1 : 0)

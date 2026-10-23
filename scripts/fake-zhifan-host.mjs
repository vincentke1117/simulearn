// 本机演练用的「假知帆宿主」：按《拓展对接约定》zhifan-ext/1 §2–§5 实现宿主一侧，用来在不装知帆客户端的情况下验证拓展。
//
//   启动拓展程序：node scripts/fake-zhifan-host.mjs --entry <...\bin\simulearn-grid.exe> [--example ieee33 | --project <工程文件.json>]
//   接已在跑的内核：node scripts/fake-zhifan-host.mjs --attach 8123 --token simulearn-dev [--example ieee33]
//   可选：--experiment ch12-demo（实验 id）、--task <任务.json>、--host-port 8200（宿主界面端口，拓展端口 = 它 + 1）
//
// 做的事情与真宿主一致：
//   §2 用 --port 0 --token --data-dir --host-version 启动，只认第一条以 {"ready" 开头的行，最多等 120 s；退出时关标准输入，5 s 不退就杀
//   §3 另开一个「拓展端口」（与宿主界面不同源）：/ext/<id>/… → 拓展进程，注入 X-Zhifan-Ext-Token，去掉 Cookie / Set-Cookie，加 frame-ancestors
//   §4 宿主页面用沙箱 iframe 打开 /ext/<id>/ui/#/embed，收到 ready 就回 load；§5 显示回传的成绩
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const EXT_ID = opt('--id', 'simulearn-grid');
const hostPort = Number(opt('--host-port', '8200'));
const extPort = hostPort + 1;
const experiment = opt('--experiment', 'ch12-demo');
const projectFile = opt('--project');
const taskFile = opt('--task');
const project = projectFile ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : { example: opt('--example', 'ieee33') };
const task = taskFile ? JSON.parse(fs.readFileSync(taskFile, 'utf8')) : null;

let child = null;
let backendPort;
let token;

async function startEntry(entry) {
  token = randomBytes(32).toString('hex');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${EXT_ID}-data-`));
  const started = Date.now();
  child = spawn(entry, ['--port', '0', '--token', token, '--data-dir', dataDir, '--host-version', '0.11.0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[ext:err] ${chunk}`));
  child.on('exit', (code) => console.log(`[host] 拓展进程已退出（code ${code}）`));
  const lines = readline.createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('120 秒内没有收到 ready 行，按约定当作启动失败')), 120_000);
    lines.on('line', (line) => {
      if (!line.startsWith('{"ready"')) {
        console.log(`[ext:out] ${line}`);
        return;
      }
      clearTimeout(timer);
      const ready = JSON.parse(line);
      if (!ready.ready) return reject(new Error(`拓展报告启动失败：${ready.error}`));
      console.log(`[host] 拓展就绪：${((Date.now() - started) / 1000).toFixed(1)} s，端口 ${ready.port}，版本 ${ready.version}，约定 ${ready.contract}`);
      console.log(`[host] 数据目录：${dataDir}`);
      resolve(ready.port);
    });
  });
}

function stopEntry() {
  if (!child || child.exitCode !== null) return;
  const watch = Date.now();
  child.stdin.end(); // 约定 §2：关闭标准输入即要求退出
  const timer = setTimeout(() => {
    console.log('[host] 5 秒内没有退出，强制结束');
    child.kill();
  }, 5000);
  child.on('exit', () => {
    clearTimeout(timer);
    console.log(`[host] 关闭标准输入后 ${((Date.now() - watch) / 1000).toFixed(2)} s 退出`);
  });
}

const HOST_ORIGIN = `http://127.0.0.1:${hostPort}`;
const EXT_ORIGIN = `http://127.0.0.1:${extPort}`;

// §3：拓展端口上的转发
const proxy = http.createServer((req, res) => {
  const prefix = `/ext/${EXT_ID}`;
  if (!req.url.startsWith(prefix + '/')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${backendPort}`, 'x-zhifan-ext-token': token };
  delete headers.cookie;
  const upstream = http.request(
    { host: '127.0.0.1', port: backendPort, method: req.method, path: req.url.slice(prefix.length), headers },
    (up) => {
      const out = { ...up.headers, 'content-security-policy': `frame-ancestors ${HOST_ORIGIN}` };
      delete out['set-cookie'];
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502);
    res.end(`拓展不可达：${err.message}`);
  });
  req.pipe(upstream);
});

// §4/§5：宿主界面（与拓展端口不同源）
const HOST_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>假知帆宿主</title>
<style>body{margin:0;font:13px system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr auto;height:100vh}
header{padding:8px 12px;background:#0f172a;color:#e2e8f0}iframe{border:0;width:100%;height:100%}
#log{margin:0;padding:6px 12px;max-height:20vh;overflow:auto;background:#f1f5f9;border-top:1px solid #cbd5e1}</style></head><body>
<header>假知帆宿主 · 实验 <b>${experiment}</b> · 拓展 ${EXT_ID}</header>
<iframe id="ext" sandbox="allow-scripts allow-same-origin allow-forms" src="${EXT_ORIGIN}/ext/${EXT_ID}/ui/#/embed"></iframe>
<pre id="log"></pre>
<script>
const LOAD = ${JSON.stringify({ source: 'zhifan-host', type: 'load', experiment, project, task })};
const frame = document.getElementById('ext');
const log = (m) => { const el = document.getElementById('log'); el.textContent += new Date().toLocaleTimeString() + '  ' + m + '\\n'; el.scrollTop = el.scrollHeight; };
window.__hostLog = [];
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== ${JSON.stringify(EXT_ORIGIN)}) return;
  window.__hostLog.push(e.data);
  const d = e.data || {};
  if (d.source === 'zhifan-ext' && d.type === 'ready') { log('收到 ready（' + d.contract + '），发送 load'); frame.contentWindow.postMessage(LOAD, e.origin); }
  else if (d.source === 'zhifan-ext' && d.type === 'error') log('拓展报错：' + d.message);
  else if (d.source === 'maic-interactive' && d.type === 'score') log('成绩：' + d.score + ' / ' + d.maxScore + '  ' + JSON.stringify(d.detail));
  else log('其他消息：' + JSON.stringify(d));
});
</script></body></html>`;

const hostUi = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOST_PAGE);
});

async function main() {
  const attach = opt('--attach');
  if (attach) {
    backendPort = Number(attach);
    token = opt('--token', 'simulearn-dev');
    console.log(`[host] 连接已在运行的内核 127.0.0.1:${backendPort}`);
  } else {
    const entry = opt('--entry');
    if (!entry) throw new Error('需要 --entry <拓展程序> 或 --attach <端口>');
    backendPort = await startEntry(entry);
  }
  proxy.listen(extPort, '127.0.0.1');
  hostUi.listen(hostPort, '127.0.0.1', () => console.log(`[host] 打开 ${HOST_ORIGIN}/ （拓展端口 ${EXT_ORIGIN}）`));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopEntry();
    setTimeout(() => process.exit(0), 5500);
  });
}

main().catch((err) => {
  console.error(`[host] ${err.message}`);
  stopEntry();
  process.exitCode = 1;
});

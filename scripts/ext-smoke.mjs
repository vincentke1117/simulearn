// 拓展发布包的隔离冒烟（知帆拓展约定 zhifan-ext/1 §2–§3）：不开浏览器、不用人看，发布前跑一遍。
//
//   node scripts/ext-smoke.mjs dist/ext/simulearn-lab-0.5.1.zip
//   node scripts/ext-smoke.mjs dist/ext/simulearn-grid-0.5.1.zip
//
// 做的事：
//   1. 解压到带中文和空格的临时目录（Windows 自带的 bsdtar，条目名按正斜杠解）。
//   2. 在隔离环境里启动：空的 JULIA_DEPOT_PATH、用户目录、AppData、TEMP，PATH 里只有 System32。
//      开发机 ~/.julia 里装着的东西（比如「按需下载」的 artifact）在这里都看不到，学生电脑就是这个样子；
//      2026-11-02 的 simulearn-lab 第一版包就是在这一步才发现一启动就去联网下载 MKL 的。
//   3. 量冷启动到 ready 的时间（宿主最多等 120 s）；核对不带令牌 401、页面、计算、读不出来的请求体 422。
//   4. 记工作集 / 私有内存；关标准输入，量退出时间（约定要求 5 s 内）。
//   5. 统计数据目录以外写了什么：安装目录、depot、用户目录、TEMP 都应该是 0。
//   6. 学生草稿的存储（lab 0.5.2、grid 0.5.3 起）：经 store 接口写一条，关掉拓展、用同一个数据目录重新启动，读回来要一样。
//      知帆客户端每次启动给拓展页面换端口，页面的 localStorage 留不住，草稿只能靠内核写进数据目录。
// 输出一段 JSON，任何一项不合格以非零码退出。只用 Node 自带模块。
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const zipPath = path.resolve(process.argv[2] ?? '');
const match = path.basename(zipPath).match(/^(simulearn-(?:grid|lab))-(\d+\.\d+\.\d+)\.zip$/);
if (!process.argv[2] || !match || !fs.existsSync(zipPath)) {
  console.error('用法：node scripts/ext-smoke.mjs <dist/ext/simulearn-(grid|lab)-<版本>.zip>');
  process.exit(2);
}
const [, id, version] = match;

// 每个拓展要核对的接口：健康检查、一次计算（附期望），以及读不出来的请求体
const CHECKS = {
  'simulearn-lab': {
    health: 'api/lab/health',
    compute: 'api/lab/simulate',
    computeBody: () => JSON.stringify({
      components: [
        { id: 'V1', type: 'vsource_dc', parameters: { dc: 5 }, connections: { pos: 'n1', neg: 'gnd' } },
        { id: 'R1', type: 'resistor', parameters: { value: 1000 }, connections: { p: 'n1', n: 'n2' } },
        { id: 'R2', type: 'resistor', parameters: { value: 1000 }, connections: { p: 'n2', n: 'gnd' } },
        { id: 'G1', type: 'ground', parameters: {}, connections: { gnd: 'gnd' } },
      ],
      nets: [
        { name: 'n1', nodes: [['V1', 'pos'], ['R1', 'p']] },
        { name: 'n2', nodes: [['R1', 'n'], ['R2', 'p']] },
        { name: 'gnd', nodes: [['V1', 'neg'], ['R2', 'n'], ['G1', 'gnd']] },
      ],
      sim: { t_stop: 1e-3, n_samples: 10 },
      method: 'node_voltage',
    }),
    expect: (data) => Math.abs(data.node_voltages.n2 - 2.5) < 1e-9,
    store: 'api/lab/store',
    storeSince: '0.5.2',
    // 新电路的第一次瞬态：MTK 要现场生成并编译方程代码，烤不进镜像，单独量
    slowBody: () => JSON.stringify({
      components: [
        { id: 'V1', type: 'vsource_dc', parameters: { dc: 5 }, connections: { pos: 'a1', neg: 'gnd' } },
        { id: 'R1', type: 'resistor', parameters: { value: 2200 }, connections: { p: 'a1', n: 'a2' } },
        { id: 'C1', type: 'capacitor', parameters: { value: 4.7e-7 }, connections: { p: 'a2', n: 'gnd' } },
        { id: 'VP1', type: 'voltage_probe', parameters: {}, connections: { node: 'a2' } },
        { id: 'G1', type: 'ground', parameters: {}, connections: { gnd: 'gnd' } },
      ],
      nets: [
        { name: 'a1', nodes: [['V1', 'pos'], ['R1', 'p']] },
        { name: 'a2', nodes: [['R1', 'n'], ['C1', 'p'], ['VP1', 'node']] },
        { name: 'gnd', nodes: [['V1', 'neg'], ['C1', 'n'], ['G1', 'gnd']] },
      ],
      sim: { t_stop: 5e-3, n_samples: 200 },
      method: 'transient',
    }),
  },
  'simulearn-grid': {
    health: 'api/grid/health',
    compute: 'api/grid/pf',
    computeBody: (installDir) => fs.readFileSync(path.join(installDir, 'examples', 'ieee33.json'), 'utf8'),
    // 数值按金标准契约 contracts/grid/pf-ieee33.json 核对：只看「是个对象」的话，算错了也照样过
    expect: (data) => Math.abs(data?.summary?.loss_mw - 0.202677) <= 5e-4 && data?.summary?.vmin_bus === 'bus-18',
    store: 'api/grid/store',
    storeSince: '0.5.3',
  },
}[id];

/** a ≥ b（只比 x.y.z 三段数字） */
const atLeast = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simulearn 冒烟 '));
const installDir = path.join(root, '拓展', id, version);
const sandbox = path.join(root, 'sandbox');
const dirs = {
  depot: path.join(sandbox, 'depot'),
  home: path.join(sandbox, 'home'),
  appData: path.join(sandbox, 'home', 'AppData', 'Roaming'),
  localAppData: path.join(sandbox, 'home', 'AppData', 'Local'),
  temp: path.join(sandbox, 'temp'),
};
const dataDir = path.join(sandbox, 'extensions-data', id);
for (const dir of [installDir, ...Object.values(dirs)]) fs.mkdirSync(dir, { recursive: true });

const failures = [];
// 这份报告是在哪台机器、哪个系统代码页、对哪份 zip 跑出来的：发版要求在代码页 936 上冒一遍，
// 而且冒的必须就是要上传的那份字节，光看报告得分得清
const systemCodePage = () => {
  try {
    // 用 Windows 自带的 5.1：它的默认编码就是系统 ANSI 代码页（PowerShell 7 一律报 65001）
    return Number(execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-Command', '[System.Text.Encoding]::Default.CodePage'], { encoding: 'utf8' }).trim());
  } catch (err) {
    return `读不到：${err.message}`;
  }
};
const sha256OfFile = (file) => {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1 << 20);
  for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n));
  fs.closeSync(fd);
  return hash.digest('hex');
};
const report = {
  id, version, zip: zipPath, zipBytes: fs.statSync(zipPath).size, zipSha256: sha256OfFile(zipPath),
  host: os.hostname(), codePage: systemCodePage(), root,
};
const check = (ok, what) => { if (!ok) failures.push(what); };

function listFiles(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    out.set(full, fs.statSync(full).mtimeMs);
  }
  return out;
}

function changed(before, after) {
  return [...after].filter(([file, mtime]) => before.get(file) !== mtime).map(([file]) => file);
}

// 1. 解压（Windows 自带的 bsdtar 能解 zip；Git Bash 里的 GNU tar 不行，所以写全路径）
let t0 = Date.now();
execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', installDir]);
report.extractSeconds = (Date.now() - t0) / 1000;
const installBefore = listFiles(installDir);
const sandboxBefore = new Map(Object.values(dirs).flatMap((dir) => [...listFiles(dir)]));

// 2. 隔离环境里启动
const token = randomBytes(32).toString('hex');
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
const env = {
  SystemRoot: systemRoot,
  WINDIR: systemRoot,
  PATH: path.join(systemRoot, 'System32'),
  JULIA_DEPOT_PATH: dirs.depot,
  USERPROFILE: dirs.home,
  HOME: dirs.home,
  APPDATA: dirs.appData,
  LOCALAPPDATA: dirs.localAppData,
  TEMP: dirs.temp,
  TMP: dirs.temp,
};
const exe = path.join(installDir, 'bin', `${id}.exe`);
let stderrTail = '';
/** 按约定启动一次拓展，等 ready 行（最多 120 s） */
async function launch(launchToken) {
  const proc = spawn(exe, ['--port', '0', '--token', launchToken, '--data-dir', dataDir, '--host-version', '0.11.3'], {
    env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  proc.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000); });
  const procExited = new Promise((resolve) => proc.on('exit', (code) => resolve({ code, at: Date.now() })));
  const procReady = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 120_000);
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      if (!line.startsWith('{"ready"')) return;
      clearTimeout(timer);
      resolve(JSON.parse(line));
    });
    procExited.then(() => { clearTimeout(timer); resolve(null); });
  });
  return { proc, procExited, procReady };
}
t0 = Date.now();
const { proc: child, procExited: exited, procReady: ready } = await launch(token);
report.readySeconds = (Date.now() - t0) / 1000;
report.ready = ready;
check(ready?.ready === true && ready.contract === 'zhifan-ext/1' && ready.version === version, '120 s 内没有收到合格的 ready 行');

async function finish() {
  report.failures = failures;
  report.stderrTail = failures.length > 0 ? stderrTail : undefined;
  // 解压出来的包有一两个 GB：通过就删掉；没通过留着现场，路径在 root 里
  if (failures.length === 0) {
    await exited;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    report.root = `${root}（已删除）`;
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(failures.length > 0 ? 1 : 0);
}

if (!ready?.ready) {
  child.kill();
  await finish();
}

// 3. 接口
const base = `http://127.0.0.1:${ready.port}/`;
const auth = { 'X-Zhifan-Ext-Token': token };
const timed = async (url, init) => {
  const start = Date.now();
  const response = await fetch(base + url, { ...init, redirect: 'manual' });
  return { response, seconds: (Date.now() - start) / 1000, body: await response.text() };
};
check((await timed(CHECKS.health)).response.status === 401, '不带令牌的健康检查没有返回 401');
check((await timed('ui/')).response.status === 401, '不带令牌的页面没有返回 401');
check((await timed(CHECKS.health, { headers: auth })).response.status === 200, '带令牌的健康检查不是 200');
const page = await timed('ui/', { headers: auth });
check(page.response.status === 200 && page.body.includes('<div id='), '页面 /ui/ 打不开');
check(!/https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)/.test(page.body), '页面 index.html 里有外网地址');
const post = (url, body) => timed(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body });
const first = await post(CHECKS.compute, CHECKS.computeBody(installDir));
report.firstComputeSeconds = first.seconds;
const firstData = JSON.parse(first.body);
check(first.response.status === 200 && firstData.status === 'ok' && CHECKS.expect(firstData.data), `第一次计算不对：${first.body.slice(0, 200)}`);
if (CHECKS.slowBody) {
  const slow = await post(CHECKS.compute, CHECKS.slowBody());
  report.firstTransientSeconds = slow.seconds;
  check(slow.response.status === 200 && JSON.parse(slow.body).status === 'ok', `新电路的第一次瞬态失败：${slow.body.slice(0, 200)}`);
  report.secondTransientSeconds = (await post(CHECKS.compute, CHECKS.slowBody())).seconds;
}
const garbage = await post(CHECKS.compute, 'not json');
check(garbage.response.status === 422, `读不出来的请求体返回 ${garbage.response.status}，应为 422`);

// 6a. 草稿存储：写一条（带中文和换行），当场读回
const storeSupported = Boolean(CHECKS.store) && atLeast(version, CHECKS.storeSince);
const storeKey = `slp:smoke:exp:冒烟 实验:draft-v1`;
const storeValue = JSON.stringify({ note: `冒烟草稿 ${randomBytes(4).toString('hex')}`, lines: 'a\nb' });
if (storeSupported) {
  check((await timed(`${CHECKS.store}?prefix=slp%3Asmoke%3A`)).response.status === 401, '不带令牌的 store 没有返回 401');
  const put = await post(CHECKS.store, JSON.stringify({ entries: { [storeKey]: storeValue } }));
  check(put.response.status === 200 && JSON.parse(put.body).status === 'ok', `store 写入失败：${put.body.slice(0, 200)}`);
  const listed = await timed(`${CHECKS.store}?prefix=${encodeURIComponent('slp:smoke:')}`, { headers: auth });
  check(listed.response.status === 200 && JSON.parse(listed.body).data?.entries?.[storeKey] === storeValue, `store 当场读回不一致：${listed.body.slice(0, 200)}`);
}

// 4. 内存
try {
  const [ws, priv] = execFileSync(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-Command', `$p = Get-Process -Id ${child.pid}; "$($p.WorkingSet64) $($p.PrivateMemorySize64)"`,
  ]).toString().trim().split(' ').map(Number);
  report.memoryMB = { workingSet: Math.round(ws / 2 ** 20), private: Math.round(priv / 2 ** 20) };
} catch (err) {
  report.memoryMB = `读不到：${err.message}`;
}

// 关标准输入，量退出
const closedAt = Date.now();
child.stdin.end();
const exit = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 10_000))]);
report.exitSecondsAfterStdinClose = exit ? (exit.at - closedAt) / 1000 : null;
check(exit !== null && exit.at - closedAt <= 5000, '关掉标准输入后 5 s 内没有退出');
if (!exit) child.kill();

// 5. 写到了哪里
report.writes = {
  installDir: changed(installBefore, listFiles(installDir)).map((file) => path.relative(installDir, file)),
  outsideDataDir: changed(sandboxBefore, new Map(Object.values(dirs).flatMap((dir) => [...listFiles(dir)])))
    .map((file) => path.relative(sandbox, file)),
  dataDirFiles: listFiles(dataDir).size,
};
check(report.writes.installDir.length === 0, '往安装目录写了文件');
check(report.writes.outsideDataDir.length === 0, '往数据目录以外写了文件');

// 6b. 用同一个数据目录重新启动（新令牌），草稿要还在
if (storeSupported && exit) {
  const restartToken = randomBytes(32).toString('hex');
  t0 = Date.now();
  const again = await launch(restartToken);
  report.restartReadySeconds = (Date.now() - t0) / 1000;
  if (again.procReady?.ready) {
    const response = await fetch(`http://127.0.0.1:${again.procReady.port}/${CHECKS.store}?key=${encodeURIComponent(storeKey)}`,
      { headers: { 'X-Zhifan-Ext-Token': restartToken } });
    const body = await response.text();
    report.storeSurvivesRestart = response.status === 200 && JSON.parse(body).data?.value === storeValue;
    check(report.storeSurvivesRestart, `重启后读不回草稿：${body.slice(0, 200)}`);
  } else {
    check(false, '重启后 120 s 内没有 ready');
  }
  again.proc.stdin.end();
  const second = await Promise.race([again.procExited, new Promise((resolve) => setTimeout(() => resolve(null), 10_000))]);
  if (!second) again.proc.kill();
} else if (!storeSupported) {
  report.storeSurvivesRestart = `跳过（${id} ${version} 早于 ${CHECKS.storeSince ?? '—'}，还没有 store 接口）`;
}

await finish();

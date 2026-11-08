// 用真实的知帆客户端（开发版）演练安装 SimuLearn 拓展：一条命令生成演练课堂包 + 起假下载站。
//
//   node scripts/zhifan-rehearsal.mjs [--zip dist/ext/simulearn-grid-0.5.1.zip] [--lab-zip dist/ext/simulearn-lab-0.5.1.zip] [--port 8400] [--out dist/rehearsal]
//
// 假下载站按《拓展对接约定》zhifan-ext/1 §1 提供 /desktop/ext/manifest.json 与拓展 zip；
// bytes / sha256 / unpackedBytes 从 zip 本身算出（口径与知帆的 downloads-worker/sync.mjs --ext 一致）。
// 课堂包按知帆的课堂资源包格式（course-package.json + manifest.json）生成：
// - 配电网（simulearn-grid）四个实验场景：一个用内置算例名引用（{"example": "ieee33"}），一个用
//   simulearn.project/1 工程文件引用（ring4），再加第十二章的两个调压实验（与 scripts/ch12-course-kit.mjs 交给课程站的完全相同）；
// - 电路（simulearn-lab）三个实验场景：分压电路用内置示例名引用，RLC 串联用工程文件引用，再加内置案例库（{"library": "qiu-circuits"}）。
//   dist/ext/ 下没有电路拓展包、也没给 --lab-zip 时不加这三个场景，假下载站也只列配电网。
// 课堂包的 packageId 沿用 simulearn-grid-rehearsal：已经导入过的客户端会把它当成同一个课堂的新版本。
// 只用 Node 自带模块（需要 Node ≥ 22.2 的 zlib.crc32，见 course-package.mjs）。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ch12Experiments } from './ch12-course-kit.mjs';
import { sha256, storedZip } from './course-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const ID = 'simulearn-grid';
const LAB_ID = 'simulearn-lab';
const port = Number(opt('--port', '8400'));
const outDir = path.resolve(root, opt('--out', 'dist/rehearsal'));

const zipName = (id) => new RegExp(`^${id}-(\\d+\\.\\d+\\.\\d+)\\.zip$`);

// 版本号逐段按数字比：按字典序 0.10.0 会排在 0.9.0 前面
const versionKey = (file, id) => file.match(zipName(id))[1].split('.').map(Number);
const compareVersions = (a, b) => a.reduce((diff, part, i) => diff || part - b[i], 0);

function findLatestZip(id) {
  const dir = path.join(root, 'dist', 'ext');
  const zips = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => zipName(id).test(f)) : [];
  zips.sort((a, b) => compareVersions(versionKey(a, id), versionKey(b, id)));
  return zips.length === 0 ? null : path.join('dist', 'ext', zips.at(-1));
}

function extZip(id, flag, required) {
  const given = opt(flag, findLatestZip(id));
  if (!given) {
    if (required) throw new Error(`dist/ext/ 下没有 ${id} 拓展包，先运行 powershell -File scripts/release-ext.ps1 -Id ${id}`);
    return null;
  }
  const zipPath = path.resolve(root, given);
  const file = path.basename(zipPath);
  const version = file.match(zipName(id))?.[1];
  if (!version) throw new Error(`拓展包文件名必须是 ${id}-<版本>.zip：${file}`);
  return { id, zipPath, file, version };
}

const grid = extZip(ID, '--zip', true);
const lab = extZip(LAB_ID, '--lab-zip', false);
const version = grid.version;

/** 从文件里读一段（拓展 zip 可能上 GB，不整个读进内存：Node 单个 Buffer 读不了 2 GiB 以上的文件）。 */
function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, position);
  return buf;
}

/** 读 zip 中央目录，累加所有文件（不含目录）解压后的字节数：约定 §1 的 unpackedBytes 口径。只读文件尾部。 */
function unpackedBytes(zipPath) {
  const size = fs.statSync(zipPath).size;
  const fd = fs.openSync(zipPath, 'r');
  try {
    // 中央目录结尾在最后 22 + 65535（注释最长）字节以内；zip64 的定位记录紧挨在它前面
    const tailStart = Math.max(0, size - 22 - 65535 - 20);
    const tail = readAt(fd, tailStart, size - tailStart);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录结尾）');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      // zip64：从 zip64 中央目录结尾里取真实的条目数、大小与偏移
      const locator = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
      const z64 = readAt(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    return sumCentralDirectory(readAt(fd, cdOffset, cdSize), count);
  } finally {
    fs.closeSync(fd);
  }
}

function sumCentralDirectory(buf, count) {
  let offset = 0;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    let size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    if (size === 0xffffffff) {
      // zip64 扩展字段里的真实大小（解压后大小排在第一个）
      let p = offset + 46 + nameLen;
      const end = p + extraLen;
      while (p < end) {
        const id = buf.readUInt16LE(p);
        const len = buf.readUInt16LE(p + 2);
        if (id === 0x0001) size = Number(buf.readBigUInt64LE(p + 4));
        p += 4 + len;
      }
    }
    if (!name.endsWith('/')) total += size;
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

/** 流式算 sha256，同样不把整个 zip 读进内存 */
function sha256File(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    for (let read; (read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// ---------------- 演练课堂包 ----------------
const ring4 = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'grid-backend', 'examples', 'ring4.json'), 'utf8'));
const ring4Project = {
  schema: 'simulearn.project/1',
  kind: 'grid',
  name: 'ring4 演练算例',
  app: { module: 'grid' },
  // 固定：页面按工程内容算草稿指纹，每次生成都变的话学生草稿会作废
  createdAt: '2026-10-23T00:00:00.000Z',
  payload: ring4,
};
const fallback = '这个实验需要在知帆客户端里安装「仿真实验 · 配电网」拓展。';
const ch12 = ch12Experiments();

// 电路：RLC 串联用工程文件引用，内容取 lab-web 的内置示例（拓展里同一份也能用 {"example": "rlc-series"} 打开）
const labFallback = '这个实验需要在知帆客户端里安装「仿真实验 · 电路」拓展。';
const rlcProject = {
  schema: 'simulearn.project/1',
  kind: 'circuit',
  name: 'RLC 串联演练电路',
  app: { module: 'lab' },
  createdAt: '2026-11-02T00:00:00.000Z',
  payload: JSON.parse(fs.readFileSync(path.join(root, 'packages', 'lab-web', 'src', 'examples', 'data', 'rlc-series.json'), 'utf8')),
};
const labScenes = lab ? [
  { type: 'interactive', title: '电路实验：分压电路（内置示例）',
    content: { type: 'extension', ext: LAB_ID, minVersion: lab.version, experiment: 'rehearsal-lab-divider', project: { example: 'voltage-divider' }, fallback: labFallback } },
  { type: 'interactive', title: '电路实验：RLC 串联（工程文件）',
    content: { type: 'extension', ext: LAB_ID, minVersion: lab.version, experiment: 'rehearsal-lab-rlc', project: 'experiments/lab-rlc.project.json', fallback: labFallback } },
  // 案例库：一个场景进列表，学生自己挑案例（每个案例的草稿在本实验下按案例 id 隔离）
  { type: 'interactive', title: '电路案例库（邱关源《电路》例题）',
    content: { type: 'extension', ext: LAB_ID, minVersion: lab.version, experiment: 'rehearsal-lab-cases', project: { library: 'qiu-circuits' }, fallback: labFallback } },
] : [];
const stageName = lab ? '演练：SimuLearn 仿真拓展（配电网 + 电路）' : '演练：SimuLearn 配电网拓展';

const lectureFiles = {
  'manifest.json': Buffer.from(JSON.stringify({
    stage: { name: stageName },
    scenes: [
      { type: 'slide', title: '演练说明', order: 1, content: { canvas: { viewportSize: 1000, viewportRatio: 0.5625, elements: [] } }, actions: [] },
      { type: 'interactive', title: '看一看：IEEE 33 节点配电网（内置算例）', order: 2,
        content: { type: 'extension', ext: ID, minVersion: version, experiment: 'rehearsal-ieee33', project: { example: 'ieee33' }, fallback } },
      { type: 'interactive', title: '看一看：四节点环网（工程文件）', order: 3,
        content: { type: 'extension', ext: ID, minVersion: version, experiment: 'rehearsal-ring4', project: 'experiments/ring4.project.json', fallback } },
      ...ch12.scenes.map((scene, i) => ({ ...scene, order: 4 + i })),
      ...labScenes.map((scene, i) => ({ ...scene, order: 4 + ch12.scenes.length + i })),
    ],
  })),
  'experiments/ring4.project.json': Buffer.from(JSON.stringify(ring4Project)),
  ...ch12.files,
  ...(lab ? { 'experiments/lab-rlc.project.json': Buffer.from(JSON.stringify(rlcProject)) } : {}),
};
// 每次生成都换版本：知帆导入同一 packageId、同一版本而内容不同的包会拒绝（「同版本内容发生变化」），
// 同一天里先导入只有配电网的包、电路包打好后再导入就会撞上。末段用当天的秒数，保证递增
function rehearsalVersion() {
  const now = new Date();
  const seconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  return `${now.toISOString().slice(0, 10).replaceAll('-', '.')}.${seconds}`;
}
const descriptor = {
  format: 'course-package', formatVersion: 1, minPlayerVersion: 1,
  courseId: 'power-system-analysis', packageId: 'simulearn-grid-rehearsal', version: rehearsalVersion(),
  title: stageName, sceneCount: 3 + ch12.scenes.length + labScenes.length, createdAt: new Date().toISOString(),
  files: Object.fromEntries(Object.entries(lectureFiles).map(([name, data]) => [name, { bytes: data.length, sha256: sha256(data) }])),
};
fs.mkdirSync(outDir, { recursive: true });
const lecturePath = path.join(outDir, 'simulearn-grid-rehearsal.course.zip');
fs.writeFileSync(lecturePath, storedZip([
  ...Object.entries(lectureFiles),
  ['course-package.json', Buffer.from(JSON.stringify(descriptor, null, 2))],
]));

// ---------------- 假下载站 ----------------
const NAMES = { [ID]: '仿真实验 · 配电网', [LAB_ID]: '仿真实验 · 电路' };
const hosted = [grid, lab].filter(Boolean).map((pkg) => {
  // 内存需求、入口以 release-ext.ps1 写在 zip 旁边的摘要为准，演练时客户端的提醒才和正式清单一致。
  // minHost 不取摘要：0.5.1 打包时还是 0.11.0，线上清单后来才升到 0.11.3
  const summaryPath = pkg.zipPath.replace(/\.zip$/, '.summary.json');
  const summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8').replace(/^\uFEFF/, '')) : {};
  return {
    ...pkg,
    bytes: fs.statSync(pkg.zipPath).size,
    entry: {
      id: pkg.id, name: NAMES[pkg.id], version: pkg.version, contract: 'zhifan-ext/1', minHost: '0.11.3', file: pkg.file,
      bytes: fs.statSync(pkg.zipPath).size, unpackedBytes: unpackedBytes(pkg.zipPath), sha256: sha256File(pkg.zipPath),
      entry: summary.entry ?? `bin/${pkg.id}.exe`, requires: summary.requires ?? { memoryMB: 2048 }, licenses: 'LICENSES/index.html',
      notes: '本机演练用（假下载站）', publishedAt: new Date().toISOString(),
    },
  };
});
const manifestFor = (origin) => ({
  format: 'zhifan.ext-manifest/1',
  extensions: hosted.map((pkg) => ({ ...pkg.entry, url: `${origin}/desktop/ext/${pkg.file}` })),
});

let origin;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  console.log(`[site] ${req.method} ${name}`);
  if (name === '/desktop/ext/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(manifestFor(origin)));
    return;
  }
  const pkg = hosted.find((item) => name === `/desktop/ext/${item.file}`);
  if (pkg) {
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': pkg.bytes });
    fs.createReadStream(pkg.zipPath).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  const desktop = 'D:\\workspace\\Dev_course\\course-site\\desktop';
  const extensions = hosted.map(({ entry }) => ({ file: entry.file, version: entry.version, bytes: entry.bytes, unpackedBytes: entry.unpackedBytes, sha256: entry.sha256 }));
  console.log(JSON.stringify({ origin, extensions }, null, 2));
  console.log(`\n课堂包：${lecturePath}`);
  console.log(`\n在另一个 PowerShell 窗口里启动知帆客户端开发版（数据放在单独目录，不碰正式数据）：\n`);
  console.log(`  cd ${desktop}`);
  console.log(`  $env:ZHIFAN_EXT_ORIGIN = "${origin}"`);
  console.log(`  $env:ZHIFAN_USER_DATA = "$env:TEMP\\zhifan-rehearsal"`);
  console.log(`  npm start`);
  console.log(lab
    ? `\n然后：个人中心 → 拓展 → 安装「仿真实验 · 配电网」和「仿真实验 · 电路」；课程 → 导入课堂资源包 → 选上面的课堂包；进入课堂做七个实验（四个配电网，其中两个是第十二章调压实验；三个电路，最后一个是案例库）。`
    : `\n然后：个人中心 → 拓展 → 安装「仿真实验 · 配电网」；课程 → 导入课堂资源包 → 选上面的课堂包；进入课堂做四个实验（后两个是第十二章调压实验）。`);
  console.log('（本窗口保持运行；Ctrl+C 结束假下载站）');
});

// 用真实的知帆客户端（开发版）演练安装 simulearn-grid 拓展：一条命令生成演练课堂包 + 起假下载站。
//
//   node scripts/zhifan-rehearsal.mjs [--zip dist/ext/simulearn-grid-0.5.0.zip] [--port 8400] [--out dist/rehearsal]
//
// 假下载站按《拓展对接约定》zhifan-ext/1 §1 提供 /desktop/ext/manifest.json 与拓展 zip；
// bytes / sha256 / unpackedBytes 从 zip 本身算出（口径与知帆的 downloads-worker/sync.mjs --ext 一致）。
// 课堂包按知帆的课堂资源包格式（course-package.json + manifest.json）生成，含四个拓展实验场景：
// 一个用内置算例名引用（{"example": "ieee33"}），一个用 simulearn.project/1 工程文件引用（ring4），
// 再加第十二章的两个调压实验（与 scripts/ch12-course-kit.mjs 交给课程站的完全相同）。
// 只用 Node 自带模块（需要 Node ≥ 22.2 的 zlib.crc32）。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { ch12Experiments } from './ch12-course-kit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const ID = 'simulearn-grid';
const port = Number(opt('--port', '8400'));
const outDir = path.resolve(root, opt('--out', 'dist/rehearsal'));
const zipPath = path.resolve(root, opt('--zip', findLatestZip()));
const file = path.basename(zipPath);
const version = file.match(/^simulearn-grid-(\d+\.\d+\.\d+)\.zip$/)?.[1];
if (!version) throw new Error(`拓展包文件名必须是 ${ID}-<版本>.zip：${file}`);

function findLatestZip() {
  const dir = path.join(root, 'dist', 'ext');
  const zips = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^simulearn-grid-\d+\.\d+\.\d+\.zip$/.test(f)) : [];
  if (zips.length === 0) throw new Error('dist/ext/ 下没有拓展包，先运行 powershell -File scripts/release-ext.ps1');
  return path.join('dist', 'ext', zips.sort().at(-1));
}

/** 读 zip 中央目录，累加所有文件（不含目录）解压后的字节数：约定 §1 的 unpackedBytes 口径。 */
function unpackedBytes(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录结尾）');
  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    // zip64：从 zip64 中央目录结尾里取真实的条目数与偏移
    const locator = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
    const z64 = Number(buf.readBigUInt64LE(locator + 8));
    count = Number(buf.readBigUInt64LE(z64 + 32));
    offset = Number(buf.readBigUInt64LE(z64 + 48));
  }
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

/** 最小的 zip 写入（只存储不压缩），课堂包里都是小 JSON。 */
function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // 文件名用 UTF-8
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ---------------- 演练课堂包 ----------------
const ring4 = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'grid-backend', 'examples', 'ring4.json'), 'utf8'));
const ring4Project = {
  schema: 'simulearn.project/1',
  kind: 'grid',
  name: 'ring4 演练算例',
  app: { module: 'grid' },
  createdAt: new Date().toISOString(),
  payload: ring4,
};
const fallback = '这个实验需要在知帆客户端里安装「仿真实验 · 配电网」拓展。';
const ch12 = ch12Experiments();
const lectureFiles = {
  'manifest.json': Buffer.from(JSON.stringify({
    stage: { name: '演练：SimuLearn 配电网拓展' },
    scenes: [
      { type: 'slide', title: '演练说明', order: 1, content: { canvas: { viewportSize: 1000, viewportRatio: 0.5625, elements: [] } }, actions: [] },
      { type: 'interactive', title: '看一看：IEEE 33 节点配电网（内置算例）', order: 2,
        content: { type: 'extension', ext: ID, minVersion: version, experiment: 'rehearsal-ieee33', project: { example: 'ieee33' }, fallback } },
      { type: 'interactive', title: '看一看：四节点环网（工程文件）', order: 3,
        content: { type: 'extension', ext: ID, minVersion: version, experiment: 'rehearsal-ring4', project: 'experiments/ring4.project.json', fallback } },
      ...ch12.scenes.map((scene, i) => ({ ...scene, order: 4 + i })),
    ],
  })),
  'experiments/ring4.project.json': Buffer.from(JSON.stringify(ring4Project)),
  ...ch12.files,
};
const descriptor = {
  format: 'course-package', formatVersion: 1, minPlayerVersion: 1,
  courseId: 'power-system-analysis', packageId: 'simulearn-grid-rehearsal', version: `${new Date().toISOString().slice(0, 10).replaceAll('-', '.')}.1`,
  title: '演练：SimuLearn 配电网拓展', sceneCount: 3 + ch12.scenes.length, createdAt: new Date().toISOString(),
  files: Object.fromEntries(Object.entries(lectureFiles).map(([name, data]) => [name, { bytes: data.length, sha256: sha256(data) }])),
};
fs.mkdirSync(outDir, { recursive: true });
const lecturePath = path.join(outDir, 'simulearn-grid-rehearsal.course.zip');
fs.writeFileSync(lecturePath, storedZip([
  ...Object.entries(lectureFiles),
  ['course-package.json', Buffer.from(JSON.stringify(descriptor, null, 2))],
]));

// ---------------- 假下载站 ----------------
const zipBuf = fs.readFileSync(zipPath);
const ext = {
  id: ID, name: '仿真实验 · 配电网', version, contract: 'zhifan-ext/1', minHost: '0.11.3', file,
  bytes: zipBuf.length, unpackedBytes: unpackedBytes(zipBuf), sha256: sha256(zipBuf),
  entry: 'bin/simulearn-grid.exe', requires: { memoryMB: 2048 }, licenses: 'LICENSES/index.html',
  notes: '本机演练用（假下载站）', publishedAt: new Date().toISOString(),
};
const manifestFor = (origin) => ({ format: 'zhifan.ext-manifest/1', extensions: [{ ...ext, url: `${origin}/desktop/ext/${file}` }] });

let origin;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  console.log(`[site] ${req.method} ${name}`);
  if (name === '/desktop/ext/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(manifestFor(origin)));
    return;
  }
  if (name === `/desktop/ext/${file}`) {
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zipBuf.length });
    res.end(zipBuf);
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  const desktop = 'D:\\workspace\\Dev_course\\course-site\\desktop';
  console.log(JSON.stringify({ origin, extension: { file, version, bytes: ext.bytes, unpackedBytes: ext.unpackedBytes, sha256: ext.sha256 } }, null, 2));
  console.log(`\n课堂包：${lecturePath}`);
  console.log(`\n在另一个 PowerShell 窗口里启动知帆客户端开发版（数据放在单独目录，不碰正式数据）：\n`);
  console.log(`  cd ${desktop}`);
  console.log(`  $env:ZHIFAN_EXT_ORIGIN = "${origin}"`);
  console.log(`  $env:ZHIFAN_USER_DATA = "$env:TEMP\\zhifan-rehearsal"`);
  console.log(`  npm start`);
  console.log(`\n然后：个人中心 → 拓展 → 安装「仿真实验 · 配电网」；课程 → 导入课堂资源包 → 选上面的课堂包；进入课堂做四个实验（后两个是第十二章调压实验）。`);
  console.log('（本窗口保持运行；Ctrl+C 结束假下载站）');
});

#!/usr/bin/env node
// 第十二章调压实验（例 12-3）的课程站交接件：两个工程文件 + 两个实验场景，接在第 2 讲「例 12-3」那一场后面。
// 工程文件由 packages/grid-backend/examples 里的算例包成 simulearn.project/1 信封，算例只在后端维护一份，
// 金标准契约（contracts/grid/pf-ch12-*.json）也指向同一份，课程里给学生的就是契约测过的那份。
//
//   node scripts/ch12-course-kit.mjs            # 写到 dist/course/ch12/
//   node scripts/ch12-course-kit.mjs --out <目录>
//
// 课程内容的部署走课程站自己的流程，这里只产出交接件，不碰课程站仓库。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 第一个带变压器挡位与电容组的版本（D16）。0.5.0 导入时会悄悄丢掉不认识的变压器和电容组，
// 算例就成了两条断开的母线，所以必须靠 minVersion 让宿主先提示更新拓展。
export const CH12_MIN_VERSION = '0.5.1';
const EXT_ID = 'simulearn-grid';
const FALLBACK = '这个实验需要在知帆客户端里安装「仿真实验 · 配电网」拓展。';
// 固定写算例定稿日：页面按工程文件内容算指纹来决定恢复不恢复学生草稿，取当前时间会让每次重新生成都作废草稿。
// 改了算例再改这个日期。
const CH12_CREATED_AT = '2026-10-24T00:00:00.000Z';

const CASES = [
  {
    example: 'ch12_tap_max',
    experiment: 'ch12-tap-max',
    name: '例 12-3 降压变电所（最大负荷 28 + j14 MVA）',
    title: '调压实验 ①：最大负荷下选分接头',
  },
  {
    example: 'ch12_tap_min',
    experiment: 'ch12-tap-min',
    name: '例 12-3 降压变电所（最小负荷 10 + j6 MVA）',
    title: '调压实验 ②：最小负荷下核对分接头',
  },
];

/** 返回 { files: {课程包内相对路径: Buffer}, scenes: [场景对象] }；场景不带 order，由课程站排定 */
export function ch12Experiments({ minVersion = CH12_MIN_VERSION, createdAt = CH12_CREATED_AT } = {}) {
  const files = {};
  const scenes = [];
  for (const c of CASES) {
    const payload = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'grid-backend', 'examples', `${c.example}.json`), 'utf8'));
    const project = { schema: 'simulearn.project/1', kind: 'grid', name: c.name, app: { module: 'grid' }, createdAt, payload };
    const rel = `experiments/${c.experiment}.project.json`;
    files[rel] = Buffer.from(`${JSON.stringify(project, null, 2)}\n`);
    // 没有 task：试点不判分（Q33 = a），学生打开满 60 秒后点「我已完成」，或随时「先跳过」（约定 §6）
    scenes.push({
      type: 'interactive',
      title: c.title,
      content: { type: 'extension', ext: EXT_ID, minVersion, experiment: c.experiment, project: rel, fallback: FALLBACK },
    });
  }
  return { files, scenes };
}

function main() {
  const i = process.argv.indexOf('--out');
  const outDir = i > 0 ? path.resolve(process.argv[i + 1]) : path.join(root, 'dist', 'course', 'ch12');
  const { files, scenes } = ch12Experiments();
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(outDir, rel), data);
  }
  fs.writeFileSync(path.join(outDir, 'scenes.json'), `${JSON.stringify(scenes, null, 2)}\n`);
  console.log(`已写出第十二章实验交接件：${outDir}`);
  for (const rel of [...Object.keys(files), 'scenes.json']) console.log(`  ${rel}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

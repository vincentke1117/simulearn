// 列出打进前端页面的 npm 包目录（发布包许可清单用，设计记录 D18）：
//   node scripts/web-deps.mjs packages/lab-web
// 从前端包的 dependencies 出发，沿每个包的 dependencies / optionalDependencies 走完整个闭包，
// 按 Node 的查找规则（自己的 node_modules → 逐级往上）定位目录，每行打印一个绝对路径。
// devDependencies 原则上不算：构建工具不进产物（lab-web 的 manualChunks 虽然列了 headlessui / radix，
// 源码里没有引用，打出来的 ui 块是空的）。例外是构建时会把自己的代码写进产物的，见 BUILD_TIME_EMBEDDED。
// 闭包可能比实际打进去的多几个，许可清单宁多勿漏。
import fs from 'node:fs';
import path from 'node:path';

// 不带参数时 path.resolve 会落到当前目录，在仓库根目录就会列出废弃旧壳的依赖，所以先要参数
if (!process.argv[2]) {
  console.error('用法：node scripts/web-deps.mjs <前端包目录>');
  process.exit(2);
}
const webDir = path.resolve(process.argv[2]);
if (!fs.existsSync(path.join(webDir, 'package.json'))) {
  console.error('用法：node scripts/web-deps.mjs <前端包目录>');
  process.exit(2);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** 从 fromDir 起逐级往上找 node_modules/<name> */
function locate(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

// 构建时把自己的代码写进产物的 devDependencies：Tailwind 的 preflight 与工具类原样进了 CSS（版权行被压缩掉了），
// Vite 的 modulepreload polyfill 与 __vitePreload 进了入口 JS。看前端目录里有没有对应的配置文件判断用没用到
// （lab-web 的 vite 装在仓库根目录，不在它自己的 devDependencies 里）
const BUILD_TIME_EMBEDDED = [
  { name: 'tailwindcss', configs: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'] },
  { name: 'vite', configs: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'] },
];

const found = new Map();
const missing = [];
const visit = (pkgDir, optional) => {
  const meta = readJson(path.join(pkgDir, 'package.json'));
  const deps = { ...meta.dependencies, ...meta.optionalDependencies };
  for (const name of Object.keys(deps)) {
    const dir = locate(name, pkgDir);
    if (!dir) {
      // 可选依赖没装（多半是别的平台的二进制）：不在产物里，跳过
      if (!(name in (meta.optionalDependencies ?? {})) && !optional) missing.push(`${name}（${meta.name ?? pkgDir} 需要）`);
      continue;
    }
    const real = fs.realpathSync(dir);
    if (found.has(real)) continue;
    found.set(real, name);
    visit(real, optional || name in (meta.optionalDependencies ?? {}));
  }
};
visit(webDir, false);
for (const { name, configs } of BUILD_TIME_EMBEDDED) {
  if (!configs.some((file) => fs.existsSync(path.join(webDir, file)))) continue;
  const dir = locate(name, webDir);
  if (!dir) {
    missing.push(`${name}（构建要用到）`);
    continue;
  }
  // 只列它本身：它的依赖是构建期工具链，不进产物
  found.set(fs.realpathSync(dir), name);
}

if (missing.length > 0) {
  console.error(`找不到这些依赖（先在仓库根目录 npm ci）：\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
for (const dir of [...found.keys()].sort()) console.log(dir);

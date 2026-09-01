import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(repoRoot, 'packages', 'lab-web', 'dist')
const assetsDir = join(distDir, 'assets')
const html = readFileSync(join(distDir, 'index.html'), 'utf8')
const initialNames = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.js)"/g)].map((match) => match[1])
  )
]
const allNames = readdirSync(assetsDir).filter((name) => name.endsWith('.js'))

function sizeOf(name) {
  const filePath = join(assetsDir, name)
  const content = readFileSync(filePath)
  return { raw: statSync(filePath).size, gzip: gzipSync(content).length }
}

function total(names, key) {
  return names.reduce((sum, name) => sum + sizeOf(name)[key], 0)
}

const asyncNames = allNames.filter((name) => !initialNames.includes(name))
const initialRaw = total(initialNames, 'raw')
const initialGzip = total(initialNames, 'gzip')
const totalRaw = total(allNames, 'raw')
const largestAsyncRaw = Math.max(0, ...asyncNames.map((name) => sizeOf(name).raw))

const limits = {
  initialRaw: 2 * 1024 * 1024,
  initialGzip: 650 * 1024,
  totalRaw: Math.floor(3.2 * 1024 * 1024),
  largestAsyncRaw: Math.floor(1.5 * 1024 * 1024)
}
const metrics = { initialRaw, initialGzip, totalRaw, largestAsyncRaw }
const failures = []
for (const [name, limit] of Object.entries(limits)) {
  if (metrics[name] > limit) failures.push(`${name}: ${metrics[name]} > ${limit}`)
}

const forbiddenInitialPrefixes = [
  'SimulationResultPanel-',
  'Plot-',
  'BodePlot-',
  'StepResponseChart-',
  'jspdf.',
  'html2canvas.'
]
for (const name of initialNames) {
  if (forbiddenInitialPrefixes.some((prefix) => name.startsWith(prefix))) {
    failures.push(`heavy async chunk leaked into initial graph: ${name}`)
  }
}

const requiredAsyncPrefixes = ['SimulationResultPanel-', 'Plot-', 'jspdf.', 'html2canvas.']
for (const prefix of requiredAsyncPrefixes) {
  if (!asyncNames.some((name) => name.startsWith(prefix))) {
    failures.push(`expected async chunk is missing: ${prefix}`)
  }
}

console.log(
  JSON.stringify(
    {
      dist: relative(repoRoot, distDir),
      initialNames,
      ...metrics,
      limits
    },
    null,
    2
  )
)

if (failures.length > 0) {
  console.error(`Bundle budget failed:\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
}

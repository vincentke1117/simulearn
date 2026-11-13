// 知帆课堂资源包（course-package，formatVersion 1）的最小打包工具：演练脚本和各课程交接脚本共用。
// 格式以知帆客户端的导入逻辑为准（course-site/desktop/lib/packages.mjs 的 validateDescriptor / importPackage）：
// zip 根目录放 course-package.json（身份 + 文件清单的字节数与 sha256）和课堂清单 manifest.json，其余文件都要登记在清单里。
// 只用 Node 自带模块（需要 Node ≥ 22.2 的 zlib.crc32）。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** 最小的 zip 写入（只存储不压缩），课堂包里都是小 JSON。entries 是 [文件名, Buffer] 列表，文件名用正斜杠。 */
export function storedZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // 文件名用 UTF-8
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

/**
 * 打一个课堂资源包。files 是 {相对路径: Buffer}，必须含 manifest.json。
 * 知帆按 courseId + packageId 认同一个课堂，同一 version 内容变了会拒绝导入（「同版本内容发生变化」），改内容就换版本。
 */
export function coursePackage({ courseId, packageId, version, title, files, createdAt = new Date().toISOString() }) {
  if (!files['manifest.json']) throw new Error('课堂包缺少 manifest.json')
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'))
  const descriptor = {
    format: 'course-package', formatVersion: 1, minPlayerVersion: 1,
    courseId, packageId, version, title, sceneCount: manifest.scenes.length, createdAt,
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { bytes: data.length, sha256: sha256(data) }])),
  }
  return storedZip([...Object.entries(files), ['course-package.json', Buffer.from(JSON.stringify(descriptor, null, 2))]])
}

// ---------------- 课程站课堂目录 ----------------
// 课程站（course-site）的一讲 = <课程目录>/classrooms/<讲>/：manifest.json + 课堂里引用的文件 + private/answers.json（测验答案，
// 拓展实验场景没有测验，写空对象）。register-content.mts 从这里读场景数，pack-chapter-release.mjs 把整个目录打进客户端课程包。

const slideText = (id, left, top, width, height, html, color = '#333333') => ({
  id, type: 'text', left, top, width, height, content: html, defaultFontName: 'Microsoft YaHei', defaultColor: color, rotate: 0,
})
const slidePara = (body, size = 18) => `<p style="font-size:${size}px;">${body}</p>`

/** 一页文字说明（标题 + 若干条），网站与客户端的播放器都按 OpenMAIC 的画布格式画；paragraphs 里可用 <strong> */
export function guideSlide(title, paragraphs) {
  return {
    type: 'slide', title,
    content: {
      canvas: {
        viewportSize: 1000, viewportRatio: 0.5625,
        background: { type: 'solid', color: '#ffffff' },
        elements: [
          slideText('title', 60, 40, 880, 60, slidePara(`<strong>${title}</strong>`, 30), '#1e3a5f'),
          { id: 'rule', type: 'shape', left: 60, top: 104, width: 880, height: 3, path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z', viewBox: [1, 1], fill: '#5b9bd5', fixedRatio: false, rotate: 0 },
          slideText('body', 60, 124, 880, 400, paragraphs.map((body) => slidePara(`• ${body}`)).join('')),
        ],
      },
    },
    actions: [],
  }
}

/** 把一讲写成课程站的课堂目录（先清空再写，目录里只留这次的文件） */
export function writeClassroom(dir, files) {
  if (!files['manifest.json']) throw new Error('课堂目录缺少 manifest.json')
  fs.rmSync(dir, { recursive: true, force: true })
  for (const [rel, data] of Object.entries({ ...files, 'private/answers.json': Buffer.from('{}') })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), data)
  }
}

// 知帆课堂资源包（course-package，formatVersion 1）的最小打包工具：演练脚本和各课程交接脚本共用。
// 格式以知帆客户端的导入逻辑为准（course-site/desktop/lib/packages.mjs 的 validateDescriptor / importPackage）：
// zip 根目录放 course-package.json（身份 + 文件清单的字节数与 sha256）和课堂清单 manifest.json，其余文件都要登记在清单里。
// 只用 Node 自带模块（需要 Node ≥ 22.2 的 zlib.crc32）。
import { createHash } from 'node:crypto'
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

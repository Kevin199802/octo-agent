/**
 * 最小 ZIP 打包器(SPEC-DES-001 §5.6)
 *
 * 用 node 内置 zlib 自己写,不依赖系统 `zip`(Windows 没有)也不依赖
 * `Compress-Archive`(两平台行为不一致、对大量小文件极慢)。
 *
 * ⚠️ **general purpose bit 11(UTF-8 flag)必须置位**,文件名按 UTF-8 写入。
 * 不置这一位时 Windows 资源管理器会按系统 ANSI 代码页(内网即 GBK)解释文件名,
 * 中文产物名/页面名解压后全是乱码 —— 内网中文命名概率很高。
 */
import { createWriteStream } from "node:fs"
import { deflateRawSync } from "node:zlib"

const UTF8_FLAG = 0x0800

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** JS Date → DOS 时间/日期(ZIP 用的老格式,1980 起算,秒取偶数) */
function dosTime(d) {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * @param {string} outPath 输出 zip 路径
 * @param {{name: string, data: Buffer, mtime: Date, isDir?: boolean}[]} entries
 *   name 用 '/' 分隔;目录 entry 的 name 以 '/' 结尾、data 为空
 */
export async function writeZip(outPath, entries) {
  const out = createWriteStream(outPath)
  const chunks = []
  const central = []
  let offset = 0

  const push = (buf) => {
    chunks.push(buf)
    offset += buf.length
  }

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8")
    const { time, date } = dosTime(e.mtime ?? new Date())
    const raw = e.isDir ? Buffer.alloc(0) : e.data
    const crc = crc32(raw)
    // 目录与空文件不压缩(method 0),其余 deflate(method 8)
    const compressed = raw.length === 0 ? raw : deflateRawSync(raw, { level: 6 })
    const method = raw.length === 0 ? 0 : 8
    const localOffset = offset

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(UTF8_FLAG, 6) // ★ 中文文件名靠这一位
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    push(local)
    push(nameBuf)
    if (compressed.length) push(compressed)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(UTF8_FLAG, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(time, 12)
    cen.writeUInt16LE(date, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(compressed.length, 20)
    cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30) // extra
    cen.writeUInt16LE(0, 32) // comment
    cen.writeUInt16LE(0, 34) // disk number
    cen.writeUInt16LE(0, 36) // internal attrs
    cen.writeUInt32LE(e.isDir ? 0x10 : 0, 38) // external attrs:目录位
    cen.writeUInt32LE(localOffset, 42)
    central.push(Buffer.concat([cen, nameBuf]))
  }

  const centralStart = offset
  for (const c of central) push(c)
  const centralSize = offset - centralStart

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20)
  push(end)

  await new Promise((resolve, reject) => {
    out.on("error", reject)
    out.on("finish", resolve)
    out.end(Buffer.concat(chunks))
  })
  return offset
}

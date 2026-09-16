#!/usr/bin/env node
/**
 * 假 dev server —— 替换 @turboui/turbo-ui-cli-service,让端口这一层可以在外网验证
 * (SPEC-DES-004 §7.1)。不需要内网组件库,也不需要 skill 运行环境。
 *
 * 对齐真品的**可观测面**:读 OCTO_PORT、只监听 127.0.0.1、日志打 webpack 那几个标志、
 * EADDRINUSE 时打真实错误码后退出、watch views/ 模拟 HMR。
 *
 * 多出来的一点:响应体直接回 `SERVED_BY=<工程目录>`,于是"这个端口上跑的是谁的服务"
 * 可以被一句话判定 —— 这正是串台类缺陷的判据。
 *
 * 可调:FAKE_LISTEN_DELAY_MS 模拟"先编译、后 listen"的时间窗(真实首次编译 1–3 分钟)。
 */
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const port = Number(process.env.OCTO_PORT) || 8081
const cwd = process.cwd() // <projectDir>/packages/portal
const viewsDir = path.join(cwd, "src", "views")
const log = (s) => process.stdout.write(s + "\n")
const readPage = () => {
  try {
    return fs.readFileSync(path.join(viewsDir, "index.vue"), "utf8").trim()
  } catch {
    return "(missing)"
  }
}

log(`[fake-cli] pid=${process.pid} cwd=${cwd} OCTO_PORT=${port}`)
log("Compiling...")

setTimeout(() => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    res.end(`SERVED_BY=${cwd}\nPID=${process.pid}\nPAGE=${readPage()}\n`)
  })
  srv.on("error", (e) => {
    // 真品在这里打的是 `Error: listen EADDRINUSE: address already in use 127.0.0.1:8081`
    log(`Error: listen ${e.code}: address already in use 127.0.0.1:${port}`)
    log("Failed to compile with 1 error")
    process.exit(1)
  })
  srv.listen(port, "127.0.0.1", () => {
    log(`  App running at http://127.0.0.1:${port}`)
    log("Compiled successfully in 120ms")
    try {
      fs.watch(viewsDir, { recursive: true }, () => {
        log("Compiling...")
        setTimeout(() => log("Compiled successfully in 30ms"), 80)
      })
    } catch {
      /* 平台不支持 recursive watch,HMR 那部分用例跳过 */
    }
  })
}, Number(process.env.FAKE_LISTEN_DELAY_MS || 0))

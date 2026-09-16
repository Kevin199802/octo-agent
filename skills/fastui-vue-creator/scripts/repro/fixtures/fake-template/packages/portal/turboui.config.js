// 与真品模板同构:端口从 OCTO_PORT 读,带回退(SPEC-DES-001 §2.2)
module.exports = { devServer: { port: Number(process.env.OCTO_PORT) || 8081, host: "127.0.0.1" } }

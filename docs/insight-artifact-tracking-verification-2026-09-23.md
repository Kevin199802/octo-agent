# Insight 产物打点人工验证记录（2026-09-23）

## 结论与证据范围

用户反馈：docx、PDF、xlsx 文件的**生成和编辑打点均已成功**；此前 `write`、`edit`、MCP return 三条产物打点路径也已确认成功。因此，本轮观察到的“docx 成功而 PDF、xlsx 不成功”现象已不再复现。

这是一份人工反馈记录。当前没有附上每次调用的 tool part、eventId、接收端记录或精确事件数，故不把上述结果扩展解释为所有生成方式、所有文件大小及重试场景均已验收。

| 已确认的场景 | 本轮记录 |
| --- | --- |
| docx 生成、编辑 | 用户确认打点成功 |
| PDF 生成、编辑 | 用户确认打点成功 |
| xlsx 生成、编辑 | 用户确认打点成功 |
| `write` / `edit` 工具产物 | 此前已确认打点成功 |
| MCP return 产物 | 此前已确认打点成功 |

## 与实现的对应关系

UXAI [PR #913](https://github.com/MyHeavenDyf/UXAI/pull/913) 中，服务端在工具完成后采集产物事实，并通过持久化队列发送。`write` 和 `edit` 工具分别产生 `artifact-file-write`、`artifact-file-edit`；成功且具备有效资源身份的 MCP 返回产生 `artifact-mcp-return`。

[提交 `4d3c384`](https://github.com/MyHeavenDyf/UXAI/commit/4d3c384a1491c0e81bac91678761f0cd13f39545) 补充 Shell 路径：调用在 `artifactFiles` 中声明最终文件，命令成功且文件通过执行前后字节核验后，新建文件按 `artifact-file-write`、已有文件的内容变化按 `artifact-file-edit` 采集。docx、PDF、xlsx 的扩展名均归入 `file` 类型；扩展名本身不会决定是否触发事件。实际某次成功打点来自直接工具、Shell 还是 MCP，需以该次调用记录为准。

实现规则和诊断字段见 UXAI 仓的 [服务端产物打点方案](https://github.com/MyHeavenDyf/UXAI/blob/4d3c384a1491c0e81bac91678761f0cd13f39545/packages/app/octoapp/pages/insight/docs/server-artifact-delivery.md)。

## 尚未由本次反馈证明的场景

- 页面切换、进程重启、网络失败后的补发与去重，以及接收端的实际落库数量。
- 自动压缩续跑后的原轮次归属；该场景未计入本次文件类型验证。
- Shell 未声明目标、目标位于会话 `uploads/outputs` 外、单文件超过 64 MiB，或导出程序在命令返回后仍继续写盘的情况。

后续如需按事件数复核，应同时保存对应的工具名、`artifactFiles`、采集回执、eventId 与接收端记录；只看文件是否生成，无法判断由哪条采集路径上报。

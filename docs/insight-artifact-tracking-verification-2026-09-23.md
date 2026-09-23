# Insight 产物打点人工验证记录（2026-09-23）

## 结论与证据范围

用户最新确认：**PDF/XLSX 没有问题**，此前 DOCX 生成/编辑、直接 `write` / `edit` 和 MCP return 打点也已确认成功。当前已定位的问题是三条 TXT Shell 写入调用漏传 `artifactFiles`，导致采集结果为 `script-targets-not-declared`，未生成产物事件。PDF/XLSX 不再列为待排查问题；TXT 完全漏传参数的执行前拦截已在代码中实现，自动化验证通过，等待新包端上复验。

成功场景以用户人工确认为依据；三条 TXT 漏报另有完整 tool part 支持，详见文末。当前没有所有调用的 eventId、接收端记录或精确事件数，故不把成功样本扩展解释为所有生成方式、所有文件大小及重试场景均已验收。

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

## 补充：四组 TXT Shell 漏报反馈（2026-09-23）

以下保留首次排查时的证据状态；后续原始记录已定位三条 TXT 漏报，见文末补证。首次检查基于 UXAI 当时检出的 `codex/insight-script-artifacts` / `6069fe996`。用户贴出的主要是模型叙述和部分命令展示，不包含完整 tool part，不能据此确认每次调用实际传入了 `artifactFiles`，也不能确认安装包版本与当前代码相同。

| 反馈 | 当前可以判断的事实 | 尚需原始记录确认 |
| --- | --- | --- |
| uploads 中 TXT 追加 7890 | 叙述出现反复追加和重写。原文件修改属于 edit；绝对路径和以 outputs 为 workdir 的 `../uploads/文件名.txt` 都可声明 | 每次真实 input、exit、before/after 诊断；不能把模型声称“已声明”当作参数证据 |
| Set-Content 创建 123.txt，内容 abc | 命令展示中有目标文件；Shell 采集器不会从命令文本自动提取它 | 是否传入 `artifactFiles: ["123.txt"]`，实际 workdir 是否位于原会话 outputs |
| Add-Content 追加 uio | 业务意图属于 edit，需执行同一次命令前后的字节变化 | 完整命令及参数；目前只有模型对执行结果的描述 |
| 创建中文 TXT，再回读/启动记事本 | 编码处理和打开记事本是不同调用，不能将最后一个调用当成最初写盘的证明 | 实际写盘调用是否声明；记事本调用是否超时/中断；不能仅凭 ChildProcess.kill 判断之前写盘失败 |

### 已确认的实现限制

1. `artifactFiles` 在 Shell schema 中是可选的。未传/空列表时，业务命令照常执行，采集结果为 `script-targets-not-declared`，不会生成产物事件。当前依赖模型在首次真实写盘调用中填对参数，提示词不能保证覆盖率。
2. 路径支持绝对路径和相对 workdir 的路径，不存在“只能用相对路径”的要求。路径须落在原会话的 uploads/outputs；不要凭对话排版修改路径。贴文中的 `D:\测试文件逐字稿.octo\...` 与通常的 `D:\测试文件逐字稿\.octo\...` 不同，但缺少原始参数，不能认定实际执行路径缺了分隔符。
3. 如果先写盘，后面才声明目标并执行只读验证，后一次前后字节相同，只会得到 `script-no-change`，不会补出首次写入前的快照。不得为补打点再次追加、覆盖或重置用户文件。
4. 当前工具参数类型校验发生在命令执行之前；该次调用参数若不符合 schema，命令不会执行。执行前后文件核验失败则保存到 `state.metadata.artifactScript`，不把它转换为 Shell 输出中的报错。贴文中的“执行成功但 artifactFiles 校验失败”可能混合了不同调用或模型推断，需核对真实记录。
5. `(no output)` 只表示没有输出文本，不能单独证明退出码为 0，更不能证明事件已经生成或远程落库。同轮同路径同 name 也会去重；多次编辑不等于多条 edit 事件。
6. TXT 同样漏报，说明不能把问题直接归结为 PDF/XLSX 文件类型。当前证据不足以把这四次漏报统一归因为某一个代码错误。

源码位置：Shell 参数 `packages/opencode/src/tool/shell/prompt.ts`；参数校验 `packages/opencode/src/tool/tool.ts`；快照与判定 `packages/opencode/src/tracking/scripts.ts`；事件与回执 `packages/opencode/src/tracking/store.ts`。

### 下一条失败记录应保留的证据

在实际发生问题的机器上，以 sessionId/toolCallId 关联以下内容：

- `state.input`：command、workdir、artifactFiles 的原始值。
- `state.status`、`state.error`（若有）、`state.metadata.exit`。
- `state.metadata.artifactScript`：顶层 reason、每个目标的 before/after 和 reason。
- 对应 receipt、event 的 state/reason；没有 event 时先排查采集，没有成功发送时再排查队列/接收端。

可在实际应用使用的本地 SQLite 中执行以下只读查询，分别替换会话 ID 或 toolCallId：

```sql
SELECT p.id AS part_id, p.message_id,
       json_extract(p.data, '$.callID') AS tool_call_id,
       json_extract(p.data, '$.state.status') AS tool_status,
       json_extract(p.data, '$.state.input') AS tool_input,
       json_extract(p.data, '$.state.error') AS tool_error,
       json_extract(p.data, '$.state.metadata.exit') AS exit_code,
       json_extract(p.data, '$.state.metadata.artifactScript') AS script_facts,
       r.state AS receipt_state, r.reason AS receipt_reason
FROM part p
LEFT JOIN insight_artifact_delivery_receipt r ON r.part_id = p.id
WHERE p.session_id = '<sessionId>'
  AND json_extract(p.data, '$.tool') = 'bash'
ORDER BY p.time_created;

SELECT id, name, state, attempts, reason, part_id
FROM insight_artifact_delivery_event
WHERE json_extract(json_extract(payload, '$.datas[0].extend'), '$.toolCallId') = '<toolCallId>'
ORDER BY created_at;
```

这些检查无需再次执行用户的写入命令。模型叙述、文件当前存在和后续回读，都不能替代首次写盘调用的记录。

本次定向复核运行了 `bun test test/tracking/scripts.test.ts test/tracking/delivery.test.ts --test-name-pattern 'real Shell declarations|declared outputs create|undeclared, outside' --timeout 30000`，3 项通过。覆盖正确声明后的真实 Shell 执行与持久化、上传文件字节修改、无变化和漏声明/越界等情况；未取得用户失败机器上的原始记录，没有宣称复现或修复了这四次具体漏报。

## 合入 dev 的 PR 标题与正文草稿（按当前证据）

### 标题

feat(insight): 将产物打点迁移至服务端并接入 Shell 显式目标核验

### 正文

Insight 产物事件原先依赖页面消费工具结果，会话切换可能影响采集。本次将 write/edit/MCP 产物事实采集移至服务端工具完成回调，持久化后由独立队列发送，保留 `artifact-file-write`、`artifact-file-edit`、`artifact-mcp-return` 三个事件名。

主要改动：

- 保存原账号、会话和轮次归属，复用完成结果重放、发送租约、失败重试及确定性 eventId；移除页面对这三个事件的重复发送。
- 异步 MCP 在用户查询并取得有效产物后上报，保留原任务归属，不主动轮询。
- 已登记 Insight 轮次及子任务的 Shell 必须传 `artifactFiles`，模型 schema 和服务端执行前校验共同约束；只读/无交付物显式传 []，其他产品仍可省略。对声明的原会话 uploads/outputs 目标采集执行前后快照；成功退出且新增/字节变化时，分别映射 write/edit，source=script。与已登记的直接 write/edit 共用同文件锁。
- 桌面构建把上报地址传给 sidecar；诊断区分采集未生成事件与发送失败。

验证情况：

- 用户已确认直接 write/edit、MCP return、DOCX 生成/编辑打点成功，并最新明确 PDF/XLSX 没有问题。
- 三条 TXT Shell 原始调用均为 exit=0，但 input 缺少 artifactFiles，采集诊断为 script-targets-not-declared。问题已定位到目标声明缺失；现已增加模型 schema 必填和服务端执行前检查，等待新包端上复验。
- 2026-09-22 自动化记录：140 项通过、1 项既有跳过，opencode 类型检查通过；包括真实 PowerShell、文件核验、队列恢复与去重。该记录不等于当前所有端上问题已经修复。

已知限制及评审重点：

- 已登记 Insight 调用完全漏传 artifactFiles 时，命令执行前报错，文件不会被该调用改写；填空列表或漏列部分实际目标仍可能漏报，不能靠完成后的只读检查补回首次快照。
- 反复追加或覆盖来补打点会改变用户文件，不能作为补救方法。
- 文件字节变化不证明 Office/PDF 内容有效；进程外并发写入、后台导出、未声明目标等仍有覆盖边界。
- TXT Shell 完全漏传 artifactFiles 已增加执行前保护，自动化验证通过；尚需使用新包复验模型补齐参数后的完整流程。PDF/XLSX 已经用户确认正常。当前 PR 不应宣称所有脚本写入路径已全面覆盖。

关联验证记录：octo-agent 文档仓 `docs/insight-artifact-tracking-verification-2026-09-23.md`。

## 原始 tool part 补证：三次 TXT 写入漏声明（2026-09-23）

证据来自用户本次附件 `055f7a13-dab9-4360-b90c-4b7478cb4ce8/已粘贴的文本.txt`。其中包含三条不同写入调用的完整 completed part，现可确认这三个样本的漏报发生于采集阶段。

| 操作 | part ID | 实际结果 |
| --- | --- | --- |
| Set-Content 创建 123.txt，内容 abc | prt_0cd3b556b0019YEOigxV41YqJ1 | exit=0；input 未包含 artifactFiles；script-targets-not-declared |
| Add-Content 在 uploads 内 TXT 末尾追加 7890 | prt_0cd3d3a56001ycWNbo3TmaVMig | exit=0；input 未包含 artifactFiles；script-targets-not-declared |
| Set-Content 将 123.txt 改为随机内容 | prt_0cd3fb64b0019DuUSX07iUzTV5 | exit=0；input 未包含 artifactFiles；script-targets-not-declared |

三条记录均包含如下采集结果：

```json
{"version":1,"reason":"script-targets-not-declared","files":[]}
```

因此，这三次不是发送队列报错：服务端已运行 Shell 采集逻辑，但因目标列表为空，没有做文件前后快照，也没有生成可发送的产物事件。目标路径是否还存在其他问题未进入本次核验，不作推断。当前仅靠提示词要求模型填可选参数，无法保证写入被采集，这是本次已确认的覆盖缺口。

日志多次出现相同的 sample/part ID，是前端重复打印同一记录，不能当成重复执行命令的证据。`none-found-but-candidates-present` 是 resource-link 检测日志，不是 Shell 事件发送失败的原因。第三组较早的 sample 仍是第一组创建记录；结尾的新 part 才是随机编辑调用，本结论按不同 part ID 区分。

用户随后明确 PDF/XLSX 没有问题，已从待排查范围移除。本节结论限定于这三条 TXT 调用。不能凭执行后的文件内容补回执行前快照；禁止为补打点再次追加、覆盖或重置文件。

本次仅补充诊断文档，不将问题标记为已修复。之前定向测试传入了正确声明，证明的是声明完整时的采集能力，不证明实际模型会稳定传入声明。

## 修复进展：Insight Shell 执行前声明检查（2026-09-23）

本节更新前文首次排查和补证阶段的状态。修复位于 UXAI 当前工作分支 `codex/insight-script-artifacts`，未自动提交或推送。

- 对已持久化登记的 Insight 轮次（包括继承归属的子任务），提供给模型的 Shell JSON Schema 将 artifactFiles 标为 required。
- 服务端在权限请求、进程启动和文件写入前再次检查；完全漏传时明确报错，说明本次命令尚未执行，模型可补齐参数后重试该未执行调用。
- 只读或无最终交付物显式传 []，不生成事件，诊断为 script-no-targets；非 Insight 调用维持参数可省略的行为。
- 提示词禁止为了补打点重复已经完成的追加/覆盖/重置。旧记录缺少写前快照，不伪造历史事件。
- 边界：本次防止参数完全缺失。空列表误用于写入、漏列目标、错误路径仍不能靠必填检查识别；不声称任意脚本写盘全部覆盖。

验证：新增真实 Shell 回归覆盖 Set-Content 创建、Add-Content 追加上传文件、变量内容覆盖，检查拒绝后文件仍保持原状；补齐参数后产生预期的一条 write 和两条 edit，7890 只追加一次。另覆盖只读空列表、子任务继承检查、非 Insight 调用兼容。

第一轮采集/发送测试 24 项通过；随后增加子任务断言及 script-no-targets 诊断，定向复验 3 项通过。本次未打包或执行用户端真实文件任务，需重新构建安装包后复验。

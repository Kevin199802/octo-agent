# 文件卡片只渲染"本轮工具返回"——查询结果必须每次无条件重调工具

> 2026-06-13 · 来源:insight bug #54(重复查询任务进度,回答说"详见下方文件卡片"但下方空白)

## 现象

任务完成后,用户第一次问"查询任务 X 的进度",`get_task_result` 返回 completed + N 个 `resource_link`,回答下方正常出文件卡片。**紧接着再问一遍同样的问题**,回答仍以"您可以直接下载下方文件卡片中的报告查看详情"结尾,但下方什么都没有。换模型后必现/消失不定。

## 机制

1. **客户端三条出卡路径全部以"本轮 assistant message 的 parts"为输入**(insight-turn.tsx `outputCards` memo:路径 A 扫 resource_link、路径 B 嗅探 text、任务卡按 task_id 聚合)。某轮没有 tool part,该轮就没有任何可渲染的产物——这是设计而非 bug。
2. **模型是否重新调用工具是自由行为**:上下文里已有该任务的完成结果时,部分模型选择凭记忆直接作答("完整结果如上条消息所示"),不再发起 `get_task_result` 调用。调不调工具因模型而异,所以"切个模型就复现/消失"。
3. **prompt 话术却是无条件的**:`octo_insight.txt` 原本规定结尾"默认加一句'详见下方文件卡片'",于是"嘴上有卡、界面没卡"。

诊断实证:出问题的那轮 console 没有新的 `[octo:assistant] tool-part-detail` 日志(= 本轮零工具调用);正常出卡的轮次有,且伴随 `[octo:card] resource_links (no task)`。

## 教训

- **凡是"由当轮工具返回驱动渲染"的 UI,模型必须每次都真的重新触发那次工具调用**,不能凭上下文记忆作答——否则当轮无 tool part,UI 就空白。
- 两种修法的取舍(一度走过弯路):
  - ❌ **话术条件化**(第一版):只在本轮返回带 `resource_link` 时才说"详见下方文件卡片",否则闭嘴。问题:给了模型"不调工具、也不提卡片"的偷懒出口,且经过十几轮对话,真正带卡的旧消息早滚到很上面,用户还得上滚翻找。
  - ✅ **无条件重查**(最终版):用户每次提及查询进度/索取结果,**无条件重新调用一次 `get_task_result`**,把最新结果的文件卡片就近挂在**当前这条回答正下方**。绝不凭记忆作答、绝不指引用户去看上面的旧卡片。
- 最终修复(UXAI `packages/opencode/src/agent/prompt/octo_insight.{txt,md}`,两份需同步):
  1. 工作流程第 3 步:用户每次查询进度都**无条件重新调用** `get_task_result`,哪怕十几轮前已查到 completed 也要重调;
  2. 结尾话术:既然每次都重调 → 本轮必带 `resource_link` → 直接说"详见下方文件卡片"(卡片就在正下方);仅 `pending`/`processing`/`failed`/`stopped` 例外,并显式堵掉"靠不调工具回避"的出口。
- 任务卡按 task_id 去重、锚定在最早轮次(task-card.md §3.3),重复查询不会在新轮次下面长出**任务卡**;但新轮次能出**路径 A 的文件卡**——前提就是本轮真的重调了工具。这正是"无条件重查"能让卡片就近呈现的机制依据。

## 关联

- 日志字典:`docs/insight-debugging.md`(`[octo:assistant]` / `[octo:card]` / `[octo:task-detect]`)
- 上游另有一个独立问题:opencode MCP 结果包装层(session/prompt.ts)丢弃 `resource_link` content 项且不透传 `structuredContent`,任务卡 defensive 分支因此可能全空 —— 见 bug #44 排查,待提上游补丁。

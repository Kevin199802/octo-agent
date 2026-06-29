# SPEC — insight 图片附件：从「工具输入 handle」到「模型可见 vision」

> 状态：草案 · 优先级 P2 · 规模 [S~M] · 领域 ui/insight
>
> 上游已实现：✓ 粘贴/选取/拖拽图片 → 走 insight 自有上传链路（S3 + handle 块）；✓ 上传白名单已含 png/jpg/jpeg/gif/webp（PR#235）。✗ 让多模态模型**直接看到**图片（vision FilePart）。依赖 [ADR-015](../adr/015-file-passing-architecture.md)。

---

## 0. 现状（PR#235 合入后，已核实代码）

insight **不走**上游 chat 的 base64 路径（那是 [components/prompt-input/attachments.ts](../../../packages/app/octoapp/components/prompt-input/attachments.ts) 的 `dataUrl` 方案）。insight 自有一套：

```
粘贴/选图 → handlePaste → addAttachments → doUpload(S3) → 选文件即 eager 上传拿 url
发送 → formatUploadsForPrompt 把所有 done 附件(含图片)拼进 [已上传文件] synthetic 文本块(handle→url)
```

- 图片和其他文件**走同一条**：S3 上传 → handle 块（模式 C，**工具输入**）。
- `ALLOWED_EXT` 已含图片（[lib/upload.ts:19](../../../packages/app/octoapp/pages/insight/lib/upload.ts#L19)）；服务端 analyze_interview 白名单暂不含图片（前端先放、后端跟进，见该文件注释）。

> 所以「insight 图片要从 base64 改成 S3」是个**伪命题**——insight 早就是 S3。base64 只存在于上游 chat。本 spec 真正要解决的是下面这个 gap。

---

## 1. 真正的 gap

图片进了 `[已上传文件]` handle 文本块 ⇒ 模型看到的是一个 **handle token（文本）**,只有当模型**调用工具**、且 [octo-upload-inject] 把 handle 换成 url 时,那个 url 才被工具消费。

**后果**:多模态模型**无法直接"看"这张图**——它不是 vision 内容,是给工具的引用。用户「粘贴截图问模型这是什么」的诉求满足不了(除非有个接受图片 url 的工具)。

---

## 2. 目标

让图片能按需走**模式 B（vision）**:作为 image `FilePart{url: S3 url}` 进 user 消息,opencode/AI SDK 交多模态模型的 vision 通道。

```
图片附件(已 S3 上传拿 url)
  → 发送时额外产出 FilePart{ type:"file", mime:image/*, url: S3 url, filename }
  → 多模态模型:厂商服务器拉 url 看图(不 base64,见 ADR-015 决策 2)
  → 非多模态模型:opencode stripMedia 换占位(不影响)
```

| 点 | 方案 |
|---|---|
| 载体 | 原生 `FilePart{url: S3 url}`（**不 base64**，复用已上传的 url） |
| 与 handle 块关系 | **已定(2026-06-29)**:图片当前**只给模型看(vision)**,故**改走 FilePart、从 handle 块剔除**;handle 块只留给 MCP 工具用的文件。将来若有「图片给 MCP 工具」的场景再加回(那时一份文件可能两条都发) |
| 上传时点 | 仍是今天 eager(图片是模型上下文,发送时必须就位);未来与 [INS-015 按需上传](../infra/insight-mcp-lazy-upload.md) 协调时,图片走「发送时上传」、MCP 文件走「工具调用时上传」 |

---

## 3. 关键前提 / 待澄清

1. **provider↔S3 可达**:多模态模型的 provider 服务器要能 GET 到 S3 url。内网模型↔内网 S3 通则可行;够不到时退回 base64 / Files API（[ADR-015 决策 2](../adr/015-file-passing-architecture.md)）。
2. **模型多模态能力**:非多模态模型收图无意义(最终 strip)。可按 model 能力决定「图片走 FilePart vs 不发」,避免无谓上传——待定本期是否做。
3. ~~图片到底要不要进 handle 块~~ **已定**:图片只给模型看 → 只走 vision FilePart、从 handle 块剔除(见 §2)。

---

## 4. 不做

- 与 [SPEC-INS-014](../infra/insight-worktree-layout.md)（sources/outputs）、[INS-015 MCP 按需上传](../infra/insight-mcp-lazy-upload.md) 解耦。
- 上游 chat 的 base64 路径不动(那是另一条线)。

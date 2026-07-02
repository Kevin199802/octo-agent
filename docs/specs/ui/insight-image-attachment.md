# SPEC — insight 图片附件（粘贴 / 剪贴板交互补充）

> 状态：已实现（随 [SPEC-INS-015 文件传参机制](../infra/insight-file-passing.md) A1）· 领域 ui/insight
>
> **图片的传参规则（change 即传 S3 → 缩略图 → 发送走 vision `FilePart{url}`）以 [SPEC-INS-015 §1③ / §4](../infra/insight-file-passing.md) 为唯一真相源。** 本 spec 只补充「图片进输入框的交互入口」，不重复规则。

---

## 0. 图片规则（已在 file-passing 落地，这里只指路）

按 [ADR-015](../../adr/015-file-passing-architecture.md) 四分支的 ③：图片是给多模态模型**看**的，不参与本地读 / MCP。

- **change 即传**：选取 / 拖拽 / 粘贴当下就异步上传 S3（业界通行；图片必上传，无"是否调 MCP"的不确定）。
- **缩略图**：`URL.createObjectURL(file)` 本地秒显，不等上传。
- **发送**：产出 `FilePart{ type:"file", mime:image/*, url:S3, filename }` 走 vision；非多模态模型由 opencode `stripMedia` 自动换占位。
- **不进 `[附件]` 清单**（那是给 ②extract / ④MCP 的非图片文件）。

## 1. 交互入口（本 spec 负责的部分）

图片与其它附件共用 insight 的 `addAttachments`（[index.tsx](../../../packages/app/octoapp/pages/insight/index.tsx)），三个入口：

| 入口 | 说明 |
|---|---|
| 上传按钮 / 文件选择器 | 与非图片一致；按扩展名(png/jpg/jpeg/gif/webp)判定走图片分支 |
| 拖拽 | 仅收 OS 外部文件拖入（带 `text/uri-list` 的页面元素 / 网页图拖动一律拒收，避免误收） |
| **粘贴** | 截获剪贴板 file item 走同一附件链路；桌面端无浏览器剪贴板图时回退平台原生剪贴板读图 |

规则对三个入口**一致**：图片一律直接触发 S3 上传（无 URL 模型理解不了图）。粘贴只是又一个把 File 喂进 `addAttachments` 的入口，不改规则。

## 2. 前提

- provider 能 GET 到该 S3 url（内网模型 ↔ 内网 S3 通即可）；将来接公网模型够不到内网 S3 时，那条 case 退回 base64 / Files API（[ADR-015 决策 2](../../adr/015-file-passing-architecture.md)），不动骨架。
- 上传白名单含图片（png/jpg/jpeg/gif/webp，PR#235）。

## 3. 不做

- 与 [SPEC-INS-014](../infra/insight-worktree-layout.md)（sources/outputs）解耦。
- 上游 chat 的 base64 路径不动（那是另一条线）。

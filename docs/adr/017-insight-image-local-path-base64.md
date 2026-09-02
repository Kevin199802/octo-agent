# ADR-017: insight 图片改走本地路径 + 服务端读盘转 base64（去 S3）

## 状态

已采纳（2026-09-02）· **已落地**：UXAI [PR #754](https://github.com/MyHeavenDyf/UXAI/pull/754) 已合入 dev（merge commit `993e64bae`，2026-09-02）· 内网验证待做（见下方「代价 / 依赖」里那条未决的 5MB 口径）

**推翻 [ADR-015](015-file-passing-architecture.md) 决策 2「有存储后端 → 图片走 S3 URL，不走 base64」在 insight 场景的适用性。** ADR-015 的分流骨架（决策 1、决策 3）与 MCP 按需上传（[ADR-014](014-url-injection-via-plugin.md)）**完全不变**；make 页图片仍走 S3，不受本 ADR 影响。

---

## 背景

ADR-015 决策 2 定的是：insight 图片在选中当下即传 S3（`uploadServer/api/files` 拿 url），发送时产出 `FilePart{url: https://s3...}`。

这条决策的理由在 2026-08-14 被修正过一次：原先写的「base64 会让 token 暴涨、任何上下文窗口都装不下」**是错的**（图片 base64 走 vision 解码通道，进 tokenizer 之前就被 decode 回字节，不占上下文窗口——详见 [learning/file-passing-to-models.md §2](../learning/file-passing-to-models.md)）。修正后保留结论，理由改成工程侧的三条，其中主因是：

> **跨进程边界**：图片在 Electron 客户端手里，provider 在服务端，字节无论如何都要先搬到 provider 够得到的地方。

**这条主因在 insight 的实际部署形态下不成立。**

---

## 关键事实：opencode server 是本地 sidecar

insight 的 opencode server 不是远端服务，是 Electron 主进程拉起的**本机 sidecar 进程**，与渲染进程共享同一个文件系统。

于是「字节要搬到 provider 够得到的地方」这个前提被拆成了两段，而第一段是空操作：

| 环节 | S3 方案 | 本地路径方案 |
|---|---|---|
| 客户端 → server | HTTP 上传到 S3（跨网络） | **同机文件系统，server 直接 `readFile`** |
| server → provider | server 发 S3 url，provider 回头拉 | server 发 base64，随请求一起走 |

真正的跨进程边界只在 server↔provider 那一段，而那一段无论如何都要发字节或发一个 provider 够得到的 URL——内网 S3 恰好够得到，所以两条都能跑。但**客户端到 server 这一跳根本不需要第三方存储**：图片已经在磁盘上，server 就在同一块磁盘上。

再加上 learning §2 已经澄清的那条：**base64 与 URL 进模型的 image token 完全相同**（只由分辨率决定），所以这个选择在模型效果上是零差异的，纯粹是工程题。

---

## 决策

insight 的图片附件与非图片附件**走同一条链路**：

1. 选中 / 拖拽 / 粘贴时导入 worktree（`.octo/tmps/`，发送时 rename 进 `.octo/<sessionId>/uploads/`），拿本地绝对路径——与 excel 等非图片附件同一套 `landingName` / 撞名规则
2. 发送时产出 `FilePart{url: file://<encodeFilePath(path)>}`，编码与 txt/md 内联同源
3. 服务端 `prompt.ts` 的 `resolvePart` 走既有的 `file:` 分支：非 `text/plain`、非目录的 `file://` **读盘转 `data:<mime>;base64,...` 落库**——这是 opencode 的**原生行为，服务端零改动**
4. 历史轮用落库的 `data:` URL，**不依赖本地文件存活**

剪贴板粘贴的图（截图）是内存 blob、`getPathForFile` 拿不到源路径，补一个字节版 IPC（`write-file-to-worktree`）把 ArrayBuffer 写进同一落点，规则与 `copy-file-to-worktree` 同源。

**图片仍然不进 `[附件]` 清单、不占内联预算**——分流骨架（ADR-015 决策 1）原样保留，`isTextInlineFile` / `decideInlineStrategy` 一行未动。

---

## 为什么这样更好

- **去掉图片链路对内网上传服务的硬依赖**。原来是「选中即传」，上传服务不可用时图片压根加不进来；现在只碰本地磁盘，无网络依赖，失败可重试。这与 ADR-015 决策 1 当初「自由消息不该被 S3 阻断」是同一条理由，只是当年没延伸到图片。
- **删掉一整条平行分支**。原来图片有独立的 `doImageUpload` / S3 重试 / optimistic 镜像，与非图片的导入链路两套并行；现在收敛成一条，重试、搬迁、降级都只有一份逻辑。
- **ADR-015 决策 2 列的另外两条理由（请求体不膨胀、发送方零内存）依然成立，但代价方转移了**——base64 现在发生在 sidecar 进程，不在渲染进程，客户端不再持有膨胀后的字符串。

---

## 后果

**正面**：见上一节。

**代价 / 依赖**（前三条是本 ADR 相对 ADR-015 的**净新增风险**，必须记住）：

- **base64 落进 message part 存储**，每张图 ×1.33 常驻会话，历史轮反复加载，前端还要拿 data: URL 当 `img src`。**所以图片必须有大小上限**——原 S3 链路存一个 url，没有这个约束；新链路下它是必需的。
  - **落地形态**：`INSIGHT_IMAGE_MAX = 5MB`，加在 insight 的两个附件入口（`addAttachments` / `addInsightFileToSession`）**调用点**，不进共用的 `validateFile` / `uploadFile`——那两个函数 make 页也在用，make 走 S3 没有这个约束，加进去会误伤。这个「约束属于载体、不属于文件校验」的分界值得记住：同一个「图片太大」判断，在 base64 链路成立、在 S3 链路不成立，所以它的归属是链路而非通用校验器。
  - **未决**：5MB 拦的是**原始文件字节**，而送到 provider 的是 base64 后的数据（×1.33）。若内网 provider 的单图上限按 base64 后大小算（Anthropic 即此口径），4.9MB 的图仍会被拒。内网验证时需确认口径，按 base64 算则阈值应降到 ≈3.7MB。
- **依赖 server 与客户端同机（本地 sidecar）**。这是本 ADR 成立的根基。insight 现有的 `[附件]` 清单、`extract_document` 本来就吃这个假设，所以现状一致；但一旦 server 出现远程部署形态，图片链路会静默断（读不到文件）。已在 [SPEC-INS-015 §4](../specs/infra/insight-file-passing.md) 写成显式前提（PR #754 描述的「已知限制」同步列出），不留作隐含依赖。
- **每张图会多一条 synthetic text 进模型上下文**：`prompt.ts` 在 base64 part 之前插一条 `Called the Read tool with the following input: {"filePath":"…"}`，把本地绝对路径喂给模型（UI 不渲染 synthetic，气泡上看不见）。原 S3 链路没有这条。
- **web 形态图片附件不可用**：新链路依赖 Electron IPC，纯浏览器环境无此能力，图片会标 error。旧 S3 链路在 web 下理论可用，**这是一个已知功能回退**——判定可接受的依据是 insight 的产品形态就是桌面端（octoapp 打包进 Electron），web 仅有 `__dev` 调试场景。
- `.octo/tmps/` 的残留文件（选了不发 / 校验失败）族群变大，属既有问题，未在此解。

**不变**：MCP 按需上传（`octo-upload-inject`，`DOC_EXT_RE` 本就不含图片扩展名）、非图片附件的全部行为、make 页的 S3 图片链路。

---

## 什么情况下要回到 S3

本 ADR 的成立条件是「server 与客户端同机」。以下任一成立就要重新评估：

- opencode server 改为远程部署 / 多机形态 → 服务端读不到客户端的本地路径，整条链路失效
- 图片体量需求突破 base64 的合理区间（provider 单图上限、会话存储膨胀），且大小上限压不住

届时按 ADR-015 决策 2 的原方案回退即可——**分流骨架不动，只换图片那一格的载体**，这正是 ADR-015 当初把「载体」和「分流」分开设计的价值。

---

## 关联

- [ADR-015](015-file-passing-architecture.md)（本 ADR 推翻其决策 2 在 insight 场景的适用；决策 1/3 不变）
- [ADR-014](014-url-injection-via-plugin.md)（MCP 按需上传，不受影响）
- [ADR-006](006-upload-architecture.md)（上传架构）
- [learning/file-passing-to-models.md](../learning/file-passing-to-models.md)（§2「图片的 base64 不进 token」——本 ADR 得以成立的认知前提）
- [SPEC-INS-015](../specs/infra/insight-file-passing.md)（文件传参机制，需补「本地 sidecar 同机」前提与图片上限）
- [SPEC-INS-014](../specs/infra/insight-worktree-layout.md)（worktree 布局：`.octo/tmps` / `.octo/<sid>/uploads`）

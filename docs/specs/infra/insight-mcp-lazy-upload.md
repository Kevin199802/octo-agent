# SPEC-INS-015 — MCP 文件按需上传（plugin on-demand S3）

> 状态：草案 · 优先级 P1 · 规模 [M] · 领域 infra/insight/mcp
>
> 上游已实现：✗。依赖：[SPEC-INS-014](insight-worktree-layout.md)（sources 本地落地，已实现客户端地基）、[ADR-015](../adr/015-file-passing-architecture.md)（分流）、[ADR-014](../adr/014-url-injection-via-plugin.md)（handle 注入，本 spec 改其上传时机）。

---

## 0. 解决什么

把 S3 上传从「选文件 / 发送时」下沉到「**模型真正调用 MCP/UXR 工具时**」。兑现 [ADR-015] 的模式 C 与用户诉求：**触发 MCP → 才触发 S3,否则文件只在本地**。自由消息发本地模型零上传、不阻断。

**当前（INS-014 收尾后）的临时态**：仍是今天的 eager 上传（选文件即传 + `[已上传文件]` 块 `handle→url`),MCP 照常工作。本 spec 把它改成按需。

---

## 1. 现状链路（eager，ADR-014 原始设计）

```
选文件 → S3 上传拿 url → 发送时注入 [已上传文件] 块(handle→真实url)
  → 模型把 handle 填进 MCP 工具 args
  → octo-upload-inject 在 tool.execute.before 把 handle 换成 url
  → MCP 工具用 url 拉 S3
```

**痛点**：上传与「是否用 MCP」解耦失败——没调 MCP 也上传了。

---

## 2. 目标链路（on-demand）

```
选文件 → 拷进 insight/sources(SPEC-INS-014,已实现) ※不上传
发送 → 注入 [本地文件] 块(handle→本地 sources 路径)   ※仍不上传
  → 模型把 handle 填进 MCP 工具 args(行为同今天,模型只见 handle)
  → octo-upload-inject 命中 MCP 工具 + args 含该 handle:
        读 sources 本地文件 → POST S3 拿 url → 把 handle 换成 url(就地)
        缓存「本地路径→url」,同会话多次调用不重复传
  → MCP 工具用 url 拉 S3
```

关键：**上传发生在插件里、工具执行前的那一刻**——只有模型真调 MCP 才会跑到。自由消息不调 MCP → 永不上传。

---

## 3. 设计要点 / 待定

| 点 | 方案 | 备注 |
|---|---|---|
| handle 映射目标 | `handle → 本地绝对路径`(原为 url) | 块名可由 `[已上传文件]` 改 `[本地文件]`,与 parseUploadBlock 同步 |
| 上传发起方 | **server 端插件**(octo-upload-inject,opencode sidecar 进程) | 插件能读本机文件、能 POST;endpoint 已有(见 §4),只需以 `OCTO_UPLOAD_ENDPOINT` 注入 sidecar |
| 幂等 | 插件内缓存 `本地路径→url`(本进程/本会话) | 同文件多轮多次调用只传一次 |
| 失败 | 上传失败 → 工具调用失败,错误回灌模型(让其重试/换路) | 与今天「取不到文件 404」相比更早暴露 |
| handle 派生 | 仍按文件 url/路径派生稳定 token(见 lib/upload.ts uploadHandle) | 改成按本地路径派生(路径稳定) |
| 跨边界 | **不改 MCP 工具契约**;只改我们自家插件的「何时上传 + 映射目标」 | 与 MCP 团队解耦不变 |

---

## 4. endpoint 现状(非阻塞,澄清用)

- 上传服务**后端早已提供**(beta + prod),地址配在**内网** `.env`(外网仓库无),见 [file-upload.md §端点](file-upload.md)。前端走 `VITE_OCTO_UPLOAD_ENDPOINT`(Vite build-time,只进渲染器 bundle)。
- 唯一新增:`VITE_*` 前缀**只有渲染进程读得到**;插件在 opencode **sidecar 进程**(另一个 bun 进程)发上传,读的是 `process.env.OCTO_*`。故把**同一个地址**再以 `OCTO_UPLOAD_ENDPOINT` 注入 sidecar 即可——**完全照 `OCTO_UXR_MCP_URL` 的现成模式**([builtin-mcp.ts](../../../packages/opencode/src/config/builtin-mcp.ts))。同机内网,可达性与今天前端上传一致,无新网络问题。

## 4.1 待澄清(实现前确认)

- **handle 块何时注入**:文件拷进 sources 后,发送时即注入 `[本地文件]` 块(无论是否预置)——块只是「可用文件清单 + handle」,不触发任何上传;真触发在插件。

---

## 5. 验证

| # | 操作 | 期望 |
|---|---|---|
| 1 | 选文件 + 发自由消息(不调 MCP) | **无任何 S3 上传**(Network 无 POST);消息正常发出 |
| 2 | 选文件 + 走预置 → 模型调 UXR 工具 | 工具执行前插件才上传(`[octo:inject] lazy-upload`);MCP 拿到 url、正常出结果 |
| 3 | 同会话多次调用同文件 | 只上传一次(插件缓存命中) |
| 4 | 上传服务不可用 | 工具调用失败、错误回灌模型;**不影响**纯本地/自由消息 |

---

## 6. 不做

- office→文本抽取(Spec B)、图片传参([图片附件 spec](../ui/insight-image-attachment.md))——各自独立。
- 让自由词也能触发 MCP 的产品策略(与本 spec 无关;本 spec 下自由词不调 MCP 即不上传,调了就上传)。

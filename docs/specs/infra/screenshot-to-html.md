# Spec: 设计稿截图 → HTML 生成服务（内网 web + Java 后台）

> 状态：草案（待内网网关能力验证后定 §3 配置值）· 领域 infra · 非 insight 专属，不占 `SPEC-INS-NNN` 号段
>
> **上游已实现：✗**（这是内网自建服务，不涉及 opencode 上游能力）
>
> 关联：[ADR-006 上传架构](../../adr/006-upload-architecture.md)、[ADR-015 文件传参架构](../../adr/015-file-passing-architecture.md)、[file-upload.md](file-upload.md)、[learning/file-passing-to-models.md](../../learning/file-passing-to-models.md)

---

## 1. 场景与边界

内网 web 应用上，用户从设计稿生成截图 → 触发任务 → 内网多模态模型把截图还原成 HTML 代码段。任务在**空闲时段批量执行**（非实时交互）。

| 角色 | 归属 | 职责 |
|---|---|---|
| web 前端 | 内网 web 团队 | 生成截图、调上传服务拿 url、调本服务接口下单 |
| 截图→HTML 服务 | 内网开发团队（Java） | 任务入队、空闲时段 drain、调模型网关、存结果 |
| 上传服务 | agent 项目 + 内网开发团队 | 已存在，见 [file-upload.md](file-upload.md) |
| 模型网关 | 内网 AI 平台 | OpenAI 兼容 `/v1/chat/completions`（待确认，见 §4） |

**不做**：不新建第二套对象存储 / 上传通道（复用现有上传服务）；不做实时同步生成；不做 HTML 的视觉回归比对。

---

## 2. 核心决策：接口契约与喂模型形态解耦

这是本 spec 最重要的一条，先立在前面。

```
web 前端 ──上传──> 上传服务 ──> url
   │
   └── POST /screenshot2html/tasks { imageUrl, ... } ──> Java 服务    ← 契约层：永远传 url
                                                            │
                                              ┌─────────────┴─────────────┐
                                        mode = URL                  mode = DATA_URI
                                        原样转发 url              服务端 GET 该 url
                                                                  拿字节 → base64
                                              └─────────────┬─────────────┘
                                                            ↓
                                                       内网模型网关
```

### 2.1 前端 → 本服务：一律传 url，不传 base64

- 前端已经为了展示/留档把截图传过上传服务了，url 是现成的，**不存在"为了传参而多一次上传"**
- 让前端传 base64 只会让 body 膨胀 33% 且前端要多读一次文件，无任何收益
- 契约稳定：后续无论喂模型形态怎么变，前端不改

### 2.2 本服务 → 模型网关：形态是**内部实现**，配置项切换

`imageMode` 是部署期配置，取值由 §4 的验证结果一次性定死。

**不做运行时自动探测 / 失败自动降级**：网关不支持 URL 是配置事实，不是偶发故障；自动降级会把"配置错了"伪装成"偶尔慢一点"，等到批量跑完才发现半数任务走了非预期路径。按确定性优先原则——要么配置明确，要么响亮失败。

---

## 3. 业界基线与两种形态的取舍

### 3.1 把图片喂给多模态模型只有三种来源

厂商（Anthropic / OpenAI / 阿里云百炼）**三种都支持**，没有哪种是"唯一标准"，业界按场景选：

| 来源 | 典型使用方 | 成立前提 |
|---|---|---|
| inline base64 / data URI | 无存储后端的本地工具（opencode 自身即是） | 图小、单次请求、无需复投 |
| 远程 URL（服务端去拉） | 有存储后端的产品 | **模型服务能 GET 到该 URL** |
| Files API `file_id` | 同批图在多轮/多任务反复复用 | 厂商提供 Files API（内网自建模型基本没有） |

> agent 客户端侧选 URL（[ADR-015 决策 2](../../adr/015-file-passing-architecture.md)）的根本原因是**跨进程边界**：图片在 Electron 客户端手里，必须先搬到 provider 够得到的地方。本服务是服务端场景，那条理由不成立，取舍要重算——见下表。

### 3.1.1 ⚠️ 先破除一个常见误解：base64 **不占上下文窗口、不影响模型效果**

这是选型时最容易搞错的一点，直接决定了下面对比表该怎么读。

**图片的 base64 字符串不会进 tokenizer。** 处理路径是：请求体里的 data URI → HTTP 层 decode 回图片字节 → vision encoder 切 patch → 一组固定数量的 **image token**。base64 那串字符在到达 tokenizer 之前就已经被消费掉了。

因此：

| 常见说法 | 是否成立 |
|---|---|
| 「几十 KB 的图 base64 后十几万字符，模型吃不下」 | ❌ 不成立。那十几万字符不进上下文 |
| 「同一张图，base64 比 URL 更费 token」 | ❌ 不成立。**image token 数只由图片分辨率决定**，与传输形态完全无关 |
| 「用 base64 会让本来 URL 能跑出来的结果跑不出来」 | ❌ 不成立。两条路喂给 vision encoder 的是同一份字节 |
| 「把 base64 拼进 text part（当正文）会 token 爆炸」 | ✅ 成立 —— 但那是误用，正确做法是放进 `image_url` 媒体字段 |

token 量级参考（只看分辨率）：Anthropic 口径 ≈ `w×h/750`，1024×1024 约 1400 token；OpenAI 按 512×512 分块计。**两种传参方式下这个数字一模一样。**

> **结论：选 URL 还是 base64 是一道工程题，不是模型能力题。** §3.2 的对比表里没有任何一项是"模型侧损失"——全部是传输与发送方的工程代价。所以 §4 验证若判定网关不支持 URL，切 `DATA_URI` 在生成质量上**零损失**，不需要为此纠结或向上申请放开网关。
>
> 唯一可能造成结果差异的间接因素见 [§3.4](#34-两种模式下唯一真实的结果差异源)。

### 3.2 URL vs base64 完整对比（服务端调用场景）

| 维度 | URL | base64 / data URI |
|---|---|---|
| 请求体大小 | 几百字节 | 原图 × 1.33 |
| **服务端内存峰值** | **零**（不读字节） | **原图 × 4~5**（`byte[]` + Base64 `String` + JSON 序列化 + HTTP 缓冲区），批处理并发下是主要 OOM 源 |
| 网关 body 限制 | 无压力 | nginx `client_max_body_size` 默认 1m，需全链路放开 |
| **日志 / 链路追踪** | 请求体可原样留档，出问题点开 url 就看到当时的输入 | 留档 = 几 MB 垃圾，现实中只能关掉 → **坏结果无法复现输入** |
| 失败重试 | url 原样重投 | 重新读盘 + 编码 |
| 网络跳数 | **多一跳且不在我们控制内**；该跳失败时网关常只回含糊 400，排障困难 | 零额外跳，错误全在自己进程内 |
| 时序耦合 | 图必须在模型拉取那一刻仍可访问；排队久 + 清理任务 = 404 | **请求自包含**，无此问题 |
| 外部依赖 | 存储服务可用 + 网关到该域名网络可达 | 无 |
| 安全评审 | 推理服务出网拉取 = SSRF 面，内网常被禁 | 无 |
| 多图 / 长图切片 | 线性，无压力 | 成倍膨胀（5 片 = 5 份 base64 在一个请求里） |

**结论**：本场景**优先 URL**（内存与排障留痕是决定性的，批处理规模下尤其），但 URL 并非无代价，若 §4 验证不通过，`DATA_URI` 是完全可接受的退路，不是降级方案——只需把并发数与 JVM 堆按 §3.3 重算。

### 3.3 选 `DATA_URI` 时的必配项

- 全链路（nginx / 网关 / 框架）body 上限 ≥ `maxImageBytes × 1.4 × 单请求图片数`
- 并发数 × 原图大小 × 5 ≤ 可用堆的安全水位
- HTTP 客户端启用流式写出（避免再多一份全量缓冲）
- 请求体日志显式**关闭或截断**，否则日志盘会被打满

### 3.4 两种模式下唯一真实的结果差异源

§3.1.1 说了模型侧零差异，但工程上有一个**间接**差异源，切换 `imageMode` 时必须对齐，否则会误判成"模型效果变了"：

**谁做的图片预处理不同。**

- `imageMode=URL`：网关下载图片后，按**它自己的规则**做缩放 / 格式转换
- `imageMode=DATA_URI`：我们在 §6.2 里先 `scaleToMaxEdge(maxEdgePx)` 再编码，用的是**我们的规则**

两边的缩放目标尺寸、插值算法、是否转格式如果不一致，**实际进 vision encoder 的图就不是同一张**，生成的 HTML 自然会有差异。这不是"base64 更差"，是预处理参数没对齐。

**处置**：切换模式后若观察到质量变化，先比对两种模式下实际送达模型的图片分辨率（`DATA_URI` 模式可直接落盘那份 base64 解码后的图检查；`URL` 模式需向 AI 平台确认其下载后的缩放策略），确认是同一尺寸后再谈效果。切模式时 §8.1 的 V7 必须重跑。

次要差异（都属于配置问题，不是效果问题）：网关对 URL 下载的大小上限与对请求体的上限通常不是同一个值；网关下载时可能自动处理 webp 等格式，而直传 data URI 时 mime 声明错会被直接拒。

---

## 4. 验证：网关吃不吃远程 URL（发给内网同学）

> **这一节是可独立交付物**，把 §4.2 脚本 + §4.1 说明发给内网同学即可执行，不需要读完整篇 spec。

### 4.1 为什么不能只测"通不通"

两个隐蔽陷阱，验证设计必须绕开：

1. **模型瞎编**。问"这是什么界面"，模型即使没看到图也能编出一段像样的描述，你会误判为通了。
   → 对策：图里放一个**随机 token**（如 `VERIFY-8F3A2C`），只问"图中的验证码字符串是什么"，答对才算真看到图。
2. **网关静默忽略图片**。有的网关对拉不到的图不报错，直接丢掉图片部分继续生成。
   → 对策：**哨兵用例 T3**——故意传一个不可达 URL，如果仍返回正常回答，说明网关根本没在拉图，T1 的"成功"是假的。

另有一条容易忽略的现场事实：内网常同时存在**统一 AI 网关**与**直连推理服务**两个地址，两者对 URL 的支持可能不同。请确认被测 endpoint 与生产实际调用的是同一个。

### 4.2 验证脚本（Python 3，仅用标准库）

```python
#!/usr/bin/env python3
# verify_gateway_image_url.py —— 内网模型网关远程 URL 图片支持验证
# 依赖：Python 3.7+ 标准库，无需 pip install
#
# 用法：
#   python3 verify_gateway_image_url.py \
#       --endpoint http://<网关>/v1/chat/completions \
#       --api-key  <key，没有就传 none> \
#       --model    <模型名> \
#       --image-url http://<上传服务>/octoAiServer/files/<uuid>.png \
#       --expect   VERIFY-8F3A2C
#
# --image-url 指向一张**图中印有 --expect 字符串**的截图（先用上传服务传上去）。
# 没有现成图时可用任意截图，把 --expect 换成图里确实存在、且不可能被猜到的文字。

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request

TIMEOUT = 120


def call_gateway(endpoint, api_key, model, image_field, question):
    """image_field 直接作为 image_url.url 的值：可以是 http(s) URL，也可以是 data URI。"""
    payload = {
        "model": model,
        "temperature": 0,
        "max_tokens": 256,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_field}},
                {"type": "text", "text": question},
            ],
        }],
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return True, body["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:800]}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def fetch_as_data_uri(url):
    with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
        raw = resp.read()
        mime = resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}", len(raw)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--endpoint", required=True)
    p.add_argument("--api-key", default="none")
    p.add_argument("--model", required=True)
    p.add_argument("--image-url", required=True)
    p.add_argument("--expect", required=True, help="图中印着的验证字符串")
    a = p.parse_args()

    q = f"图片里有一串验证码，请只输出那串验证码本身，不要任何其他文字。"
    results = {}

    # ── T2 对照组：data URI ──────────────────────────────
    # 先跑对照组。它失败说明模型/协议本身有问题，后面两个用例没有意义。
    print("=" * 60)
    print("[T2] data URI（对照组：确认模型本身能看图）")
    try:
        data_uri, nbytes = fetch_as_data_uri(a.image_url)
        print(f"     原图 {nbytes} 字节 → base64 {len(data_uri)} 字符 "
              f"(膨胀 {len(data_uri)/max(nbytes,1):.2f}x)")
        ok, out = call_gateway(a.endpoint, a.api_key, a.model, data_uri, q)
    except Exception as e:  # noqa: BLE001
        ok, out = False, f"取图失败（脚本机器到上传服务不通）: {e}"
    hit = ok and a.expect.lower() in str(out).lower()
    results["T2"] = hit
    print(f"     结果: {'✅ 认出验证码' if hit else '❌'} | 模型输出: {str(out)[:200]}")

    # ── T1 主用例：远程 URL ──────────────────────────────
    print("=" * 60)
    print("[T1] 远程 URL（主用例：网关是否会去拉图）")
    ok, out = call_gateway(a.endpoint, a.api_key, a.model, a.image_url, q)
    hit = ok and a.expect.lower() in str(out).lower()
    results["T1"] = hit
    print(f"     结果: {'✅ 认出验证码' if hit else '❌'} | 模型输出: {str(out)[:200]}")

    # ── T3 哨兵：不可达 URL ──────────────────────────────
    # T1 通过时必须跑：确认网关是真拉图，而不是忽略图片让模型瞎编。
    print("=" * 60)
    print("[T3] 不可达 URL 哨兵（期望：报错或明确说看不到图）")
    bad = "http://127.0.0.1:9/definitely-not-exists.png"
    ok, out = call_gateway(a.endpoint, a.api_key, a.model, bad, q)
    leaked = ok and a.expect.lower() in str(out).lower()
    results["T3_safe"] = not leaked
    print(f"     调用{'成功返回' if ok else '报错(符合预期)'} | 输出: {str(out)[:200]}")
    if leaked:
        print("     ⚠️ 严重：不可达 URL 也答对了验证码 —— 说明模型在瞎编或有缓存，T1 结论不可信")

    # ── 判定 ────────────────────────────────────────────
    print("=" * 60)
    print("结论：")
    if not results["T2"]:
        print("  ⛔ 对照组就没过。先排查：模型是否多模态 / 协议是否 OpenAI 兼容 /")
        print("     字段名是否为 image_url（有的网关用 image / images / content.image）。")
        print("     T1 结论无效。")
        sys.exit(2)
    if results["T1"] and results["T3_safe"]:
        print("  ✅ 网关支持远程 URL → 服务端配置 imageMode=URL")
    elif results["T1"] and not results["T3_safe"]:
        print("  ⚠️ T1 结果不可信（见 T3 告警）→ 按 imageMode=DATA_URI 保守处理")
        sys.exit(3)
    else:
        print("  ❌ 网关不支持远程 URL（但模型能看图）→ 服务端配置 imageMode=DATA_URI")
        print("     若希望改用 URL，需 AI 平台侧放开出网拉取并配置到上传服务域名的网络策略。")
        sys.exit(1)


if __name__ == "__main__":
    main()
```

### 4.2.1 退出码约定与脚本自检状态

| 退出码 | 含义 | 处置 |
|---|---|---|
| 0 | T1 通过且 T3 安全 | 配 `imageMode=URL` |
| 1 | 模型能看图，但网关不支持远程 URL | 配 `imageMode=DATA_URI`；想改用 URL 需 AI 平台放开出网拉取 |
| 2 | 对照组 T2 就没过，T1 结论无效 | 先查模型是否多模态 / 协议是否 OpenAI 兼容 / 字段名 |
| 3 | T1 看似通过但 T3 哨兵告警 | 结论不可信，保守按 `DATA_URI` |

> **脚本状态：已用 mock 网关跑通四个分支**（2026-08-12，外网）。构造了四种网关行为——真拉图 / 拒绝远程 URL / 静默忽略图片 / 非多模态——脚本分别正确给出退出码 0 / 1 / 3 / 2。其中"静默忽略图片"那次，模型对不可达 URL 也照样输出了一段像模像样的界面描述，正是 §4.1 陷阱 1 的实证：**只问"这是什么界面"必然误判为通过**，必须用验证码 + T3 哨兵。

### 4.3 最小 curl 版（只想快速看一眼时用）

```bash
# 把 <...> 换成实际值。关注返回里模型有没有正确读出图中的验证码。
curl -sS -X POST "http://<网关>/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <key>" \
  -d '{
    "model": "<模型名>",
    "temperature": 0,
    "max_tokens": 256,
    "messages": [{
      "role": "user",
      "content": [
        {"type":"image_url","image_url":{"url":"http://<上传服务>/octoAiServer/files/<uuid>.png"}},
        {"type":"text","text":"图片里有一串验证码，请只输出那串验证码本身。"}
      ]
    }]
  }'
```

### 4.4 T1 失败时的分层排查

失败原因分两类，处置完全不同，必须先分清：

| 排查动作 | 观察结果 | 结论 |
|---|---|---|
| 看**上传服务** access log，找模型网关来源 IP 的 `GET /octoAiServer/files/...` | **有**该请求但状态非 2xx | 网络通、网关在拉 → 是鉴权/路径/`Content-Type` 问题，可修 |
| 同上 | **完全没有**该请求 | 网关压根没发起拉取 → 是网关**功能未开放**（常见于 SSRF 防护），需 AI 平台侧配合，不是我们能改的 |
| 从**网关所在主机**执行 `curl -I <image-url>` | 不通 | 纯网络策略问题 → 找网络组开通 |

---

## 5. 接口契约（前端 → Java 服务）

```
POST /screenshot2html/tasks
{
  "imageUrl":  "http://<上传服务>/octoAiServer/files/<uuid>.png",   // 必填，上传服务返回的 url
  "bizId":     "<设计稿/画板 id>",                                   // 可选，便于回查
  "contentHash": "<截图内容 sha256>",                                // 必填，幂等键组成部分
  "priority":  "IDLE"                                               // IDLE(默认) | NOW
}
→ 200 { "taskId": "...", "status": "QUEUED" }

GET /screenshot2html/tasks/{taskId}
→ 200 { "taskId","status","html","errorCode","errorMsg","finishedAt" }
     status: QUEUED | RUNNING | SUCCEEDED | FAILED
```

**幂等键** = `contentHash + promptVersion + modelName`。同一张图在提示词与模型都没变时重复下单直接返回既有结果，不重复烧算力。`promptVersion` 必须进键——改了提示词就该重跑。

**URL 白名单**：`imageUrl` 必须落在上传服务已知域名/路径前缀内，服务端强校验。否则这个接口就是一个开放的 SSRF 代理（无论 `imageMode` 取值，`DATA_URI` 模式下是我们自己去拉，更危险）。

---

## 6. Java 侧实现（伪代码）

### 6.1 配置

```java
@ConfigurationProperties("screenshot2html")
public class Cfg {
    ImageMode imageMode;              // URL | DATA_URI —— 由 §4 验证结果定死
    String    modelEndpoint;          // 内网模型网关 /v1/chat/completions
    String    modelName;
    String    apiKey;
    String    promptVersion = "v1";   // 改提示词必须改这里（幂等键组成）
    int       maxEdgePx     = 1568;   // 单边上限，见 §7
    long      maxImageBytes = 8 << 20;
    int       timeoutSec    = 180;    // 视觉 + 长 HTML 输出，默认 30s 一定不够
    int       maxTokens     = 8192;   // HTML 很长，小了会被静默截断
    int       concurrency   = 4;
    List<String> allowedUrlPrefixes;  // SSRF 白名单，见 §5
}

public enum ImageMode { URL, DATA_URI }
```

### 6.2 唯一分叉点：图片入参构造

两种模式的差异**只在这一个方法内**，其余流程完全一致。

```java
ObjectNode buildImagePart(String imageUrl, Cfg cfg) {
    require(isAllowed(imageUrl, cfg.allowedUrlPrefixes), "imageUrl 不在白名单内");

    ObjectNode part = mapper.createObjectNode();
    part.put("type", "image_url");
    ObjectNode img = part.putObject("image_url");

    switch (cfg.imageMode) {
        // ── 方案 A：网关能拉 URL ──────────────────────────
        // 原样转发。我们不读一个字节，内存零占用。
        // 注意：url 必须是长期有效的（上传服务自有域名、无签名）。
        // 禁止在此生成 S3 预签名 URL —— 空闲时段任务可能排队数小时，
        // 签名会在出队前过期，且重试同样 403，表现为整批莫名失败。
        case URL -> img.put("url", imageUrl);

        // ── 方案 B：网关不能拉 URL ────────────────────────
        // 服务端自己 GET 回来转 data URI。前端契约不变。
        case DATA_URI -> {
            FetchedImage f = imageFetcher.fetch(imageUrl, cfg.maxImageBytes); // 带大小上限，防内存打爆
            byte[] bytes  = imageScaler.scaleToMaxEdge(f.bytes(), cfg.maxEdgePx);
            img.put("url", "data:" + f.mime() + ";base64,"
                           + Base64.getEncoder().encodeToString(bytes));
        }
    }
    return part;
}
```

### 6.3 单条任务执行

```java
HtmlResult convert(Task task, Cfg cfg) {
    ArrayNode content = mapper.createArrayNode();
    content.add(buildImagePart(task.getImageUrl(), cfg));
    content.add(textPart("""
        把这张设计稿截图还原成 HTML 片段。
        要求：
        - 只输出 HTML，不要 markdown 代码围栏，不要任何解释文字
        - 样式写进 <style> 或行内，不引用任何外部资源（字体/图片/CSS）
        - 图片占位用 <div> + 背景色，不要编造图片 URL
        """));

    ChatRequest req = ChatRequest.builder()
        .model(cfg.modelName)
        .messages(List.of(
            Message.system(SYSTEM_PROMPT),
            Message.user(content)))       // 图与文在同一条 user message 内
        .temperature(0.2)                  // 还原任务，不要发挥
        .maxTokens(cfg.maxTokens)
        .build();

    ChatResponse resp = modelClient.post(cfg.modelEndpoint, cfg.apiKey, req, cfg.timeoutSec);

    // 失败必须响亮：URL 拉不到时网关多半回 400，message 里带 download/fetch/image 字样。
    // 不要在此处 catch 后自动切 DATA_URI 重试 —— 那是配置错了，要让它红着停下来。
    return HtmlResult.of(stripCodeFence(resp.firstChoiceContent()));
}
```

### 6.4 空闲时段 drain

```java
@Scheduled(cron = "0 0 1-6 * * ?")               // 凌晨 1–6 点
void drainIdleWindow() {
    while (inIdleWindow() && permits.tryAcquire()) {
        Task t = taskRepo.claimNext();            // SELECT ... FOR UPDATE SKIP LOCKED
        if (t == null) { permits.release(); break; }
        executor.submit(() -> {
            try {
                taskRepo.saveResult(t, convert(t, cfg));
            } catch (Exception e) {
                taskRepo.markRetry(t, e);         // 退避重试，超次数转 FAILED 并记 errorCode
            } finally {
                permits.release();
            }
        });
    }
}
```

`claimNext` 用 `SKIP LOCKED` 而非 `status = QUEUED LIMIT 1` + 应用层判重：多实例部署时后者必然重复领取。

---

## 7. 截图规格约束（本场景特有的失败源）

设计稿截图是长图，这条不处理会导致**静默产出垃圾**：

- 模型端对超限图会强制缩放，整页长截图缩完文字糊掉，模型照着糊图编 HTML，**不报任何错**
- 因此入队前就要把单边压到 `maxEdgePx`（默认 1568，与主流多模态模型的有效分辨率上限同量级）
- 真正的长页面**按视口切片**、分多次生成再拼接，不要指望一张长图搞定
- 切片时保留约 10% 重叠，避免边界处的组件被从中切断

token 成本参考：一张 1024×1024 图约折合 1100~1600 token，切片数直接乘上去，批量规模下要提前算。

---

## 8. 验证

### 8.1 外网验证（不依赖内网服务，本地开发环境即可）

> 涉及新增 HTTP 路由与定时任务，**验证前先重启 Java 服务进程**。另：若目标代码库存在多套并行的 HTTP 路由注册方式（历史遗留框架与现行框架并存），先确认新路由注册在**当前真正生效的那一套**上——"新接口 404" 不要默认归因为没重启。

| 编号 | 验证点 | 步骤 | 期望 |
|---|---|---|---|
| V1 | `imageMode=URL` 的请求体形态 | mock 模型服务，下单一条任务，断言收到的 JSON | `image_url.url` 等于传入的 `imageUrl` 原值 |
| V2 | `imageMode=DATA_URI` 的请求体形态 | 同上，切配置 | `image_url.url` 以 `data:image/` 开头，解码后字节与源图一致 |
| V3 | 两模式对前端契约无影响 | 两种配置各跑一次同样的下单请求 | 接口出入参完全一致 |
| V4 | SSRF 白名单 | `imageUrl` 传站外域名 | 400，且 `DATA_URI` 模式下未发起任何外部请求 |
| V5 | 幂等 | 同 `contentHash + promptVersion + modelName` 重复下单 | 返回同一 `taskId`，模型只被调用一次 |
| V6 | `promptVersion` 变更破幂等 | 改配置后重下单 | 产生新任务，模型被再次调用 |
| V7 | 缩放逻辑 | 3000×8000 图入 `scaleToMaxEdge(1568)` | 长边 = 1568，宽高比不变 |
| V8 | 超大图拒收 | 传超过 `maxImageBytes` 的图 | 明确报错，进程内存无尖峰 |
| V9 | 多实例不重复领取 | 起两个实例同时 drain 100 条任务 | 每条恰好被执行一次 |
| V10 | 失败不静默降级 | mock 网关对 URL 模式返回 400 | 任务转 FAILED 并记录原始错误体，**未**自动改用 base64 重试 |
| V11 | 输出清洗 | mock 返回带 ` ```html ` 围栏的内容 | 落库 HTML 已去围栏 |

### 8.2 内网验证（依赖真实模型网关与上传服务）

| 编号 | 验证点 | 步骤 | 期望 |
|---|---|---|---|
| N1 | **网关远程 URL 能力** | 跑 §4.2 脚本 T1/T2/T3 | 得到明确结论，据此定死 `imageMode` |
| N2 | 网关拉取真实发生 | 查上传服务 access log 中网关来源 IP 的 GET | `imageMode=URL` 时有记录；`DATA_URI` 时无 |
| N3 | 端到端 | web 前端真实生成截图 → 下单 → 空闲窗口跑完 | 拿到可渲染的 HTML |
| N4 | 长设计稿切片 | 用一张整页长设计稿 | 切片数符合预期，拼接后无组件被截断 |
| N5 | 批量压测 | 空闲窗口内跑 200 条 | 无 OOM（`DATA_URI` 模式重点看堆），失败率与耗时可接受 |
| N6 | 长排队后仍可拉图 | 任务入队后隔数小时才执行 | 图仍可访问（验证无预签名过期问题） |

---

## 9. 待定 / 需内网确认

1. **`imageMode` 取值** —— 由 N1 决定，未验证前不预设。
2. **模型网关协议是否 OpenAI 兼容**，字段名是否为 `image_url`（部分自建网关用 `image` / `images`）。若不兼容，§6.2 的 `buildImagePart` 换实现，其余骨架不变。
3. **被测网关与生产调用是否同一地址** —— 内网常见"统一 AI 网关"与"直连推理服务"并存，两者 URL 支持能力可能不同。
4. 空闲窗口的具体时段与并发上限，需与 AI 平台确认算力配额。

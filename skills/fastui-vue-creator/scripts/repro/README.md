# 预览端口串台的复现与回归（SPEC-DES-004 §7.1）

**在外网跑，不需要内网组件库、不需要装 fastui 环境、不需要起 Octo。**

```bash
node scripts/repro/run.mjs          # 全部用例
node scripts/repro/run.mjs E2 E5    # 只跑指定用例
node scripts/repro/run.mjs --keep   # 保留工作目录供排查
```

退出码 0 = 全通过。

## 它怎么做到不需要内网环境

只把 `@turboui/turbo-ui-cli-service` 换成 `fixtures/fake-cli`——一个对齐了真品**可观测面**的假 dev server：
读 `OCTO_PORT`、只监听 `127.0.0.1`、日志打 webpack 那几个标志、`EADDRINUSE` 时打真实错误码后退出、
watch `views/` 模拟 HMR。多出来的一点是：**响应体直接回 `SERVED_BY=<工程目录>` 和当前页面内容**，
于是「这个端口上跑的是谁的服务」可以被一句话判定——这正是串台类缺陷的判据。

`new-session.mjs` / `verify.mjs` / `lib/port.mjs` 是**原样调用的真代码**，一行没改。

`FAKE_LISTEN_DELAY_MS` 控制「先编译、后 listen」的时间窗（真实首次编译 1–3 分钟），E3 用它制造竞态。

## 前后版本对照（2026-09-14 实测，macOS）

| 用例 | 修复前 | 修复后 |
|---|---|---|
| E1 同目录 6 并发 | PASS | PASS |
| E2 **跨目录并发** | **FAIL** — 两边都拿到 18081 | PASS — 18081 / 18082 |
| E3 跨目录并发起服务 | **FAIL** — B 的端口上是 A 的内容 | PASS — 各自 serve 自己的工程 |
| E4 卡片端口单一来源 | **FAIL** — 没有 `PREVIEW_CARD` 这一行 | PASS |
| E5 **端口回收改嫁** | **FAIL** — 点 A 的旧卡片显示了 B 的页面 | PASS — 无响应（坏掉，而不是串台） |
| E6 同目录端口回收 | PASS | PASS |

**E5 就是用户报的那个现象**，已被自动化捕获。

要跑修复前的版本做对照：

```bash
# 把改动前的 skill 导出到临时目录，再把本目录复制进去跑（不动工作区）
git archive <改动前的 commit> skills/fastui-vue-creator | tar -x -C /tmp/before
cp -R skills/fastui-vue-creator/scripts/repro /tmp/before/skills/fastui-vue-creator/scripts/
node /tmp/before/skills/fastui-vue-creator/scripts/repro/run.mjs
```

## 它验不了什么

- **真实 `turbo-ui-cli-service` 从启动到 listen 要多久** — 决定 `verify.mjs` 那个 1500ms `EADDRINUSE`
  检测窗口够不够（SPEC-DES-004 §2 P5），只能内网实测
- **宿主（Electron 主进程）那一侧** — 这里跑的是 skill 自管路径；`MAX_SERVERS` 的 LRU 淘汰、
  预览归属判定（§4.1）、起服务前探端口（§4.3）要走 §7.2 的内网手工用例
- **HMR 的真实行为**

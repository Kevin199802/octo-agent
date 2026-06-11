# happy-dom 与 IndexedDB —— 测试环境为何测不了持久化

> 背景:SPEC-INS-011 debug-observer 阶段2 用 IndexedDB 做持久化,发现单测环境(happy-dom)
> 没有 IndexedDB,引出对"测试用的假浏览器"和"浏览器存储有没有实体文件"两件事的厘清。

---

## 1. happy-dom 是什么

**一个纯 JS 实现的"假浏览器环境"**,跑在 Node/Bun 里,提供 `window`/`document`/`fetch`/DOM 等 API——让单测**不用起真浏览器**就能测依赖 DOM 的代码(SolidJS 组件、渲染逻辑)。

- UXAI 单测通过 `bun test --preload ./happydom.ts` 注册它(`GlobalRegistrator.register()`),把这些 API 挂到全局。
- 同类还有 **jsdom**(更全、更重);happy-dom 主打**轻快**。
- 跑真浏览器的是 **Playwright**(e2e),慢但真实。三者分工:happy-dom/jsdom 单测、Playwright e2e。

**关键:它不完整。** 只实现常用 DOM。缺失/简化的包括:
- **IndexedDB**(完全没有)
- Canvas(本项目 `happydom.ts` 里手动 mock 了 `getContext`)
- 部分较新的 Web API

**踩坑姿势**:逻辑依赖了 happy-dom 没实现的 API → 单测里那段跑不起来。三条出路:① 设计**降级路径**并测降级(我们选这条);② **人工验证**;③ 引 polyfill(如 `fake-indexeddb`)——但那是新增依赖,属团队决策。

---

## 2. IndexedDB 有没有实体文件?——有

**浏览器内置的结构化存储,数据落在磁盘上,不是内存。**

- **存哪**:Chromium/Electron 把它写在 `userData` 下的 `IndexedDB/` 目录(LevelDB 格式),按 origin 分子目录。本项目壳把 `userData` 设在 `appData/<appId>`(见 `desktop/src/main/index.ts` 的 `app.setPath("userData", …)`)。
- **所以**:数据**跨刷新、跨重启、跨进程**存活——这正是 debug-observer 阶段2 拿它"跨 reload/重启留存现场"的原因。
- **特性**:per-origin 隔离;配额大(按可用磁盘比例,远超 localStorage 的 ~5MB);**异步**(事务式 API)。

**对比 localStorage**:

| | localStorage | IndexedDB |
|---|---|---|
| 落盘 | 是 | 是 |
| 容量 | ~5MB(整个 origin 共享一个池) | 大(磁盘比例) |
| API | 同步、键值字符串 | 异步、对象/事务 |
| 适合 | 小配置 | 大量结构化数据 |

debug 持久化选 IndexedDB,正是为了**不挤占** localStorage 那 5MB 共享池(否则可能影响其他功能)。

---

## 3. 对本项目(SPEC-INS-011)的影响

- **阶段2** 用 IndexedDB 持久化三个 ring(event/send/log)→ 跨 reload/重启;已人工验证:`octoDebug.snapshot()` 顶部出现「含 N 条重启前」。
- **happy-dom 无 IndexedDB** → 阶段2 持久化 round-trip **无法单测**;现有单测实际覆盖的是「**无 IndexedDB → 降级为纯内存**」路径(`openDebugDB()` 返回 `undefined` 时全程不抛、功能不受影响)。
- 持久化本身走 [SPEC-INS-011 §7.2](../specs/ui/insight-debug-toolkit.md) 人工 reload 验证;**不引 `fake-indexeddb`**,保持测试轻量。

> 一句话:**happy-dom 是测试用的假浏览器(缺 IndexedDB);IndexedDB 是真落盘存储(所以能跨重启)**。两者一假一真,正好解释了"为什么持久化逻辑只能人工验证、降级路径才能自动测"。

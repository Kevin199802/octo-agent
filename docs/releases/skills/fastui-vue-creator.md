# fastui-vue-creator 版本记录

> 本文件只记**每个版本带了什么**。版本号的定义、涨号规则、上架流程见
> [SPEC-DES-001 §5.2.4](../../specs/design/fastui-vue-codegen-pipeline.md#524-发布版本号与-changelog),此处不重复。
>
> 定位问题时：拿用户机器上 `doctor` 输出的 `SKILL_VERSION`(或已装 skill 目录里 `SKILL.md` 的 `version`)
> 对到下面的版本条目，就知道当时装的是哪份组件 skill、哪版 template;外网代码看 git tag `fastui-vue-creator/v<版本号>`。

## 未发布

(无)

## 1.1.1 ｜ 2026-10-22 ｜ template 去掉预览容器 padding 白边

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `fastui-vue-creator/v1.1.1`(commit 待补) |
| 组件 skill(`vendor/`) | 1.0.7(同 1.0.0,未变) |
| template | 基于 1.0.0 改样式模板：去掉容器 padding 产生的白边 |

- **template**:样式模板去掉容器 padding,预览页面四周不再留白边。内网手工修改，按 [SPEC-DES-001 §8.3](../../specs/design/fastui-vue-codegen-pipeline.md#83-外网仓只放外网能维护的部分内网资产留占位) 重做 ① 组装
- 外网代码(`SKILL.md` / `scripts/` / `references/`)与 1.1.0 相同，只涨了版本号

## 1.1.0 ｜ 2026-10-21 ｜ 工程与会话目录解耦,兼容代码工作区

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `fastui-vue-creator/v1.1.0`(`4d158f3`) |
| 组件 skill(`vendor/`) | 1.0.7(同 1.0.0,未变) |
| template | 同 1.0.0,未变 |

- **工程与会话目录解耦,兼容代码工作区**([SPEC-DES-008](../../specs/design/fastui-workspace-layout.md))。修「新建工作区(默认代码工作区)里 verify 卡住、没有预览卡片」:
  - 工程根写标记 `.octo-fastui.json`,运行时文件(dev server 记录与日志、脚本日志、交付包)移到 `<工程>/.octo-fastui/`;各脚本只认工程目录,不再从它往上推会话目录
  - `new-session`:`--artifact-dir` 取 `[Artifact Folder]`,没有就取 `[Workspace]`;新增 `--list` / `--title` / `--reuse`;`--name` 改为必填(去掉默认 `fastui-app`);同名目录不是本 skill 的工程、是别的对话或别的 skill 的工程时报 `NAME_TAKEN`;工作区外报 `OUTSIDE_WORKSPACE`;原子创建(临时目录 + 改名);删除护栏改为「本 skill 的工程或临时目录」
  - `verify` / `export-zip`:主参数改为 `--project-dir`;旧参数 `--session-dir` 仍可用(先读会话级状态,再找 `outputs/` 下恰好一个工程,再按本对话恰好一个工程,并提示改用 `--project-dir`);都不传时用本对话恰好一个的工程;有工作区上下文时定位结果必须在工作区内;交付包排除 `.octo-fastui/` 与标记
  - 旧版 Octo(心跳里没有 `layout: 2`)下 `new-session` 报 `HOST_OUTDATED` —— **本版必须在含 SPEC-DES-008 的 Octo 发布之后再上架**
  - SKILL.md:②「选定工程」整段重写(什么时候用 question 工具问用户、固定提问模板);`--project-dir` 取 `PROJECT_DIR` 原值;装环境与 verify 要求给 shell 工具传 `timeout: 600000`
- 配套 Octo 改动(UXAI `feat/fastui-workspace-layout`):宿主按(工作区, 会话, 产物名)查找工程;注入根会话 id 与工作区目录;本轮改过工程内文件时自动补一张预览卡片(SPEC-DES-008 §3.8)

## 1.0.0 ｜ 2026-10-15 ｜ 首次上架

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `fastui-vue-creator/v1.0.0`(`6a60237`) |
| 组件 skill(`vendor/`) | 1.0.7 |
| template | 首次组装：内网 portal-web 脚手架，按 [SPEC-DES-001 §8.3](../../specs/design/fastui-vue-codegen-pipeline.md#83-外网仓只放外网能维护的部分内网资产留占位) 组装 |

- 首个上架技能库的版本，作为后续版本的基线。能力范围与已知限制见 SPEC-DES-001 [§0.0](../../specs/design/fastui-vue-codegen-pipeline.md#00-当前进度与待办改动后随手更新这一节)。

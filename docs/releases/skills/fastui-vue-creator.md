# fastui-vue-creator 版本记录

> 本文件只记**每个版本带了什么**。版本号的定义、涨号规则、上架流程见
> [SPEC-DES-001 §5.2.4](../../specs/design/fastui-vue-codegen-pipeline.md#524-发布版本号与-changelog),此处不重复。
>
> 定位问题时：拿用户机器上 `doctor` 输出的 `SKILL_VERSION`(或已装 skill 目录里 `SKILL.md` 的 `version`)
> 对到下面的版本条目，就知道当时装的是哪份组件 skill、哪版 template;外网代码看 git tag `fastui-vue-creator/v<版本号>`。

## 未发布

- **工程与会话目录解耦,兼容代码工作区**([SPEC-DES-008](../../specs/design/fastui-workspace-layout.md))。修「新建工作区(默认代码工作区)里 verify 卡住、没有预览卡片」:
  - 工程根写标记 `.octo-fastui.json`,运行时文件(dev server 记录与日志、脚本日志、交付包)移到 `<工程>/.octo-fastui/`;各脚本只认工程目录,不再从它往上推会话目录
  - `new-session`:`--artifact-dir` 取 `[Artifact Folder]`,没有就取 `[Workspace]`;新增 `--list` / `--title` / `--reuse`;`--name` 改为必填(去掉默认 `fastui-app`);同名目录不是本 skill 的工程、是别的对话或别的 skill 的工程时报 `NAME_TAKEN`;工作区外报 `OUTSIDE_WORKSPACE`;原子创建(临时目录 + 改名);删除护栏改为「本 skill 的工程或临时目录」
  - `verify` / `export-zip`:主参数改为 `--project-dir`,`--session-dir` 仍可用;都不传时用本对话恰好一个的工程;交付包排除 `.octo-fastui/` 与标记
  - 旧版 Octo(心跳里没有 `layout: 2`)下 `new-session` 报 `HOST_OUTDATED` —— **本版必须在含 SPEC-DES-008 的 Octo 发布之后再上架**
  - SKILL.md:②「选定工程」整段重写(什么时候用 question 工具问用户、固定提问模板);装环境与 verify 要求给 shell 工具传 `timeout: 600000`
  - 上架时涨号为 1.1.0

## 1.0.0 ｜ 2026-10-15 ｜ 首次上架

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `fastui-vue-creator/v1.0.0`(`6a60237`) |
| 组件 skill(`vendor/`) | 1.0.7 |
| template | 首次组装：内网 portal-web 脚手架，按 [SPEC-DES-001 §8.3](../../specs/design/fastui-vue-codegen-pipeline.md#83-外网仓只放外网能维护的部分内网资产留占位) 组装 |

- 首个上架技能库的版本，作为后续版本的基线。能力范围与已知限制见 SPEC-DES-001 [§0.0](../../specs/design/fastui-vue-codegen-pipeline.md#00-当前进度与待办改动后随手更新这一节)。

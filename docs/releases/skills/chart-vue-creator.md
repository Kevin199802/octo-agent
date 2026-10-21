# chart-vue-creator 版本记录

> 本文件只记**每个版本带了什么**。版本号的定义、涨号规则、上架流程见
> [SPEC-DES-001 §5.2.4](../../specs/design/fastui-vue-codegen-pipeline.md#524-发布版本号与-changelog)(与 fastui-vue-creator 同一套),此处不重复。
>
> 定位问题时：拿用户机器上 `doctor` 输出的 `SKILL_VERSION`(或已装 skill 目录里 `SKILL.md` 的 `version`)
> 对到下面的版本条目，就知道当时装的是哪版设计师上游(`design/`)、哪版 template;外网代码看对应 git tag。
>
> 与 fastui 的区别：本 skill 不带组件 skill(`vendor/`),换成设计师上游 [chart-design-advisor](https://github.com/peterbobidu/chart-design-advisor) 的 `design/`。
> 上游会不涨版本号就改内容，所以**上游必须连 commit 一起记**。

## 未发布

(无)

## 1.1.0 ｜ 2026-10-21 ｜ design/ 同步上游 v0.6.9

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `chart-vue-creator/v1.1.0`(`5934a99`) |
| 设计师上游(`design/`) | v0.6.9 分发修订 r9 @ `1d7ae38`(上游 0.6.9 内改了 r1–r9 九轮，版本号未变) |
| template | 同 1.0.0,未变 |

- design/ 同步至上游 v0.6.9(分发修订 r9)@ `1d7ae38`(2026-10-21;上一版 v0.6.8 @ `1629ba8`)。设计师的改动见上游 [CHANGELOG](../../../skills/chart-vue-creator/design/CHANGELOG.md) 的 0.6.9 各条目([逐文件 diff](https://github.com/peterbobidu/chart-design-advisor/compare/1629ba8...1d7ae38))。
- SKILL.md 上半段随之调整:`design/` 路径按上游新目录编号改写;按需读取表补 Tooltip 入口、删去指向已不存在文件的「维护、评测或发布」行。下半段与 `scripts/` 未动。

## 1.0.0 ｜ 2026-10-19 ｜ 首次上架

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `chart-vue-creator/v1.0.0`(`bf1c832`) |
| 设计师上游(`design/`) | v0.6.8 @ `1629ba8`(上游该 commit 未涨版本号) |
| template | 内网 portal-web 脚手架 + ECharts golden example(样式写法版),含手工加入的 `tailwind.config.js` 与 `src/assets/styles/mixin.less`,按 [SPEC-DES-006 §7.1](../../specs/design/chart-vue-creator-integration.md#71-组装只剩填-template-一步) 组装 |

- 首个上架技能库的版本，作为后续版本的基线。能力范围与已知限制见 SPEC-DES-006 [§0](../../specs/design/chart-vue-creator-integration.md#0-当前进度与待办)。
- 含样式写法约束(SKILL.md 硬约束 3.2,同步自组件 skill 1.0.7 的「样式编写优先级」,只取写法不取视觉值，见 [SPEC-DES-006 §4.4](../../specs/design/chart-vue-creator-integration.md#44-样式写法同步自组件-skill只取怎么写不取取什么值))。

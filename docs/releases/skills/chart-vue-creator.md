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

## 1.0.0 ｜ 2026-10-19 ｜ 首次上架

| 组成 | 本版 |
|---|---|
| 外网代码 | tag `chart-vue-creator/v1.0.0`(`bf1c832`) |
| 设计师上游(`design/`) | v0.6.8 @ `1629ba8`(上游该 commit 未涨版本号) |
| template | 内网 portal-web 脚手架 + ECharts golden example(样式写法版),含手工加入的 `tailwind.config.js` 与 `src/assets/styles/mixin.less`,按 [SPEC-DES-006 §7.1](../../specs/design/chart-vue-creator-integration.md#71-组装只剩填-template-一步) 组装 |

- 首个上架技能库的版本，作为后续版本的基线。能力范围与已知限制见 SPEC-DES-006 [§0](../../specs/design/chart-vue-creator-integration.md#0-当前进度与待办)。
- 含样式写法约束(SKILL.md 硬约束 3.2,同步自组件 skill 1.0.7 的「样式编写优先级」,只取写法不取视觉值，见 [SPEC-DES-006 §4.4](../../specs/design/chart-vue-creator-integration.md#44-样式写法同步自组件-skill只取怎么写不取取什么值))。

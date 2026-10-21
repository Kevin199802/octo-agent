# HD图表规范入口

仅在选择HD规范后读取本表。来源沿用既有HD规范，并融合2026-10-19用户提供的通用规则补充文档、八张配图及后续确认；这是Skill整理版，0.6.9是Skill版本，不是HD标准发布版本。保留common/charts目录以稳定引用，不代表这些视觉数值适用于所有领域。

| 读取条件 | 文件及范围 |
| --- | --- |
| HD图表原型 | [使用](common/usage.md)、[布局](common/layout.md)、[视觉基础](common/visual-basics.md)、[颜色](common/color.md)、[状态](common/state.md) |
| 有坐标轴 | [坐标轴](common/axis.md) |
| 有悬浮提示 | [通用Tooltip组件](components/tooltip.md) |
| 有图例 | [图例](common/legend.md)：组成、标记、位置、隐藏态与分页 |
| 折线图 | [折线专项](charts/line.md)：PARTIAL，覆盖用途、信息与部分能力 |
| 柱状图 | [柱图专项](charts/bar.md)：PARTIAL，来源数值的正式级别部分待确认 |
| 平行坐标 / 平行坐标轴 / Parallel Coordinates | [平行坐标专项](charts/parallel.md)：轴布局、聚焦线条、刷选和Tooltip；比较逻辑沿用[Method 05](../../02-methods/05-multi-object-comparison.md) |
| 饼图 / 环形图 | [饼与环专项](charts/pie.md)：PARTIAL，布局、标签与可选中心信息；不推广到仪表盘/雷达 |
| 矩形树图 / 矩形树状图 / Treemap | [矩形树图专项](charts/treemap.md)：块样式、标签、分组色系及面积/颜色口径；外层沿用公共规则 |
| 散点、热力、雷达、箱形等 | 暂无独立专项文件；沿用命中方法与通用规则 |

单项规范咨询只读相关文件；PARTIAL表示知识覆盖，不表示业务集成已通过。

# 测试索引

以下文件保存输入和预期；执行证据见[VALIDATION](../VALIDATION.md)。当前评价不使用L0/L1门槛，版本历史不参与裁决。只运行与修改风险相关的用例，逐项记录执行情况。

| 范围 | 入口 |
| --- | --- |
| 总体判定 | [评价规则](evaluation-rubric.md) |
| 路由与编号 | [R01–R27](router-cases.md)、[对象/行为映射](router/analysis-object-behavior-cases.md)、[旧11兼容入口](legacy-method-11-cases.md) |
| 图表规范 | [规范用例](chart-spec-cases.md)、[领域选择](domain-spec-cases.md) |
| Method 01 | [趋势评价](../04-references/methods/01/evaluation.md) |
| Method 03 | [分支用例](method-03-cases.md)、[总体验收](../04-references/methods/03/evaluation.md) |
| 半导体快照 | [14项用例](method-03-snapshot-cases.md)、[专项验收](../04-references/methods/03/snapshot-evaluation.md) |
| Method 04 | [关联用例](method-04-cases.md)、[评价](../04-references/methods/04/evaluation.md) |
| Method 05 | [比较用例](method-05-cases.md)、[评价](../04-references/methods/05/evaluation.md) |
| Method 06 | 路由R23/R24及[回溯评价](../04-references/methods/06/evaluation.md) |
| 工程交接与能力边界 | [Handoff用例](handoff-cases.md)、[既有工程用例](hosted-project-cases.md)、[ECharts能力告知用例](echarts-capability-cases.md) |
| 原型运行 | [0920回归](regression-0920.md)、[Vue/ECharts案例](vue-echarts-cases.md) |

方法当前状态以[索引](../03-methods/index.md)为准。源文件中的实现、静态检查、同会话试跑、独立上下文生成和真实业务接入是不同证据；不得互相替代。旧归档未随包分发。

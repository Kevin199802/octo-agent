# Vue 3 / ECharts 可交付代码

适用于入口选定的Vue 3 + TypeScript + ECharts路径。预览与交付使用同一Vue组件，设计修改直接落在该实现中。工程承载、依赖安装和管道执行按[承载工程规则](hosted-project.md)；无承载工程时默认Vite预览工程。

## 组件与接口

- 核心图表与演示页面分开；示例数据通过props传入并明确标记，业务文案和窗口工具不写死进核心组件。Vite的index.html只是应用入口。
- 输入类型明确对象ID、指标、单位、数值、缺失值、颜色身份及业务阈值依据；数据变换按[数据语义](../data-semantics.md)，不擅自增加评分、权重或阈值。
- 分离数据整理、ECharts option构造、Vue生命周期和演示交互。容器变化时重算与resize，卸载时释放实例和监听器；常规数据可用dataset，特殊几何可用custom series。
- 提供真实props、必要事件和最小调用示例，记录依赖版本依据；没有业务接口时明确适配点和待接入的Token、Chart+、D2C或API，不把模拟数据写成后端契约。

## 验收与交接

- 实现前按[ECharts能力边界](echarts-capabilities.md)核对需求与限制。
- 规范映射和渲染检查按[生成与验收](generation-review.md#公共规范落地)，工程交付条件按[产物门槛](delivery-gates.md)。复杂图形按相应方法专项检查几何与模式切换，不将案例参数推广为通用规则。
- 按[Handoff规则](handoff.md)随工程提供交接说明；设计确认与工程集成分别记录。

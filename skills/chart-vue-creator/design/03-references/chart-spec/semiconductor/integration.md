# 半导体实现与接入

适用于半导体图表的工程接入，与[通用规范](general.md)配合。区分内部组件接入和无内部依赖时的通用原型，契约名称不等同于可调用代码。

## 实现方式

- 有业务组件及所需接口时，基础图表和容器优先复用业务组件；Vue/DOM负责菜单、浮窗、拖动和参数面板，ECharts或组件开放能力负责绘图、resize及图像导出。
- 未提供内部组件、CSS、Token文件或runtime时，仍按承载工程或独立默认Vue 3 + TypeScript + ECharts路径交付；按已知视觉值配置本地样式，不引用不存在的包或伪造内部API。优先使用承载工程已认可并提供的UI库（如Element Plus），仍按半导体规范核对视觉；无此约定时可用原生DOM控件，不自行新增外部UI依赖。状态语义按通用规则实现，不假称使用了semi.chart.*组件。
- 内部类名、DOM宿主、Bridge字段和profile仅在对应接入环境适用；通用Vue组件须避免固定全局ID造成多实例冲突。使用实际组件ref或实例化宿主，在HANDOFF记录与内部契约的映射缺口。
- 未知Token值使用明确标注的本次设计建议；不以“Token已声明”冒充实际解析或规范已满足。字段、接口和数值来源随工程记录。
- 晶圆使用内部runtime，不另写notch/die公式。依赖缺失时不得假装已复用；说明该部分尚未实现或待接入，其他可实现部分继续交付。若用户希望采用自定义替代方案，先说明差异并按[ECharts能力边界](../../prototype/echarts-capabilities.md)处理，不将缺内部资产归为ECharts不能实现。
- 只有代码已提供真实替换入口，才称可替换；否则在[HANDOFF](../../prototype/handoff.md)记录需拆分或新增的接入位置。通用工程可运行不等于内部组件或业务项目已验证。

桌面Tooltip的通用视觉与交互见[组件规范](../common/tooltip.md)。真实业务组件支持时通过其配置接入；未知或冲突项记录在HANDOFF，不自行绕过本文件的宿主/Bridge协议。

## 内部接入契约

以下适用于对应内部环境；外部文件未随本包提供，名称保留用于开发映射。

| 能力 | 规则 |
| --- | --- |
| Tooltip | 统一`#chartTooltip`，或组件detail指定宿主；不另造每页DOM协议 |
| 放大 | Header/工具栏入口打开`#chartZoomModal .modal-chart`；在弹窗body重绘，不clone固定SVG或卡片body |
| 关闭 | `#chartZoomClose`、遮罩点击、Escape；打开时调用`hideChartTooltip()` |
| 晶圆放大 | slot为`min(480px, calc(92vw - 48px))`、`aspect-ratio:1`；caption在SVG外 |
| 空/错/载 | 使用`semi.chart.*`及Empty/Loading约定，绘图区不留无说明空白，不造假柱/假线 |
| 晶圆运行时 | 使用`semi-wafer-runtime.js`导出API，禁止另写notch/die公式 |
| Bridge | 包含`chart_lock_profile`和完整`chart_slots`；具体字段结构依赖外部契约 |

## 内部配置档与资产

| Profile / 任务 | 能力与读取 |
| --- | --- |
| `chart-standard` | 普通无放大图；CN12/13/15/20与container-patterns；Tooltip可选，无Zoom Modal；DataZoom仅容器模式含zoom时使用。读取`container-patterns.md`、`chart-lock.md`、`chartlist.md` |
| `chart-with-zoom` | 同普通视觉；必须Tooltip与Zoom Modal，重绘及按钮/遮罩/Esc关闭。另读`chart-wafer-patterns.md#图表缩放规则` |
| `wafer-bin` | 单片Bin分类色，Die hover，放大用`renderBinWaferMap(...,{zoom:true})`；读`WaferMap.md`、`wafer-map-guide.md`、`chart-wafer-patterns.md#晶圆绘制规则` |
| `wafer-stack-ryg` | 连续RYG、`--wafer-legend-gradient`，同runtime及zoom重绘契约；同上，补`chart-wafer-patterns.md#图例面板`晶圆例外 |
| `wafer-thumb-grid` | 5×5缩略，hover/focus格；大图/弹窗走wafer-bin重绘；读`implementations.md` Wafer网格与`chart-wafer-patterns.md#晶圆缩放规则` |
| DefectMapChart | 晶圆子锁；读`DefectMapChart.md`、`wafer-defect-patterns.md` |
| ZoneWaferMap | wafer-bin + zone；读`ZoneWaferMap.md`、`wafer-map-guide.md` |

| 权威资产（锁定，不在任务内改写） | 用途 |
| --- | --- |
| `references/tokens.md`、`assets/semi-tokens-light.css` | 色彩与尺寸Token |
| `assets/semi-chart-layout.css` | 壳层、标题及`.chart-zoom-*`缩放组件CSS |
| `references/chart/container-patterns.md` | 三种容器结构 |
| `references/chart/chartlist.md`及detail | 图表类型与专项 |
| `assets/semi-wafer-runtime.js` | renderBinWaferMap / renderBinStackWaferMap / waferLayout / dieRectAt |
| `assets/semi-chart-runtime.js` | bindChartAreaResize / bindChartZoom / syncAxisZoomRails |
| `chart-lock.md §3`、`implementations.md#图表交互` | Tooltip、Zoom与关闭协议 |
| `examples/base-chart-gallery.html`、`yield-*-dashboard.html` | 对照预览 |

## 接入边界

以下边界尚未明确，接入时按实际资产和接口说明处理方式，不自行补成统一要求，也不阻塞其他可实现内容：

| 项目 | 边界与处理 |
| --- | --- |
| 标题至图表gap归属 | 标题至图表仅使用flex gap 12px；父容器与Body各负责哪一段间距未定义，结合实际结构分配，避免重复累加 |
| 图例一致性 | 同模块统一none/bottom/right，并支持单行放不下切right；切换作用范围、无须图例的图及模式默认right的优先级未定义，按具体场景说明 |
| 绘制层级实现 | DOM节点按绘制层级追加；Canvas/ECharts与DOM混合渲染的层级映射未定义，需核对实际叠放结果 |
| 动效实现 | 数据序列入场采用150ms；CSS animation与Canvas各序列的对应方式未定义，不能用画布整体动画替代数据级效果 |
| Token范围 | 通用chart色、功能色、半导体色和晶圆色按语义使用；内部契约若要求“全部var(--color-chart-*)”，须说明适用图形范围，不静默替换专用Token |
| 280px与缩略晶圆 | 图表区域最小280px与晶圆边长最小100px、5×5缩略并存；280px针对整卡还是单格未定义，按实际容器说明，不强行将每格设为280px |
| 放大适用范围 | 各wafer-*配置档是否均需Zoom Modal未统一定义；按实际配置档说明入口与重绘行为，不将部分场景的放大推广为全部强制 |
| Bin Patrol比例 | 主Spec Y轴量程85%、预警68%的数值换算、分母及业务阈值含义未定义，不据比例伪造真实告警阈值 |
| 未提供依赖 | CN12/13/15/20、chart_slots结构、部分Token值、runtime及专项文件需由业务环境提供；缺失时记录未接入或未验证，不虚构实现 |


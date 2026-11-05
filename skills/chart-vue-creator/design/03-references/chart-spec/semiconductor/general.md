# 半导体图表通用规范

适用于按[规范索引](../index.md)选定半导体规范的B端PC图表。未定义项按具体方案说明，不自动继承HD。

类名、Token与接口按对应业务环境使用，名称存在不代表依赖已提供。内部依赖和接入边界见[实现与接入](integration.md)，晶圆任务另读[晶圆专项](wafer.md)。通用原型按已定义数值配置，未知Token值不虚构。

## 1. 范围与依赖

适用于半导体B端PC图表：

- 基础图表：ScatterChart、LineChart、AreaChart、BarChart、HeatMap、BoxPlot、GanttChart、ParetoChart、DiskChart、RadarChart、ComboChart、BubbleChart。
- 专业图表：WaferMap（yieldMap / binMap / binStackMap / defectMap / aggregateHeatmap / zoneMap）、ZoneWaferMap、DefectMapChart。

业务接入优先复用Semi已有组件；外围控件可使用承载工程已认可的UI库，仍需核对半导体视觉规范；依赖未提供时的原型实现方式见[实现与接入](integration.md)。

## 2. 容器与布局

独立展示的图表使用统一容器，按需包含标题、操作区、绘图区和图例。优先复用已有容器，避免重复嵌套卡片；弹窗或组合视图沿用宿主容器。使用配套样式时采用`.module-card.module-card--chart`类名。卡片视觉内容内距为16px，由Header和Body分配，卡片自身`padding:0`。

| 对象 | 规则 | Token / 接口 |
| --- | --- | --- |
| 卡片 | 圆角8px、白底#FFFFFF | `--radius-md` / `--color-bg-4` |
| 标题 | 左上；16px / bold / 24px；#191919，不用灰色或品牌色 | `.chart-title`；`--font-size-md` / `--font-weight-bold` / `--color-text-primary` |
| 工具栏 | 右上；线性图标16px，项间距12px | `.chart-toolbar`；`--chart-toolbar-gap` |
| Header | `padding:16px 16px 0` | `.chart-header` |
| Body | `margin:0 16px 16px`、`flex:1`、`min-height:0`；Body的`gap:12px`与标题间距的归属见[接入边界](integration.md#接入边界)，不重复叠加 | `.module-body` |
| 标题至图表 | 12px，仅由flex gap产生，不叠加Body顶部margin或SVG顶部留白 | `--spacing-3` |
| 图表区域 | 最小高度280px；内容不溢出卡片 | `.chart-panel-area`；`--chart-container-min-height` |
| 内容内距 | 四边16px，按上面的分区实现 | `--chart-container-padding` / `--spacing-4` |
| 数据安全内距 | 数据距绘图框内缘4px；`dataL=pad.l+4`，`dataH=plotH−8` | `--chart-data-safe-inset` |

Body组织：绘图区域（绘图框、SVG/Canvas、可选DataZoom）→可选`.chart-x-axis-title`→可选`.chart-footer > .legend`。无图例时省略footer；右侧图例布局见第4节。

绘图区panel/area默认无外边框；绘图坐标框和右侧图例框按各自规则保留。禁止SVG使用`width:100%`搭配`height:auto`导致固定比例干扰尺寸响应。图表卡不通过并排stretch强行等高；有图例卡与无图例卡纵向排列。

| 容器模式 | 场景 | 默认图例 |
| --- | --- | --- |
| `chart-container-dashboard-card` | 普通看板卡片：标题、工具栏、绘图区 | bottom |
| `chart-container-toolbar-legend-zoom` | Trigger lot chart、堆叠柱、侧图例、日期及By day/week/month | right |
| `chart-container-split-chart-table` | 上图下表、明细查询链 | 按场景 |

## 3. 绘图层级、坐标轴与缩放

### 绘图层级

| 自底向上 | 内容 |
| --- | --- |
| L0 | 坐标轴、刻度、网格、`.chart-plot-frame` |
| L1 | 柱/线/面/点、晶圆die/缺陷点、饼扇区等数据几何 |
| L2 | Spec / Control / Limit卡控线，类名`.chart-control-line` |
| L3 | 回归/趋势线、阈值标签、注释引线、框选marquee |

卡控线不得被数据遮挡；拟合与标注位于数据上层。DOM节点按上述顺序追加；SVG/Canvas及跨DOM层的对应方式须结合实际渲染核对，见[接入边界](integration.md#接入边界)。

卡控线：1px（`--chart-control-line-width`）；线段4px、间隔2px（`--chart-control-line-dash`）；规格/超限色（`--chart-control-line-stroke` → `var(--color-error)`）。SVG放大保持线宽，使用`vector-effect:non-scaling-stroke`。

**Bin Patrol例外**：每根可见柱绘制柱内水平Spec线段，禁止横贯整个plot。主Spec Y轴量程比例85%（`specRatio=0.85`）、预警比例68%；数值换算、分母及业务阈值含义未定义，按[接入边界](integration.md#接入边界)处理，不直接作为业务告警阈值。

### Cartesian轴区

适用于Bar、Line、Area、Scatter、BoxPlot、Combo、Bubble、Pareto、HeatMap等Cartesian图表；Disk、Radar、Wafer按专项文档。

| 元素 | 规则 |
| --- | --- |
| Y轴名 | 12px / bold / 14px，左侧、与绘图区垂直居中；旋转90° |
| Y轴名至Y缩放 | 水平8px（`--spacing-2`） |
| X/Y刻度 | 12px / regular / 14px，`--color-text-secondary`；距对应轴4px，不超轴端；X轴端标签用`text-anchor:start/end`贴齐 |
| X轴标题 | 12px / bold / 14px，#191919，沿X轴居中 |
| 轴线 / 绘图框 | 1px、#C9C9C9（`--chart-axis-stroke`）；SVG `.chart-plot-frame`设置`fill:none` |
| 网格 | 1px、#F3F3F3，实线；`--chart-grid-stroke` / `--color-border-separator-subtle` |

字号/字重分别使用`--font-size-xs`、`--font-weight-bold`或`--font-weight-regular`；轴名主色使用`--color-text-primary`。

### 缩放

| 组件 | 尺寸与对齐 |
| --- | --- |
| X轴缩放 `.chart-zoom-x` | 长度=plotW，两端与X轴起终点对齐，不对齐卡片全宽、不进入侧图例栏 |
| Y轴缩放 `.chart-zoom-y` | 轨宽6px（`--chart-zoom-rail-size`）、高度=plotH，顶底对齐绘图区，不stretch成整列 |
| X轴DataZoom | 绘图区下方，不覆盖X刻度；距刻度8px，高度使用`--chart-datazoom-height` |

Y缩放轨道为胶囊圆角，背景`--color-bg-1`；选区#2070F3、15%透明度（`--chart-zoom-thumb-bg`）；手柄白底、轻阴影、居中1px竖向握条，握条色`--color-text-primary`。拖选区平移，拖手柄改变范围，双击轨道复位0–1；最小窗口8%。

## 4. 图例

`legend.position` / `legendMode`取`none | bottom | right`，默认bottom。同一业务模块/页面区块使用同一种样式；底部图例拥挤或单行放不下时切right。自动切换作用于单图还是整个区块尚未定义，按[接入边界](integration.md#接入边界)说明。

| 模式 | 布局与样式 |
| --- | --- |
| none | 不渲染`.chart-footer`、`.legend`、`.chart-side-legend`；X轴标题底边到卡片内容区内缘16px |
| bottom | X轴标题下方8px（`--chart-legend-gap`）；距卡片底边16px；10px圆点，点至标签8px，项间水平24px；标签12px / Regular / 20px / #777777 |
| right | 与绘图主列间距12px；外框1px solid #C9C9C9；标题左上12px / bold / 16px / #191919，padding 8px×12px；标题下8px处绘1px #C9C9C9分隔线；列表距线8px、水平padding12px、项间4px |

右侧每项为“10px圆点 + 12px/#777777标签 + 显示/隐藏图标按钮”；圆点与系列身份色一一对应。列表溢出时悬停显示滚动条，禁止常显原生轨。图例色点采用对应序列Token（`--color-chart-n`）。

## 5. 交互、动效与颜色

Tooltip、放大弹窗和关闭行为按当前任务与配置档启用；空/错/载状态必须可辨，禁止伪造数据填补。内部DOM宿主、Bridge和runtime协议见[实现与接入](integration.md)。

桌面Hover提示的卡内视觉、内容与行为采用[通用Tooltip规范](../common/tooltip.md)；卡内8px圆点不覆盖本领域图外10px图例，内部宿主协议继续遵从接入文件。

### 数据入场

数据入场时长150ms（`--chart-data-enter-duration` = `--transition-normal`），缓动ease（`--chart-data-enter-easing` = `--transition-timing-default`）；不自行改成200/300/400ms。`prefers-reduced-motion:reduce`时时长为0s。

序列节点添加`.chart-data-enter`，或使用`animation:chart-data-enter var(--chart-data-enter-duration) var(--chart-data-enter-easing) both`。Canvas/ECharts如何实现数据级动效须核对，不能把整个画布的CSS动画直接认定为序列入场。

### Token

颜色使用语义Token，禁止页内硬编码序列hex或标题灰/品牌色。下表列出Token对应值或示例，不作为页内硬编码许可；示例色不替代实际Token值。

| 用途 | Token | 值与使用边界 |
| --- | --- | --- |
| 通用序列 | `--color-chart-1`～`--color-chart-25` | 25色序列 |
| 半导体系列 | `--color-semi-chart-*` | 可替代通用chart色 |
| 晶圆底色 / 边框 | `--color-wafer-bg` / `--color-wafer-border`（`--color-wafer-*`） | 底色#F3F3F3；边框值依赖资产 |
| Pass Die | `--color-wafer-pass-die` | 示例#00FF00，实际按Token；可与chart序色Fail配合 |
| 连续RYG图例 | `--wafer-legend-gradient` | 晶圆连续渐变 |
| 主文字 | `--color-text-primary` | #191919，用于标题 |
| 次文字 / 图标 | `--color-text-secondary` / `--color-icon-secondary` | #777777 |

同图不混用不同语义色板。禁止自行替换为以下色值：`#1A73E8`、`#00BFA5`、`#FF6D00`、`#AA00FF`、`#F5F7FA`、`#1A1A2E`、`#6B7280`、`#409EFF`。

禁止页内改写CN20锁定Token：`--chart-container-*`、`--chart-data-safe-inset`、`--chart-zoom-*`。序列、功能和晶圆色各按其语义Token使用；不同图形的Token使用范围见[接入边界](integration.md#接入边界)。


# 半导体晶圆专项

仅晶圆任务读取，与[通用规则](general.md)配合。来源及接入状态同通用规则；runtime未提供时按[实现与接入](integration.md)说明可实现范围，不伪造已调用内部API。

## 几何与布局

下表记录运行时应达到的效果和来源参数，供核对；任务中通过既有API调用，不复制公式另写一套绘制逻辑。

| 部分 | 规则 |
| --- | --- |
| Notch | 圆形short缺口，非三角；默认`notch='down'`；圆心约`(cx,cy+R)`，半径`max(3,round(R×0.09))`；闭合path组合大圆弧与notch圆弧，同圆盘填色并描边 |
| Notch变体 | 密铺虚线底格可`showNotch:false` / `showDisc:false`；不造第三种几何；多Wafer对比方向一致 |
| 圆盘 | `--color-wafer-bg`填充；`--color-wafer-border`与`--wafer-border-width`描边，卡片常见1px |
| 裁切 | die中心在Rinner外或落入notch圆者不绘制，使用runtime `dieVisible` |
| Caption | Wafer ID用DOM `.wafer-map-caption`，位于SVG外上方；圆盘内不画标题 |
| 布局 | canonical尺寸400；用实际测得边长调用`waferLayout`；grid常见13×13，cell/offset由该函数计算 |
| Die | 调用`dieRectAt(layout,r,c)`，颜色按variant；`pass-green-chart`使用Pass Token与chart序色Fail；Detail/Bin建议有描边，缩略可关闭 |
| 交互 | `#chartTooltip`或Die tooltip展示坐标、state/bin、值；点击可选联动Table |
| 尺寸 | 边长clamp100–800px，Token为`--wafer-map-min-size` / `--wafer-map-max-size` |
| Die边长 | 来源公式`dieMin+(dieMax-dieMin)×(waferSize-100)/(800-100)`，`--wafer-die-min/max-size`为2–20px；通过运行时实现 |
| Slot | `.wafer-map-slot[data-wafer-map-slot]`，`aspect-ratio:1`，SVG填满slot |
| 5×5缩略 | `.wafer-grid-25`，`repeat(5,minmax(0,1fr))`；禁止`minmax(100px,1fr)`撑破inset |


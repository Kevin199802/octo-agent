import type { CustomSeriesRenderItemAPI, DefaultLabelFormatterCallbackParams, EChartsOption } from 'echarts'
import { histogram } from './transform'
import type { BoxplotInput, PreparedBoxplot } from './types'

const LEFT = 62
const RIGHT = 18
const FONT_FAMILY = 'HarmonyOS Sans SC, PingFang SC, Hiragino Sans GB, sans-serif'
export type PlotMode = 'auto' | 'density' | 'scatter'
export interface PointStyle { size: number; opacity: number; borderWidth: number }
export const DEFAULT_POINT_STYLE: PointStyle = { size: 8, opacity: 0.7, borderWidth: 0 }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

export function boxWidthFor(width: number, groupCount: number): number {
  return Math.min(60, Math.max(8, (width - LEFT - RIGHT) / groupCount * 0.55))
}

export function buildBoxplotOption(input: BoxplotInput, prepared: PreparedBoxplot, width: number, height: number, forceDefault: boolean, mode: PlotMode = 'auto', pointStyle: PointStyle = DEFAULT_POINT_STYLE, showTitle = true): EChartsOption {
  const { groups, yRange } = prepared
  const boxWidth = boxWidthFor(width, groups.length)
  const compact = !forceDefault && (mode === 'density' || (mode === 'auto' && width <= 500))
  const appliedStyle = forceDefault ? DEFAULT_POINT_STYLE : pointStyle
  const binsCount = Math.max(18, Math.min(55, Math.round(Math.max(120, height - 124) / 24) * 4))
  const axisFontSize = 12
  const series: NonNullable<EChartsOption['series']> = []

  series.push({
    type: 'boxplot', name: input.metric, z: 4, boxWidth: [boxWidth, boxWidth],
    data: groups.map(group => ({ value: group.box, itemStyle: { color: `${group.color}73`, borderColor: group.color, borderWidth: 1.5 } })),
    tooltip: { formatter: (params: DefaultLabelFormatterCallbackParams) => {
      const group = groups[params.dataIndex]
      return `${escapeHtml(group.name)}<br/>上须: ${group.box[4].toFixed(2)}<br/>Q3: ${group.box[3].toFixed(2)}<br/>中位数: ${group.box[2].toFixed(2)}<br/>Q1: ${group.box[1].toFixed(2)}<br/>下须: ${group.box[0].toFixed(2)} ${escapeHtml(input.unit)}`
    } }
  })

  groups.forEach((group, index) => {
    if (compact) {
      const bins = histogram(group.values, yRange, binsCount)
      const max = Math.max(...bins)
      series.push({
        type: 'custom', name: `${group.name} 密度`, silent: true, z: 2,
        data: bins.map((count, bin) => [index, yRange[0] + (bin + 0.5) * (yRange[1] - yRange[0]) / binsCount, count]).filter(item => item[2] > 0),
        renderItem(_params, api: CustomSeriesRenderItemAPI) {
          const center = api.coord([Number(api.value(0)), Number(api.value(1))])
          const pillWidth = Math.max(4, Number(api.value(2)) / max * boxWidth)
          const binSize = api.size?.([0, (yRange[1] - yRange[0]) / binsCount])
          const binHeight = Math.abs(Array.isArray(binSize) ? binSize[1] : 4)
          const pillHeight = Math.min(8, Math.max(2, binHeight * 0.78))
          return { type: 'rect', shape: { x: center[0] - pillWidth / 2, y: center[1] - pillHeight / 2, width: pillWidth, height: pillHeight, r: pillHeight / 2 }, style: { fill: group.color, opacity: 0.8 } }
        }
      })
    } else {
      series.push({
        type: 'custom', name: `${group.name} 原始点`, silent: true, z: 5,
        data: group.points.map(point => [index, point.value, point.jitter]),
        renderItem(_params, api: CustomSeriesRenderItemAPI) {
          const center = api.coord([Number(api.value(0)), Number(api.value(1))])
          return { type: 'circle', shape: { cx: center[0] + Number(api.value(2)) * boxWidth, cy: center[1], r: appliedStyle.size / 2 }, style: { fill: group.color, opacity: appliedStyle.opacity, stroke: group.color, lineWidth: appliedStyle.borderWidth } }
        }
      })
    }
    if (compact) series.push({ type: 'scatter', name: `${group.name} 异常值`, silent: true, z: 6, data: group.outliers.map(value => [index, value]), symbolSize: appliedStyle.size, itemStyle: { color: group.color, opacity: appliedStyle.opacity, borderColor: group.color, borderWidth: appliedStyle.borderWidth } })
  })

  return {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    title: showTitle ? { text: `${input.metric} 参数分布`, left: 16, top: 8, textStyle: { fontFamily: FONT_FAMILY, fontSize: width < 400 ? 12 : 16, lineHeight: 24, fontWeight: 'bold', color: '#191919' } } : { show: false },
    grid: { top: showTitle ? 44 : 12, left: LEFT, right: RIGHT, bottom: 76, show: true, borderColor: '#C9C9C9', borderWidth: 1, backgroundColor: '#FFFFFF' },
    tooltip: { trigger: 'item', confine: true },
    xAxis: { type: 'category', data: groups.map(group => group.name), name: input.groupLabel, nameLocation: 'middle', nameGap: 40, nameTextStyle: { fontFamily: FONT_FAMILY, fontSize: axisFontSize, lineHeight: 14, fontWeight: 'bold', color: '#191919' }, axisTick: { alignWithLabel: true }, axisLabel: { rotate: (width - LEFT - RIGHT) / groups.length < 60 ? 90 : 0, fontFamily: FONT_FAMILY, fontSize: axisFontSize, lineHeight: 14, fontWeight: 'normal', color: '#777777', interval: 0, margin: 4 }, axisLine: { lineStyle: { color: '#C9C9C9' } } },
    yAxis: { type: 'value', min: yRange[0], max: yRange[1], splitNumber: height < 350 ? 4 : 7, name: `${input.metric} (${input.unit})`, nameLocation: 'middle', nameRotate: 90, nameGap: 43, nameTextStyle: { fontFamily: FONT_FAMILY, fontSize: axisFontSize, lineHeight: 14, fontWeight: 'bold', color: '#191919' }, axisLabel: { fontFamily: FONT_FAMILY, fontSize: axisFontSize, lineHeight: 14, fontWeight: 'normal', color: '#777777', margin: 4 }, axisLine: { show: true, lineStyle: { color: '#C9C9C9' } }, splitLine: { lineStyle: { color: '#F3F3F3' } } },
    series
  }
}

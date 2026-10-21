import { describe, expect, it } from 'vitest'
import type { CustomSeriesRenderItemAPI } from 'echarts'
import { boxWidthFor, buildBoxplotOption } from './chartOptions'
import { exampleInput } from './fixtures'
import { prepareBoxplot } from './transform'

const prepared = prepareBoxplot(exampleInput)

type RenderSeries = {
  type: string
  name: string
  boxWidth?: number[]
  symbolSize?: number
  itemStyle?: { opacity?: number }
  data: unknown[]
  renderItem?: (params: never, api: CustomSeriesRenderItemAPI) => unknown
}

function seriesAt(width: number, forceDefault = false): RenderSeries[] {
  return buildBoxplotOption(exampleInput, prepared, width, 420, forceDefault).series as RenderSeries[]
}

function render(series: RenderSeries, item: number) {
  const row = series.data[item] as number[]
  const api = {
    value: (index: number) => row[index],
    coord: ([x, y]: number[]) => [100 + x * 50, y],
    size: () => [50, 5]
  } as unknown as CustomSeriesRenderItemAPI
  return series.renderItem?.({} as never, api) as { shape: Record<string, number>; style: { opacity?: number } }
}

describe('箱形图交付契约', () => {
  it('每组只绘制一个居中箱体，点云中心与箱体分类中心一致', () => {
    const series = seriesAt(640)
    const boxes = series.filter(item => item.type === 'boxplot')
    expect(boxes).toHaveLength(1)
    expect(boxes[0].data).toHaveLength(exampleInput.groups.length)
    const points = series.find(item => item.name === 'CVD-101 原始点')!
    const boxWidth = boxWidthFor(640, 4)
    const positions = points.data.map((_, index) => render(points, index).shape.cx)
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(100 - boxWidth * 0.35)
    expect(Math.max(...positions)).toBeLessThanOrEqual(100 + boxWidth * 0.35)
  })

  it('窄图的最大密度短线恰等于箱宽，同尺寸原貌恢复点云', () => {
    const compact = seriesAt(420)
    const density = compact.find(item => item.name === 'CVD-101 密度')!
    const widths = density.data.map((_, index) => render(density, index).shape.width)
    expect(Math.max(...widths)).toBeCloseTo(boxWidthFor(420, 4))
    expect(seriesAt(420, true).some(item => item.name === 'CVD-101 原始点')).toBe(true)
  })

  it('无效值不会变成零，且输入数据不被排序修改', () => {
    const values = [3, Number.NaN, 1, 2]
    const result = prepareBoxplot({ ...exampleInput, groups: [{ id: 'a', name: 'A', color: '#2070F3', values }] })
    expect(result.groups[0].values).toEqual([1, 2, 3])
    expect(values[0]).toBe(3)
  })

  it('原始点为 8px、透明度 70%；窄图异常点保留', () => {
    const series = seriesAt(640)
    const raw = series.find(item => item.name === 'CVD-101 原始点')!
    const outlier = seriesAt(420).find(item => item.name === 'CVD-101 异常值')!
    expect(render(raw, 0).shape.r * 2).toBe(8)
    expect(render(raw, 0).style.opacity).toBe(0.7)
    expect(outlier.symbolSize).toBe(8)
    expect(outlier.itemStyle?.opacity).toBe(0.7)
  })

  it('显式散点与点样式在 420px 生效，原貌覆盖样式但不变更数据', () => {
    const style = { size: 12, opacity: 0.4, borderWidth: 2 }
    const option = buildBoxplotOption(exampleInput, prepared, 420, 420, false, 'scatter', style)
    const raw = (option.series as RenderSeries[]).find(item => item.name === 'CVD-101 原始点')!
    expect(render(raw, 0).shape.r).toBe(6)
    expect(render(raw, 0).style.opacity).toBe(0.4)
    expect((option.series as RenderSeries[]).some(item => item.name === 'CVD-101 密度')).toBe(false)
    const original = buildBoxplotOption(exampleInput, prepared, 420, 420, true, 'density', style)
    expect((original.series as RenderSeries[]).some(item => item.name === 'CVD-101 原始点')).toBe(true)
  })
})

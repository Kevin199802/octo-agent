import type { BoxplotGroup, BoxplotInput, PreparedBoxplot } from './types'

function quantile(sorted: number[], p: number): number {
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * (position - lower)
}

function jitter(groupIndex: number, pointIndex: number): number {
  const x = Math.sin((groupIndex + 1) * 137 + pointIndex * 7 + 42) * 43758.5453
  return (x - Math.floor(x) - 0.5) * 0.7
}

export function prepareBoxplot(input: BoxplotInput): PreparedBoxplot {
  const groups: BoxplotGroup[] = input.groups.map((group, groupIndex) => {
    const values = group.values.filter(Number.isFinite).slice().sort((a, b) => a - b)
    if (!values.length) throw new Error(`设备 ${group.name} 没有有效数值`)
    const q1 = quantile(values, 0.25)
    const median = quantile(values, 0.5)
    const q3 = quantile(values, 0.75)
    const iqr = q3 - q1
    const lowFence = q1 - 1.5 * iqr
    const highFence = q3 + 1.5 * iqr
    return {
      ...group,
      values,
      points: values.map((value, pointIndex) => ({ value, jitter: jitter(groupIndex, pointIndex) })),
      box: [Math.max(values[0], lowFence), q1, median, q3, Math.min(values[values.length - 1], highFence)],
      outliers: values.filter(value => value < lowFence || value > highFence)
    }
  })
  if (!groups.length) throw new Error('至少需要一组设备数据')
  const low = Math.min(...groups.map(group => group.values[0]))
  const high = Math.max(...groups.map(group => group.values[group.values.length - 1]))
  const span = Math.max(1, high - low)
  return { groups, yRange: [Math.floor((low - span * 0.08) / 10) * 10, Math.ceil((high + span * 0.08) / 10) * 10] }
}

export function histogram(values: number[], yRange: [number, number], bins = 35): number[] {
  const result = Array<number>(bins).fill(0)
  for (const value of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - yRange[0]) / (yRange[1] - yRange[0]) * bins)))
    result[index]++
  }
  return result
}

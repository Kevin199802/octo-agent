export interface BoxplotGroupInput {
  id: string
  name: string
  values: number[]
  color: string
}

export interface BoxplotInput {
  metric: string
  unit: string
  groupLabel: string
  groups: BoxplotGroupInput[]
}

export interface BoxplotGroup extends BoxplotGroupInput {
  values: number[]
  points: { value: number; jitter: number }[]
  box: [number, number, number, number, number]
  outliers: number[]
}

export interface PreparedBoxplot {
  groups: BoxplotGroup[]
  yRange: [number, number]
}

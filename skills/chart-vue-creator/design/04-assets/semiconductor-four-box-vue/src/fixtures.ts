import type { BoxplotInput } from './types'

export const exampleInput: BoxplotInput = {
  metric: 'Idsat',
  unit: 'mA',
  groupLabel: '设备 (Equipment)',
  groups: ['CVD-101', 'ETCH-202', 'PVD-303', 'CMP-404'].map((name, index) => ({
    id: name,
    name,
    color: ['#2070F3', '#62B42E', '#715AFB', '#2CB8C9'][index],
    values: Array.from({ length: 400 }, (_, i) => {
      const seed = index * 137 + 42
      const random = (n: number) => {
        const x = Math.sin(n) * 43758.5453
        return x - Math.floor(x)
      }
      const u1 = random(seed + i * 3 + 1) || 0.001
      const u2 = random(seed + i * 3 + 2)
      return 100 + index * 12 + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * (10 + index * 3)
    })
  }))
}

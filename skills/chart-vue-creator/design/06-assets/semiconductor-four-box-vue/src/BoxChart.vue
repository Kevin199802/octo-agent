<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BoxplotChart, CustomChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { buildBoxplotOption, type PlotMode, type PointStyle } from './chartOptions'
import { prepareBoxplot } from './transform'
import type { BoxplotInput } from './types'

echarts.use([BoxplotChart, CustomChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(defineProps<{ input: BoxplotInput; forceDefault?: boolean; mode?: PlotMode; pointStyle?: PointStyle; showTitle?: boolean }>(), { showTitle: true })
const root = ref<HTMLElement | null>(null)
const prepared = computed(() => {
  try { return { data: prepareBoxplot(props.input), error: '' } }
  catch (error) { return { data: null, error: error instanceof Error ? error.message : '图表数据不可用' } }
})
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined

function render() {
  if (!chart || !root.value) return
  const width = root.value.clientWidth
  const height = root.value.clientHeight
  if (!width || !height) return
  chart.resize()
  if (!prepared.value.data) { chart.clear(); return }
  chart.setOption(buildBoxplotOption(props.input, prepared.value.data, width, height, props.forceDefault ?? false, props.mode, props.pointStyle, props.showTitle ?? true), true)
}

function downloadPng(filename: string): boolean {
  if (!chart || !prepared.value.data) return false
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#FFFFFF', excludeComponents: ['toolbox'] })
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}
defineExpose({ downloadPng })

onMounted(() => {
  if (!root.value) return
  chart = echarts.init(root.value)
  observer = new ResizeObserver(render)
  observer.observe(root.value)
  render()
})
watch(() => [props.input, props.forceDefault, props.mode, props.pointStyle, props.showTitle], render, { deep: true })
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <div class="chart-root">
    <div ref="root" class="box-chart" role="img" :aria-label="`${input.groups.length} 组设备 ${input.metric} 分布箱形图`" />
    <div v-if="prepared.error" class="chart-error" role="status">{{ prepared.error }}</div>
  </div>
</template>

<style scoped>
.chart-root { position: relative; width: 100%; height: 100%; }
.box-chart { width: 100%; height: 100%; background: #fff; }
.chart-error { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; color: #777; background: #fff; text-align: center; }
</style>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import BoxChart from './BoxChart.vue'
import { DEFAULT_POINT_STYLE, type PlotMode, type PointStyle } from './chartOptions'
import { exampleInput } from './fixtures'

interface Snapshot {
  id: number; x: number; y: number; width: number; height: number; z: number
  original: boolean; mode: PlotMode; pointStyle: PointStyle; stylesOpen: boolean
}
type ChartHandle = { downloadPng: (filename: string) => boolean }
const snapshots = ref<Snapshot[]>([])
const menu = ref<{ x: number; y: number; winX: number; winY: number } | null>(null)
const status = ref('')
const chartRefs = new Map<number, ChartHandle>()
let nextId = 1
let topZ = 50
let activeCleanup: (() => void) | undefined

function setChartRef(id: number, value: unknown) {
  if (value) chartRefs.set(id, value as ChartHandle)
  else chartRefs.delete(id)
}
function openMenu(event: MouseEvent) {
  event.preventDefault()
  const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 184))
  const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 48))
  menu.value = {
    x, y,
    winX: Math.max(8, Math.min(event.clientX, Math.max(8, window.innerWidth - 656))),
    winY: Math.max(8, Math.min(event.clientY, Math.max(8, window.innerHeight - 486)))
  }
}
function addSnapshot() {
  const origin = menu.value ?? { winX: 40, winY: 80 }
  snapshots.value.push({
    id: nextId++, x: origin.winX, y: origin.winY, width: 640, height: 470, z: ++topZ,
    original: false, mode: 'auto', pointStyle: { ...DEFAULT_POINT_STYLE }, stylesOpen: false
  })
  menu.value = null
  status.value = ''
}
function bringForward(snapshot: Snapshot) { snapshot.z = ++topZ }
function beginPointer(event: PointerEvent, snapshot: Snapshot, mode: 'move' | 'e' | 's' | 'se') {
  if (mode === 'move' && (event.target as HTMLElement).closest('button, label, input, select')) return
  event.preventDefault()
  bringForward(snapshot)
  activeCleanup?.()
  const startX = event.clientX
  const startY = event.clientY
  const { x, y, width, height } = snapshot
  const move = (e: PointerEvent) => {
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (mode === 'move') {
      snapshot.x = Math.max(0, x + dx)
      snapshot.y = Math.max(0, y + dy)
    } else {
      if (mode.includes('e')) snapshot.width = Math.max(400, width + dx)
      if (mode.includes('s')) snapshot.height = Math.max(360, height + dy)
    }
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    activeCleanup = undefined
  }
  activeCleanup = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
function restoreStyle(snapshot: Snapshot) {
  snapshot.mode = 'auto'
  snapshot.pointStyle = { ...DEFAULT_POINT_STYLE }
  snapshot.original = true
}
function exportSnapshot(snapshot: Snapshot) {
  try {
    const success = chartRefs.get(snapshot.id)?.downloadPng(`Idsat-4组设备-${snapshot.width}px.png`)
    status.value = success ? 'PNG 下载已启动，图片为当前图表的 2× 像素版本。' : '图表尚未就绪，稍后重试。'
  } catch {
    status.value = 'PNG 导出失败，请重试。'
  }
}
onBeforeUnmount(() => activeCleanup?.())
</script>

<template>
  <main class="page" @click="menu = null">
    <header class="intro">
      <h1>半导体报告 · 四设备箱形图</h1>
      <p>示例数据 · 在原图内右键选“截图”，拖动浮窗右边缘至 420px，编辑后导出 PNG。</p>
    </header>

    <section class="chart-card">
      <div class="card-heading">
        <span>Idsat 参数分布</span>
        <button type="button" class="small-button" @click.stop="addSnapshot">截图编辑</button>
      </div>
      <div class="main-chart" @contextmenu="openMenu"><BoxChart :input="exampleInput" :show-title="false" /></div>
    </section>

    <div v-if="menu" class="context-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop>
      <button type="button" @click="addSnapshot"><span aria-hidden="true">▣</span> 截图</button>
    </div>

    <section v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot"
      :style="{ left: `${snapshot.x}px`, top: `${snapshot.y}px`, width: `${snapshot.width}px`, height: `${snapshot.height}px`, zIndex: snapshot.z }"
      @pointerdown="bringForward(snapshot)">
      <div class="window-heading" @pointerdown="beginPointer($event, snapshot, 'move')">
        <span>截图调整 · {{ snapshot.width }}×{{ snapshot.height }}px</span>
        <label class="original-toggle" title="同尺寸显示原始散点和初始点样式">
          <span>原貌图形</span><input v-model="snapshot.original" type="checkbox" role="switch" /><span class="switch" />
        </label>
        <button class="close" type="button" aria-label="关闭快照" @click="snapshots = snapshots.filter(item => item.id !== snapshot.id)">×</button>
      </div>
      <div class="window-actions">
        <button type="button" @click="snapshot.width = 640">640px</button>
        <button type="button" @click="snapshot.width = 420">420px</button>
        <button type="button" :aria-expanded="snapshot.stylesOpen" @click="snapshot.stylesOpen = !snapshot.stylesOpen">元素设置</button>
        <button type="button" @click="restoreStyle(snapshot)">一键还原</button>
        <button type="button" class="primary" @click="exportSnapshot(snapshot)">导出 PNG</button>
      </div>
      <div class="snapshot-chart">
        <BoxChart :ref="(el) => setChartRef(snapshot.id, el)" :input="exampleInput"
          :force-default="snapshot.original" :mode="snapshot.mode" :point-style="snapshot.pointStyle" />
      </div>
      <div v-if="snapshot.stylesOpen" class="style-panel">
        <strong>图形表达</strong>
        <div class="mode-row">
          <label><input v-model="snapshot.mode" type="radio" value="auto" :disabled="snapshot.original" /> 自动</label>
          <label><input v-model="snapshot.mode" type="radio" value="density" :disabled="snapshot.original" /> 密度短线</label>
          <label><input v-model="snapshot.mode" type="radio" value="scatter" :disabled="snapshot.original" /> 散点</label>
        </div>
        <label>点大小 <output>{{ snapshot.pointStyle.size }}px</output><input v-model.number="snapshot.pointStyle.size" type="range" min="2" max="16" step="1" :disabled="snapshot.original" /></label>
        <label>透明度 <output>{{ Math.round(snapshot.pointStyle.opacity * 100) }}%</output><input v-model.number="snapshot.pointStyle.opacity" type="range" min="0.1" max="1" step="0.05" :disabled="snapshot.original" /></label>
        <label>边框 <output>{{ snapshot.pointStyle.borderWidth }}px</output><input v-model.number="snapshot.pointStyle.borderWidth" type="range" min="0" max="3" step="0.5" :disabled="snapshot.original" /></label>
        <small>密度短线按各组最大频数归一化；点设置用于散点和异常点。原貌开启时暂用初始样式。</small>
      </div>
      <div class="resize-edge east" role="separator" aria-label="拖动调整宽度" @pointerdown="beginPointer($event, snapshot, 'e')" />
      <div class="resize-edge south" role="separator" aria-label="拖动调整高度" @pointerdown="beginPointer($event, snapshot, 's')" />
      <div class="resize-edge southeast" role="separator" aria-label="拖动调整宽高" @pointerdown="beginPointer($event, snapshot, 'se')" />
    </section>
    <p v-if="status" class="status" role="status">{{ status }}</p>
  </main>
</template>

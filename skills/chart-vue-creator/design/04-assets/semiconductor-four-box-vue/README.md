# 半导体四箱体 Vue 工程骨架

仅供“半导体四箱体 + 640→420px 截图窗口”匹配任务复制、修改。示例数据、设备名和颜色映射在 `src/fixtures.ts`，必须按任务替换并标明来源。核心图表为 `src/BoxChart.vue`，数据变换和 ECharts 选项分别在 `src/transform.ts`、`src/chartOptions.ts`。演示窗口在 `src/App.vue`。

运行：`npm ci`、`npm test`、`npm run build`、`npm run dev`。在浏览器实测 640px 和 420px 容器、切换与 PNG 导出。复制后编写本项目的 `HANDOFF.md`，记录接口、规范映射、已运行证据及未验证项。本骨架只是可改代码起点，不代表新任务已通过视觉或内部组件验收。

## 接入既有工程

本目录是独立Vite骨架。接入已有脚手架时仅复用适用的组件和逻辑，遵从其目录、ECharts导入方式和依赖；不覆盖根配置、锁文件或入口。验证、预览、代码包导出使用宿主管道，本次HANDOFF放在允许的页面目录。

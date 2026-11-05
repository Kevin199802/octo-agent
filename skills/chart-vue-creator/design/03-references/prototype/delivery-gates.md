# 原型交付门槛

交付格式按入口和用户要求确定；本文件定义工程结构、验证与最终状态。

## 工程结构和执行

### 既有工程

按[承载工程规则](hosted-project.md)使用指定目录、依赖、验证门禁、预览和导出入口。验证须覆盖本次页面的实际挂载入口；不套用独立Vite结构要求。

### 新建独立默认工程

至少有 `package.json`、锁文件、`index.html`、`src` 中的Vue组件与TypeScript逻辑、`README.md`、`HANDOFF.md`。预览与交付使用同一组件。`package.json`须可解析，dependencies/devDependencies声明vue、echarts、vite、typescript，并提供test和build脚本；锁文件为package-lock.json、pnpm-lock.yaml或yarn.lock。

通过项目已有Node/包管理器执行适用的test、build等检查。结构缺少必需文件、依赖或脚本，或package.json无法解析，属于结构FAIL，应修复；执行条件不足与实际失败的判定见下节。

Python不是验证前置条件，不为此安装Python/Command Line Tools或试运行系统解释器探测。嵌入资料不依赖独立Skill的Python辅助工具；独立运行包中的辅助工具也不强制使用。

## 目标尺寸和交互

按[生成与验收](generation-review.md#任务范围与证据)检查实际容器尺寸、渲染和承诺交互；仅修改局部时检查受影响行为。案例细节按对应方法专项执行，半导体截图及四箱体案例见[专项验收](../methods/03/snapshot-evaluation.md)。发现布局或几何缺陷后修复并复查受影响尺寸。

## 结果与完成条件

- 分别记录结构、测试、编译门禁、生产构建、独立类型检查、视觉交互、图片/代码包导出及业务接入的实际结果、证据和未执行项；某个build或打包成功不代表其他检查通过。工程结果须对应最终代码；既有工程的门禁证据按[承载规则](hosted-project.md)。
- 逐项使用PASS、FAIL、未验证或不适用。已观察到偏离或命令实际失败记FAIL，修复后复查；环境不可用、依赖未安装等导致无法执行时记未验证，不能把已知失败改写为未验证。无要求的检查可记不适用。
- 适用工程结构、指定编译/构建门禁、目标尺寸和承诺交互均实际通过，才称原型已验证。缺浏览器或下载能力时可交付工程，但说明相应未验证项；内部组件或真实数据未提供时列为待接入。
- 工程交接及交付状态按[Handoff规则](handoff.md)，单文件/离线HTML按[HTML交付](html-prototype.md)。

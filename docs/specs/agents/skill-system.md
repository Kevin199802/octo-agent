# Spec — Skill 系统

> 状态:草案 · 优先级 P1 · 规模 [L] · 领域 agents
>
> 前置阅读:[learning/skill-and-mcp.md](../../learning/skill-and-mcp.md)

> **上游已实现:✗(Octo 完全自写)**
>
> opencode 后端有 skill discovery / 加载逻辑,但**未暴露任何 skill CRUD HTTP API**,也没有 skill 文件管理的 UI 组件。
> Skill 文件管理 UI(技能库页面、文件树、预览/编辑、新建向导、上传)全部是 Octo 自研任务。
> 数据层走 Electron main 进程 IPC 直接读写文件系统(`octo:skill:*` handler),opencode 后端只负责"运行 agent 时加载 skill",不参与 CRUD。

---

## 1. 背景与目标

Skill 是"可复用的 prompt + 工具 + 资源"打包,本质是给 agent 注入领域能力的标准化方式。opencode 后端**部分实现** skill discovery(URL 拉取),Octo 需要补足:

- **本地文件系统的 skill 加载与展示**
- **平台 skill / 项目 skill 的区分**
- **在线创建 skill 的向导**
- **编辑/预览 skill 内容**

参考设计师截图的"技能库"页面(平台技能 + 项目技能 + 文件树 + 预览/编辑)。

---

## 2. 不在范围

- Skill 跨用户共享 / marketplace — P3
- Skill 自动版本管理(类似 npm registry)— P3
- Skill 调试器(看 LLM 怎么用 skill)— P3
- 远程 skill 包动态更新 — P3

---

## 3. 用户故事

| ID | 故事 | 优先级 |
|---|---|---|
| U1 | 作为用户,我能在"技能库"页面看到所有平台技能和项目技能 | P1 |
| U2 | 作为用户,我能点开某个 skill 看它的文件树(skill.md / Agent / Assets / Scripts ...) | P1 |
| U3 | 作为用户,我能预览每个文件的内容(`.md` 渲染、代码高亮) | P1 |
| U4 | 作为用户,我能在线**创建一个新 skill**:填名字 + 描述 + 选模板,自动生成骨架 | P1 |
| U5 | 作为用户,我能编辑 skill 的文件(prompt、references 文档) | P1 |
| U6 | 作为用户,我能上传整个 skill 包(zip 或目录)到平台/项目级 | P2 |
| U7 | 作为用户,我能将平台 skill"复制为项目 skill"以便定制 | P2 |
| U8 | 作为用户,我能从 URL 拉远程 skill 包(opencode 已支持) | P2 |
| U9 | 作为用户,我能把 skill 关联到某个 agent(让 agent 默认带上这个 skill) | P2 |
| U10 | 作为用户,我能删除 skill(确认对话框) | P1 |

---

## 4. Skill 包结构

参考设计师截图的"鸿蒙规范生成":

```
<skill-name>/
├── skill.md                    # 必需:描述 skill,LLM 看
├── README.md                   # 可选:给用户看
├── Agent/                      # 可选:prompt 增强(opencode 默认会读)
│   └── system-prompt.md
├── Assets/                     # 可选:静态资源(token、模板等)
│   └── tokens.json
├── references/                 # 可选:领域知识文档
│   └── harmony-guidelines.md
├── Agents/                     # 可选:子 agent 配置
│   └── agent-config.json
├── Scripts/                    # 可选:本地脚本工具
│   └── validate.ts
└── eval-viewer/                # 可选:评估/演示子目录
    └── ...
```

### 4.1 `skill.md` 格式

```markdown
---
name: 鸿蒙规范生成
description: 面向 HarmonyOS 场景的视觉与组件规范生成能力
version: 1.0.0
when_to_use: |
  当用户需要为 HarmonyOS 应用生成 UI 规范、组件设计、token 体系时使用。
  典型触发:用户提到"鸿蒙"、"HarmonyOS"、"ArkUI"、"鸿蒙规范"。
tools:
  - validate                   # 引用 Scripts/validate.ts
references:
  - harmony-guidelines.md      # 引用 references/
---

# 鸿蒙规范生成

## 能力
- 生成符合鸿蒙规范的组件设计
- 校验设计是否符合规范
- 输出鸿蒙 token 体系

## 工作流
1. 接收用户的 UI 需求
2. 查 references/harmony-guidelines.md 找匹配规范
3. 生成组件 / 校验 / 返回结果
```

### 4.2 平台 skill vs 项目 skill 路径

| 类型 | 位置 | 范围 |
|---|---|---|
| 平台 skill | `~/.config/octo/skills/<skill-name>/` | 所有项目可用 |
| 项目 skill | `<project>/.octo/skills/<skill-name>/` | 仅当前项目 |

同名时项目级覆盖平台级。

---

## 5. UI 交互

### 5.1 技能库页面整体布局

参考设计师截图,左栏 + 右栏,左栏是 skill 列表(分平台/项目 tab),右栏是详情:

```
┌─ 技能库 ────────────────────────────────────────────────┐
│  [ 平台技能 ]  [ 项目技能 ]                  [↑ 上传 ]   │
│                                                         │
│  ┌─ Skill 列表 ──┐  ┌─ Skill 详情 ─────────────────┐    │
│  │ 鸿蒙规范生成 ▾│  │  鸿蒙规范生成     [预览][编辑]│    │
│  │   skill.md   │  │  面向 HarmonyOS 场景...      │    │
│  │   Agent ▾    │  │  ─────────────────────────── │    │
│  │   Assets ▾   │  │                              │    │
│  │   ...        │  │   (选中文件的预览/编辑器)     │    │
│  │              │  │                              │    │
│  │ 研究方案设计 ▸│  │                              │    │
│  └──────────────┘  └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**列表区**:树形结构,skill 一级,文件二级。点 skill 名展开/收起。

**详情区**:

- 顶部:skill 名 + description + 操作按钮
- 主体:选中文件后渲染
  - `.md` → marked 渲染
  - `.json` → JSON 高亮
  - `.ts/.js/.py` → 代码高亮
  - `.txt` → 纯文本

### 5.2 创建 skill 向导

点 `[ + 新建 skill ]`(或顶部 `[↑ 上传]` 旁边)弹模态:

**Step 1 — 基本信息**

```
┌─ 新建 Skill (1/3) ──────────────────┐
│  名称:    [                        ]│
│  描述:    [                        ]│
│  范围:    ○ 平台 (~/.config/octo/) │
│           ● 项目 (./.octo/skills/) │
│  模板:    [ 空白 ▾ ]                │
│             空白                    │
│             领域知识库              │
│             校验工具                │
│             子 agent + 工具         │
│                                     │
│  [ 取消 ]                  [ 下一步 ]│
└─────────────────────────────────────┘
```

**Step 2 — 触发条件**

```
┌─ 新建 Skill (2/3) ──────────────────┐
│  使用时机(when_to_use):             │
│  告诉 LLM 什么时候应该用这个 skill   │
│  ┌────────────────────────────────┐ │
│  │ 当用户需要 ... 时使用           │ │
│  │                                │ │
│  └────────────────────────────────┘ │
│                                     │
│  关键词触发(可选):                  │
│  [ 鸿蒙 ] [ HarmonyOS ] [ + ]      │
│                                     │
│  [ 上一步 ]              [ 下一步 ] │
└─────────────────────────────────────┘
```

**Step 3 — 内容草稿**

```
┌─ 新建 Skill (3/3) ──────────────────┐
│  根据模板预填的 skill.md 草稿:      │
│  ┌────────────────────────────────┐ │
│  │ # 鸿蒙规范生成                  │ │
│  │ ...                            │ │
│  │ (可编辑)                        │ │
│  └────────────────────────────────┘ │
│                                     │
│  会创建以下文件结构:                 │
│  📁 ./.octo/skills/鸿蒙规范生成/    │
│     ├── skill.md                    │
│     └── references/                 │
│                                     │
│  [ 上一步 ]               [ 创建 ]  │
└─────────────────────────────────────┘
```

点创建 → 落盘 → 自动打开新 skill 的详情页。

### 5.3 编辑 skill 文件

详情区点 `[编辑]`:

- 整个文件树切换为可编辑(双击文件名重命名,右键菜单删除/新增子文件)
- 文件内容区切换为代码编辑器(简单 textarea 或 Monaco)
- 编辑后顶部显示 `● 未保存`,`Cmd+S` 保存

### 5.4 关联 skill 到 agent (P2)

详情区右上角 `[关联到 Agent]`:

```
┌─ 关联到 Agent ──────────┐
│  ☐ general              │
│  ☑ research             │  ← 该 skill 已关联到 research
│  ☐ coder                │
│  ☐ reviewer             │
│  [ 取消 ]      [ 保存 ] │
└─────────────────────────┘
```

实际效果:把 skill 名添加到 agent 配置的 `skills` 字段。

### 5.5 上传 skill 包

`[↑ 上传]` 弹文件选择:

- 支持选目录(直接拷贝整个目录到 skills 路径)
- 支持选 zip(解压后拷贝)
- 上传前**校验**:必须有 `skill.md` 且 frontmatter 合法
- 名字冲突时提示"覆盖 / 重命名"

### 5.6 从 URL 拉远程 skill (P2)

点 `[⬇ 从 URL 拉]`:

```
┌─ 从 URL 导入 Skill ─────────────────┐
│  Skill 包索引 URL:                  │
│  [ https://example.com/skills.json]│
│                                     │
│  发现的 skill:                      │
│  ☑ 鸿蒙规范生成 v1.2                │
│  ☑ 用研报告模板 v0.5                │
│  ☐ 数据可视化 v2.0                  │
│                                     │
│  [ 取消 ]              [ 下载 ]    │
└─────────────────────────────────────┘
```

调用 opencode 的 `Skill.discovery.pull(url)`。

---

## 6. 数据流

### 6.1 文件系统 → opencode → UI

opencode 启动时扫描 `~/.config/octo/skills/` 和 `<project>/.octo/skills/`,加载 skill 元数据。

**新增 API 需求**(可能需要给 opencode 加,或 UI 直接读文件系统):

- `GET /skill` — 列出所有 skill(带元数据)
- `GET /skill/:name` — 获取 skill 详情(文件列表 + 元数据)
- `GET /skill/:name/file/:path` — 读取 skill 内某个文件
- `POST /skill/:name/file/:path` — 写入文件
- `POST /skill` — 创建 skill
- `DELETE /skill/:name` — 删除

> 调研一下 opencode 是否已有相关 API。如无,可在 main 进程加 IPC handler 直接读写文件系统(不经 opencode 后端)。

### 6.2 主进程 IPC(若不依赖 opencode 后端)

简化方案:Skill 文件系统操作完全走 Electron main 进程:

```typescript
// IPC handler
"octo:skill:list"   → readdir(skillsDir) → list with frontmatter
"octo:skill:get"    → readSkillContents
"octo:skill:write"  → writeFile + 校验
"octo:skill:create" → mkdir + 写模板
"octo:skill:delete" → rmdir 确认
```

opencode 后端只负责"运行 agent 时识别并加载 skill"。

---

## 7. Skill 模板预设

新建 skill 时提供的模板(放在 octo-ui 代码里):

### 模板 1:空白

```
skill.md (frontmatter + 一段空 prompt)
```

### 模板 2:领域知识库

```
skill.md
references/
  └── knowledge-base.md  (空文件,提示用户填)
```

### 模板 3:校验工具

```
skill.md
Scripts/
  └── validate.ts  (函数签名脚手架)
```

### 模板 4:子 agent + 工具

```
skill.md
Agents/
  └── agent-config.json  (sub-agent 配置示例)
Scripts/
  └── helper.ts
```

---

## 8. 验收标准 (P1)

| # | 标准 |
|---|------|
| 1 | 技能库页面打开,平台/项目 tab 切换正常 |
| 2 | 列表能展示 `~/.config/octo/skills/` 下所有 skill,按 skill.md frontmatter 显示名称+描述 |
| 3 | 点 skill 展开文件树,文件夹可折叠 |
| 4 | 点文件预览渲染:.md 渲染、.json 高亮、.ts 代码高亮 |
| 5 | "新建 skill" 三步向导完成后,文件系统中真的创建了正确结构 |
| 6 | 编辑文件保存后,文件内容真的写入磁盘 |
| 7 | 删除 skill 弹确认,确认后文件夹被删 |
| 8 | 在 UI 中创建一个 skill,跑一个会话能让 agent 用到这个 skill(看 reasoning 里有没有引用) |
| 9 | 项目级 skill 仅在当前项目对应 session 中可见(其他项目 session 不加载) |
| 10 | skill.md frontmatter 不合法时,UI 显示警告而不是崩溃 |

---

## 9. 实现步骤建议

1. **Step 1**:main 进程加 IPC handler `octo:skill:*`(基础 CRUD)
2. **Step 2**:`packages/octo-ui/src/views/SkillsView.vue` 新建,加路由 `/skills`
3. **Step 3**:Sidebar 加"技能库"导航项
4. **Step 4**:实现 skill 列表组件(平台/项目 tab + 树形结构)
5. **Step 5**:实现详情区(顶部 metadata + 文件预览)
6. **Step 6**:实现"新建 skill"向导(3 步模态)
7. **Step 7**:实现编辑模式(textarea 或集成 Monaco)
8. **Step 8**:实现删除 + 上传(目录 / zip)
9. **Step 9**:跟 opencode 后端打通 — agent 跑会话时确实加载了 skill
10. **Step 10**:验收

---

## 10. 风险与待定

| 项 | 风险 | 缓解 |
|---|---|---|
| opencode skill API 是否完备 | 可能没有 file CRUD 的 HTTP API | 先走 main 进程文件系统,P3 看情况补 opencode API |
| skill 文件大编辑器卡顿 | references/ 里可能放几 MB 文档 | 大文件不全部加载到内存,用"按需加载" |
| 校验 skill.md frontmatter | yaml 格式错误用户不易理解 | 用 `js-yaml` 解析,错误时 UI 高亮具体行 |
| 平台 skill 删除是否影响别的项目 | 影响 | 删除前提示"将影响所有项目" |
| 在线创建脚本工具(.ts) | 无法保证脚本安全 | P1 不做脚本编辑器,只做 .md 编辑;P2 可加 |
| Skill 命名冲突 | 平台和项目同名 | 项目优先,UI 标记"覆盖了平台同名 skill" |

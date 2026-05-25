// 预置提示词配置 - 见 SPEC-INS-007 §3.1
//
// 与上游模板的差异:
// - 不走 session.prompt() 的 system 字段(消除 session 级元提示词污染)
// - 点击按钮 = 把 text 填入输入框,作为本 turn 的用户消息发送
// - 与 MCP 任务触发类 tool 1:1 对应(spec §2.2)

export type PresetPrompt = {
  id: string                  // 与 expectedTool 同名,便于追踪
  label: string               // 按钮上的短文案
  text: string                // 点击后填入输入框的文本
  expectedTool: string        // 预期调用的 MCP tool 名(本期仅用于追踪/调试日志)
  categories: string[]        // 外网将按 category 过滤;本期 octo 不读但 schema 要预留
  description?: string        // 可选 tooltip
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: "key_findings",
    label: "观点解析",
    expectedTool: "key_findings",
    categories: ["interview"],
    text: "请使用 key_findings 工具处理附件访谈材料,输出三列 Markdown 表格:访谈问题 | 用户观点 | 场景主体。",
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    expectedTool: "run_guide_analysis",
    categories: ["interview"],
    text: "请使用 run_guide_analysis 工具,按提纲对附件访谈材料做聚类分析。如果我没提供提纲,先问我要。",
  },
  {
    id: "mindmap",
    label: "思维导图",
    expectedTool: "mindmap",
    categories: ["interview"],
    text: "请使用 mindmap 工具生成思维导图,返回 JSON 我这边会自动渲染。",
  },
  {
    id: "run_usability_analysis",
    label: "可用性分析",
    expectedTool: "run_usability_analysis",
    categories: ["usability"],
    text: "请使用 run_usability_analysis 工具对附件中的可用性测试材料做分析。",
  },
]

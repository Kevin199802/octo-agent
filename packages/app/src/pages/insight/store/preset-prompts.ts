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
    label: "观点解析报告",
    expectedTool: "key_findings",
    categories: ["interview"],
    text: "请使用 key_findings 工具,基于上传的访谈逐字稿,解析用户观点并生成报告。",
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    expectedTool: "run_guide_analysis",
    categories: ["interview"],
    text: "请使用 run_guide_analysis 工具,基于上传的访谈大纲和逐字稿,聚类用户观点并生成报告。",
  },
  {
    id: "mindmap",
    label: "思维导图",
    expectedTool: "mindmap",
    categories: ["interview"],
    text: "请使用 mindmap 工具,基于上传的逐字稿,生成思维导图。",
  },
  {
    id: "run_usability_analysis",
    label: "评估问题分析",
    expectedTool: "run_usability_analysis",
    categories: ["usability"],
    text: "请使用 run_usability_analysis 工具,基于上传的任务书和逐字稿,做可用性测试分析并生成报告。",
  },
]

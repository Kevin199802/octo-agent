export type PromptTemplateId =
  | "key_findings"
  | "run_guide_analysis"
  | "mindmap"
  | "knowledge_qa"

export type PromptTemplate = {
  id: PromptTemplateId
  label: string
  group: string
  systemHint: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "key_findings",
    label: "观点解析",
    group: "访谈观点洞察",
    systemHint: `本轮使用 key_findings 工具。\n输出三列 Markdown 表格：访谈问题 | 用户观点 | 场景主体。`,
  },
  {
    id: "run_guide_analysis",
    label: "按提纲聚类",
    group: "访谈观点洞察",
    systemHint: `本轮使用 run_guide_analysis 工具。\n若用户未提供提纲，先询问后再调用。`,
  },
  {
    id: "mindmap",
    label: "思维导图",
    group: "访谈观点洞察",
    systemHint: `本轮使用 mindmap 工具，返回 JSON 直接原样输出，客户端会渲染。`,
  },
  {
    id: "knowledge_qa",
    label: "用研知识问答",
    group: "用研知识问答",
    systemHint: `本轮使用 search_reports(query=用户问题)，无需文件。\n基于检索结果回答，标注引用来源。`,
  },
]

export const DEFAULT_TEMPLATE_ID: PromptTemplateId = "key_findings"

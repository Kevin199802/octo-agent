export type PromptTemplateId =
  | "key_findings"
  | "cluster_by_outline"
  | "generate_persona"
  | "mindmap"
  | "evaluation_summary"
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
    systemHint: `本轮使用 analyze_interview(analysis_type="key_findings")。\n输出三列 Markdown 表格：访谈问题 | 用户观点 | 场景主体。`,
  },
  {
    id: "cluster_by_outline",
    label: "按提纲聚类",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="cluster_by_outline")。\n若用户未提供提纲，先询问后再调用。`,
  },
  {
    id: "generate_persona",
    label: "AI用户画像",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="generate_persona")。\n画像维度：目标与动机 | 典型行为 | 核心痛点 | 常用工具与环境。`,
  },
  {
    id: "mindmap",
    label: "思维导图",
    group: "访谈观点洞察",
    systemHint: `本轮使用 analyze_interview(analysis_type="mindmap")，返回 JSON 直接原样输出，客户端会渲染。`,
  },
  {
    id: "evaluation_summary",
    label: "评估问题整理",
    group: "评估问题整理",
    systemHint: `本轮使用 analyze_interview(analysis_type="evaluation_summary")。\n输出三列：访谈问题 | 回答摘要 | 情感倾向。`,
  },
  {
    id: "knowledge_qa",
    label: "用研知识问答",
    group: "用研知识问答",
    systemHint: `本轮使用 search_reports(query=用户问题)，无需文件。\n基于检索结果回答，标注引用来源。`,
  },
]

export const DEFAULT_TEMPLATE_ID: PromptTemplateId = "key_findings"

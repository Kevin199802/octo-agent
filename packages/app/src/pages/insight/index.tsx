import { useParams } from "@solidjs/router"

// 占位页面 — 实际内容在新对话里实现
export default function InsightPage() {
  const params = useParams()
  return (
    <div style={{ padding: "40px", color: "var(--text-base)", background: "var(--background-base)", height: "100vh" }}>
      <h1 style={{ "font-size": "20px", "margin-bottom": "12px" }}>Octo Insight</h1>
      <p style={{ color: "var(--text-weak)", "font-size": "14px" }}>
        {params.id ? `Session: ${params.id}` : "新建对话后显示 session id"}
      </p>
    </div>
  )
}

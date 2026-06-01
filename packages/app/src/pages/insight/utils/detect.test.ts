import { describe, expect, test } from "bun:test"
import { isMarkdownTable, isHTML, stripCodeFence, scanFencedHtml } from "./detect"
import { isMindmapJSON, uxrJsonToMarkdown } from "./mindmap-adapter"
import { parseMarkdownTable, tableToCSV } from "./markdown-table"

describe("isMarkdownTable", () => {
  test("识别标准 markdown 表格", () => {
    const md = `| A | B |\n|---|---|\n| 1 | 2 |`
    expect(isMarkdownTable(md)).toBe(true)
  })
  test("识别没有标准分隔行但 |>=3 的多行", () => {
    const md = `| A | B | C |\n| 1 | 2 | 3 |`
    expect(isMarkdownTable(md)).toBe(true)
  })
  test("普通文本不命中", () => {
    expect(isMarkdownTable("这是一段普通文本，没有表格。")).toBe(false)
  })
})

describe("isMindmapJSON", () => {
  test("识别 UXR 双层数组 shape", () => {
    const text = JSON.stringify([
      [{ name: "主题", children: [{ name: "子", children: [] }] }],
    ])
    expect(isMindmapJSON(text)).toBe(true)
  })
  test("识别带 json fence 的内容", () => {
    const text = '```json\n[[{"name":"主题","children":[]}]]\n```'
    expect(isMindmapJSON(text)).toBe(true)
  })
  test("识别单根对象 shape", () => {
    expect(isMindmapJSON('{"name":"主题","children":[]}')).toBe(true)
  })
  test("普通 JSON 不命中", () => {
    expect(isMindmapJSON('{"foo":"bar"}')).toBe(false)
  })
  test("非 JSON 不命中", () => {
    expect(isMindmapJSON("hello world")).toBe(false)
  })
  test("识别内网 MCP shape:[{file, mindmaps:[{name, children}]}]", () => {
    const text = JSON.stringify([
      {
        file: "downloads/mindmap_xxx/访谈纲要.docx",
        mindmaps: [
          {
            name: "用户访谈评估法提纲",
            children: [
              { name: "基本信息", children: [{ name: "部门" }] },
            ],
          },
        ],
      },
    ])
    expect(isMindmapJSON(text)).toBe(true)
  })
  test("识别多文件 shape", () => {
    const text = JSON.stringify([
      { file: "a.docx", mindmaps: [{ name: "A", children: [] }] },
      { file: "b.docx", mindmaps: [{ name: "B", children: [] }] },
    ])
    expect(isMindmapJSON(text)).toBe(true)
  })
  test("{file, mindmaps:[]} 空 mindmaps 不命中", () => {
    expect(isMindmapJSON(JSON.stringify([{ file: "a.docx", mindmaps: [] }]))).toBe(false)
  })
})

describe("isHTML", () => {
  test("识别 html fence", () => {
    expect(isHTML("```html\n<div>x</div>\n```")).toBe(true)
  })
  test("识别 doctype", () => {
    expect(isHTML("<!DOCTYPE html><html><body>x</body></html>")).toBe(true)
  })
  test("识别 <html> 标签", () => {
    expect(isHTML("<html><body>x</body></html>")).toBe(true)
  })
  test("识别富 HTML 片段（>=3 个标签）", () => {
    expect(isHTML("<div><span>a</span><span>b</span></div>")).toBe(true)
  })
  test("不识别短文本", () => {
    expect(isHTML("<div>x</div>")).toBe(false)
  })
  test("不识别 markdown 表格", () => {
    expect(isHTML("| A | B |\n|---|---|\n| 1 | 2 |")).toBe(false)
  })
})

describe("scanFencedHtml (路径 B HTML 嗅探主路径)", () => {
  test("单 part 单 fence 命中", () => {
    const html = "<!DOCTYPE html><html><body>" + "x".repeat(40) + "</body></html>"
    const parts = [{ text: `这里是说明文字。\n\`\`\`html\n${html}\n\`\`\`` }]
    const blocks = scanFencedHtml(parts)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].html).toBe(html)
    expect(blocks[0].closed).toBe(true)
    expect(blocks[0].partIndex).toBe(0)
  })

  test("单 part 内多个闭合 fence → 多个 block", () => {
    const html1 = "<div>" + "a".repeat(60) + "</div>"
    const html2 = "<section>" + "b".repeat(60) + "</section>"
    const parts = [{ text: `\`\`\`html\n${html1}\n\`\`\`\n\n中间一段。\n\n\`\`\`html\n${html2}\n\`\`\`` }]
    const blocks = scanFencedHtml(parts)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].html).toBe(html1)
    expect(blocks[1].html).toBe(html2)
  })

  test("未闭合 fence(流式中途)取到末尾,closed: false", () => {
    const html = "<div>" + "x".repeat(60) + "</div>"
    const parts = [{ text: `\`\`\`html\n${html}` }]
    const blocks = scanFencedHtml(parts)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].closed).toBe(false)
  })

  test("跨多个 part 累加", () => {
    const html1 = "<div>" + "a".repeat(60) + "</div>"
    const html2 = "<section>" + "b".repeat(60) + "</section>"
    const parts = [
      { text: `\`\`\`html\n${html1}\n\`\`\`` },
      { text: "中间纯文字 part" },
      { text: `\`\`\`html\n${html2}\n\`\`\`` },
    ]
    const blocks = scanFencedHtml(parts)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].partIndex).toBe(0)
    expect(blocks[1].partIndex).toBe(2)
  })

  test("fence 内 < 50 字符 不命中(避免空 fence)", () => {
    const parts = [{ text: "```html\n<div>x</div>\n```" }]
    expect(scanFencedHtml(parts)).toHaveLength(0)
  })

  test("无 fence 不命中", () => {
    const parts = [{ text: "<div>这只是 inline html 没 fence,不命中</div>" }]
    expect(scanFencedHtml(parts)).toHaveLength(0)
  })

  test("空 part 数组安全返回", () => {
    expect(scanFencedHtml([])).toEqual([])
  })

  test("part.text 为 undefined 安全跳过", () => {
    const parts = [{ text: undefined }, { text: "```html\n" + "<div>" + "y".repeat(60) + "</div>" + "\n```" }]
    expect(scanFencedHtml(parts)).toHaveLength(1)
  })
})

describe("stripCodeFence", () => {
  test("剥离 json fence", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  test("剥离 html fence", () => {
    expect(stripCodeFence("```html\n<div/>\n```")).toBe("<div/>")
  })
  test("无 fence 时返回 trim 后的原文", () => {
    expect(stripCodeFence("  raw text  ")).toBe("raw text")
  })
})

describe("uxrJsonToMarkdown", () => {
  test("双层数组转换为 markdown 树", () => {
    const text = JSON.stringify([
      [
        {
          name: "主题",
          children: [
            { name: "痛点", children: [{ name: "A", children: [] }] },
          ],
        },
      ],
    ])
    const md = uxrJsonToMarkdown(text)
    expect(md).toBe("# 主题\n- 痛点\n  - A")
  })
  test("空节点用占位", () => {
    const text = JSON.stringify([[{ name: "", children: [] }]])
    expect(uxrJsonToMarkdown(text)).toBe("# (空)")
  })
  test("非法 JSON 返回 null", () => {
    expect(uxrJsonToMarkdown("not json")).toBe(null)
  })
  test("空数组返回 null", () => {
    expect(uxrJsonToMarkdown("[]")).toBe(null)
  })
  test("内网 MCP { mindmaps } 形态:直接展开,不把 file 当根", () => {
    const text = JSON.stringify([
      {
        file: "downloads/xxx/访谈纲要.docx",
        mindmaps: [
          { name: "主题", children: [{ name: "痛点", children: [] }] },
        ],
      },
    ])
    expect(uxrJsonToMarkdown(text)).toBe("# 主题\n- 痛点")
  })
  test("多文件 { mindmaps } 形态:平铺所有 mindmaps 根节点", () => {
    const text = JSON.stringify([
      { file: "a.docx", mindmaps: [{ name: "A", children: [] }] },
      { file: "b.docx", mindmaps: [{ name: "B", children: [] }] },
    ])
    expect(uxrJsonToMarkdown(text)).toBe("# A\n# B")
  })
})

describe("parseMarkdownTable", () => {
  test("解析两列表格", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |"
    expect(parseMarkdownTable(md)).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ])
  })
})

describe("tableToCSV", () => {
  test("含引号的单元格被转义", () => {
    const md = `| A | B |\n|---|---|\n| he said "hi" | x |`
    expect(tableToCSV(md)).toBe(`"A","B"\n"he said ""hi""","x"`)
  })
})

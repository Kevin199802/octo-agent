import { describe, expect, test } from "bun:test"
import { isMarkdownTable, isMindmapJSON, isHTML, isPlainJSON, stripCodeFence } from "./detect"
import { uxrJsonToMarkdown } from "./mindmap-adapter"
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

describe("isPlainJSON", () => {
  test("识别普通 JSON 对象", () => {
    expect(isPlainJSON('{"foo":"bar"}')).toBe(true)
  })
  test("识别带 fence 的 JSON", () => {
    expect(isPlainJSON('```json\n{"foo":"bar"}\n```')).toBe(true)
  })
  test("非法 JSON 返回 false", () => {
    expect(isPlainJSON("hello world")).toBe(false)
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

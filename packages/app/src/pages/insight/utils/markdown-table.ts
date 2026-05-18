export function parseMarkdownTable(md: string): string[][] {
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
  return lines.map((l) => {
    const inner = l.replace(/^\|/, "").replace(/\|$/, "")
    return inner.split("|").map((c) => c.trim())
  })
}

export function tableToCSV(md: string): string {
  return parseMarkdownTable(md)
    .map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n")
}

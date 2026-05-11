import { For, createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { marked } from "marked"
import type { Tokens } from "marked"

function extractTables(md: string): Tokens.Table[] {
  try {
    const tokens = marked.lexer(md)
    return tokens.filter((t): t is Tokens.Table => t.type === "table")
  } catch {
    return []
  }
}

export function TableRenderer(props: { content: string }): JSX.Element {
  const tables = createMemo(() => extractTables(props.content))

  return (
    <div class="p-4 flex flex-col gap-6 h-full overflow-auto">
      <Show
        when={tables().length > 0}
        fallback={
          <div class="flex items-center justify-center h-32 text-sm text-[#9ca3af]">
            未检测到表格内容
          </div>
        }
      >
        <For each={tables()}>
          {(table) => (
            <div
              class="overflow-x-auto rounded-lg"
              style={{ border: "1px solid rgba(0,0,0,0.08)" }}
            >
              <table class="min-w-full text-sm border-collapse">
                <thead>
                  <tr style={{ background: "rgba(243,244,246,1)" }}>
                    <For each={table.header}>
                      {(cell) => (
                        <th
                          class="px-4 py-2.5 text-left text-xs font-semibold text-[#374151] whitespace-nowrap"
                          style={{ "border-bottom": "1px solid rgba(0,0,0,0.08)" }}
                        >
                          {cell.text}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={table.rows}>
                    {(row, i) => (
                      <tr
                        style={{
                          background: i() % 2 === 0 ? "rgba(255,255,255,1)" : "rgba(249,250,251,1)",
                        }}
                      >
                        <For each={row}>
                          {(cell) => (
                            <td
                              class="px-4 py-2.5 text-[#374151] align-top"
                              style={{ "border-bottom": "1px solid rgba(0,0,0,0.04)" }}
                            >
                              {cell.text}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

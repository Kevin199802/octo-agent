import { Popover } from "@opencode-ai/ui/popover"
import { ProjectProductSelectPanel } from "./project-product-select-panel"
import type { Domain, ProductLine, Product } from "./project-product-select-panel"
import { createSignal } from "solid-js"
import type { JSX } from "solid-js"

interface ProjectProductSelectProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  onProductConfirm?: (data: { domain?: Domain; productLine?: ProductLine; product?: Product }) => void
}

export function ProjectProductSelect(props: ProjectProductSelectProps): JSX.Element {
  const [popoverOpen, setPopoverOpen] = createSignal(false)

  const selectedLabel = () => {
    const parts = []
    if (props.domain) parts.push(props.domain.label)
    if (props.productLine) parts.push(props.productLine.label)
    if (props.product) parts.push(props.product.label)
    return parts.length ? parts.join("/") : "选择产品"
  }

  return (
    <Popover
      open={popoverOpen()}
      onOpenChange={setPopoverOpen}
      trigger={
        <>
          <span style={{ flex: "1", "text-align": "left", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{selectedLabel()}</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ "flex-shrink": "0" }}>
            <path d="M4 6L8 10L12 6" stroke="rgba(119,119,119,1)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </>
      }
      triggerAs="button"
      triggerProps={{
        style: {
          width: "220px",
          height: "40px",
          "font-size": "14px",
          "line-height": "22px",
          color: "#191919",
          background: "white",
          border: "1px solid rgba(0,0,0,0.15)",
          "border-radius": "8px",
          padding: "0 12px",
          cursor: "pointer",
          display: "inline-flex",
          "justify-content": "flex-start",
          "align-items": "center",
          gap: "4px",
        },
      }}
      placement="bottom-start"
      style={{
        width: "522px",
        "max-width": "522px",
        "max-height": "400px",
        "z-index": "60",
      }}
    >
      <ProjectProductSelectPanel
        domain={props.domain}
        productLine={props.productLine}
        product={props.product}
        onProductConfirm={(data) => {
          props.onProductConfirm?.(data)
          setPopoverOpen(false)
        }}
      />
    </Popover>
  )
}

import { ProjectProductSelect } from "./project-product-select"
import { Select } from "@opencode-ai/ui/select"
import { createStore } from "solid-js/store"
import { createEffect, createResource } from "solid-js"
import type { JSX } from "solid-js"
import type { Domain, ProductLine, Product, Version } from "./project-product-select-panel"
import { fetchVersions } from "./project-product-select-api"

interface ProjectInfoDialogContentProps {
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
  onSelectionChange?: (data: { domain?: Domain; productLine?: ProductLine; product?: Product; version?: Version }) => void
}

export function ProjectInfoDialogContent(props: ProjectInfoDialogContentProps): JSX.Element {
  const [store, setStore] = createStore({
    domain: props.domain,
    productLine: props.productLine,
    product: props.product,
    version: props.version,
  })

  const [versionOptions] = createResource(() => store.product?.id, fetchVersions)

  createEffect(() => {
    const options = versionOptions()
    if (options?.length) {
      const current = store.version
      const match = current && options.some((v) => v.value === current.value)
      setStore("version", match ? current : options[0])
    }
  })

  createEffect(() => {
    props.onSelectionChange?.({ domain: store.domain, productLine: store.productLine, product: store.product, version: store.version })
  })

  return (
    <div style={{ width: "100%", height: "40px", display: "flex", gap: "4px", "align-items": "center" }}>
      <ProjectProductSelect
        domain={store.domain}
        productLine={store.productLine}
        product={store.product}
        onProductConfirm={(data) => {
          setStore("domain", data.domain)
          setStore("productLine", data.productLine)
          setStore("product", data.product)
        }}
      />
      <Select
        class="version-select-content"
        options={versionOptions() ?? []}
        current={store.version}
        value={(o) => o.value}
        label={(o) => o.label}
        placeholder="选择版本"
        triggerStyle={{
          width: "110px",
          height: "40px",
          "border-radius": "8px",
          "font-size": "14px",
          "line-height": "22px",
          border: "1px solid rgba(0,0,0,0.15)",
          background: "white",
          color: "#191919",
        }}
        triggerProps={{
          class: "version-select-trigger",
        }}
        onSelect={(o) => o && setStore("version", o)}
      />
    </div>
  )
}

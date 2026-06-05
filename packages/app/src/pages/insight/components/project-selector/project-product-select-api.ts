import type { Domain, ProductLine, Product, Version } from "./project-product-select-panel"

export type SearchResult = {
  domain: Domain
  productLine: ProductLine
  product: Product
}

// TODO: 替换为真实接口路径 — GET /api/domains
export async function fetchDomains(): Promise<Domain[]> {
  return [
    { id: "ict", label: "ICT" },
    { id: "cloud", label: "云计算" },
    { id: "ai", label: "AI" },
  ]
}

// TODO: 替换为真实接口路径 — GET /api/product-lines?domainId={domainId}
export async function fetchProductLines(domainId: string): Promise<ProductLine[]> {
  const map: Record<string, ProductLine[]> = {
    ict: [
      { id: "cann", domainId: "ict", label: "CANN" },
      { id: "network", domainId: "ict", label: "网络" },
      { id: "storage", domainId: "ict", label: "存储" },
      { id: "server", domainId: "ict", label: "服务器" },
    ],
    cloud: [
      { id: "ecs", domainId: "cloud", label: "ECS" },
      { id: "obs", domainId: "cloud", label: "OBS" },
      { id: "vpc", domainId: "cloud", label: "VPC" },
      { id: "elb", domainId: "cloud", label: "ELB" },
    ],
    ai: [
      { id: "mindspore", domainId: "ai", label: "MindSpore" },
      { id: "modelarts", domainId: "ai", label: "ModelArts" },
      { id: "hilens", domainId: "ai", label: "HiLens" },
    ],
  }
  return map[domainId] ?? []
}

// TODO: 替换为真实接口路径 — GET /api/products?productLineId={productLineId}
export async function fetchProducts(productLineId: string): Promise<Product[]> {
  const map: Record<string, Product[]> = {
    cann: [
      { id: "pypto", productLineId: "cann", label: "PYPTO" },
      { id: "ascend", productLineId: "cann", label: "AscendCL", closed: true },
      { id: "cann-toolkit", productLineId: "cann", label: "CANN Toolkit" },
    ],
    network: [
      { id: "router", productLineId: "network", label: "路由器" },
      { id: "switch", productLineId: "network", label: "交换机", closed: true },
      { id: "firewall", productLineId: "network", label: "防火墙" },
    ],
    storage: [
      { id: "oceanstore", productLineId: "storage", label: "OceanStor" },
      { id: "fusionstorage", productLineId: "storage", label: "FusionStorage", closed: true },
    ],
    server: [
      { id: "taishan", productLineId: "server", label: "泰山服务器" },
      { id: "kunpeng", productLineId: "server", label: "鲲鹏服务器" },
    ],
    ecs: [
      { id: "ecs-main", productLineId: "ecs", label: "ECS主服务" },
      { id: "ecs-auto", productLineId: "ecs", label: "AutoScaling", closed: true },
      { id: "ecs-bare", productLineId: "ecs", label: "裸金属服务器" },
    ],
    obs: [
      { id: "obs-main", productLineId: "obs", label: "OBS主服务" },
      { id: "obs-archive", productLineId: "obs", label: "OBS归档存储" },
    ],
    vpc: [
      { id: "vpc-core", productLineId: "vpc", label: "VPC核心" },
      { id: "vpc-peering", productLineId: "vpc", label: "VPC对等连接" },
    ],
    elb: [
      { id: "elb-share", productLineId: "elb", label: "共享型ELB" },
      { id: "elb-dedicated", productLineId: "elb", label: "独享型ELB" },
    ],
    mindspore: [
      { id: "ms-lite", productLineId: "mindspore", label: "MindSpore Lite" },
      { id: "ms-full", productLineId: "mindspore", label: "MindSpore全栈", closed: true },
      { id: "ms-serving", productLineId: "mindspore", label: "MindSpore Serving" },
    ],
    modelarts: [
      { id: "ma-pro", productLineId: "modelarts", label: "ModelArts Pro", closed: true },
      { id: "ma-studio", productLineId: "modelarts", label: "ModelArts Studio" },
    ],
    hilens: [
      { id: "hilens-kit", productLineId: "hilens", label: "HiLens Kit" },
      { id: "hilens-studio", productLineId: "hilens", label: "HiLens Studio" },
    ],
  }
  return map[productLineId] ?? []
}

// TODO: 替换为真实接口路径 — GET /api/versions?productId={productId}
export async function fetchVersions(productId: string): Promise<Version[]> {
  const map: Record<string, Version[]> = {
    pypto: [
      { value: "v2612304", label: "v2612304" },
      { value: "v2612303", label: "v2612303" },
    ],
    ascend: [
      { value: "v260101", label: "v260101" },
    ],
    router: [
      { value: "v255001", label: "v255001" },
    ],
    switch: [
      { value: "v255002", label: "v255002" },
    ],
    "ecs-main": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ecs-auto": [
      { value: "v2612304", label: "v2612304" },
    ],
    "obs-main": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ms-lite": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ms-full": [
      { value: "v2612304", label: "v2612304" },
    ],
    "ma-pro": [
      { value: "v2612304", label: "v2612304" },
    ],
  }
  return map[productId] ?? [{ value: "v2612304", label: "v2612304" }]
}

// TODO: 替换为真实接口路径 — GET /api/products/search?keyword={keyword}
export async function searchProducts(keyword: string): Promise<SearchResult[]> {
  if (!keyword) return []
  const domains = await fetchDomains()
  const results: SearchResult[] = []
  for (const domain of domains) {
    const productLines = await fetchProductLines(domain.id)
    for (const productLine of productLines) {
      const products = await fetchProducts(productLine.id)
      for (const product of products) {
        if (product.label.toLowerCase().includes(keyword.toLowerCase())) {
          results.push({ domain, productLine, product })
        }
      }
    }
  }
  return results
}

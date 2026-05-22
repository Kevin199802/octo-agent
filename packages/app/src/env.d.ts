import "solid-js"

interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
  readonly OPENCODE_CHANNEL?: "dev" | "beta" | "prod"
  // Octo Insight 文件上传服务端点（spec: docs/specs/infra/file-upload.md）
  readonly VITE_OCTO_UPLOAD_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

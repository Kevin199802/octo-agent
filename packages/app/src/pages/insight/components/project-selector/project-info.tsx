import { DialogProjectOnboarding } from "./dialog-project-onboarding"
import { projectSelection } from "../../store/project-selection"
import { createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"

/**
 * ProjectInfo —— insight sidebar 左上角「项目/版本」卡片（复刻 UXAI make-tab ProjectInfo）。
 *
 * Octo 定制：选择来源从 UXAI 的 server.projects.lastSelection() 换成本地 store projectSelection()
 * （server.tsx 在「不动」区）。点击卡片打开 DialogProjectOnboarding 自渲染弹窗。
 */
export function ProjectInfo(): JSX.Element {
  const [visible, setVisible] = createSignal(false)

  const selection = () => projectSelection()
  const productName = () => selection()?.product?.label ?? ""
  const domainProductLine = () => {
    const s = selection()
    const parts = []
    if (s?.domain) parts.push(s.domain.label)
    if (s?.productLine) parts.push(s.productLine.label)
    return parts.join("/")
  }
  const versionLabel = () => selection()?.version?.label ?? ""

  return (
    <>
      <div
        style={{
          background: "rgba(0,0,0,0.03)",
          "border-radius": "12px",
          padding: "12px 16px",
          "margin": "0 4px 12px 4px",
          cursor: "pointer",
        }}
        onClick={() => setVisible(true)}
      >
        <div style={{ display: "flex", "align-items": "center" }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ "flex-shrink": "0", "margin-right": "12px" }}>
            <rect width="20" height="20" opacity="0" fill="rgb(0,0,0)" />
            <path d="M2.04166 16.1417C2.04166 16.5806 2.14999 17 2.36666 17.4C2.58888 17.8 2.88888 18.1223 3.26666 18.3667C3.64999 18.6167 4.0611 18.7417 4.49999 18.7417L13.7833 18.7417C14.65 18.7417 15.4 18.5667 16.0333 18.2167C16.6667 17.8723 17.1444 17.4139 17.4667 16.8417C17.7944 16.2695 17.9583 15.65 17.9583 14.9834L17.9583 3.8417C17.9583 3.66948 17.8944 3.52225 17.7667 3.40003C17.6444 3.27781 17.4944 3.2167 17.3167 3.2167C17.1444 3.2167 17 3.27781 16.8833 3.40003C16.7611 3.52225 16.7 3.66948 16.7 3.8417L16.7 15C16.7 15.4556 16.5861 15.8723 16.3583 16.25C16.1305 16.6278 15.8278 16.9306 15.45 17.1584C15.0722 17.3861 14.6555 17.5 14.2 17.5L4.65832 17.5C4.36388 17.5 4.1111 17.4139 3.89999 17.2417C3.68888 17.0695 3.58332 16.85 3.58332 16.5834C3.58332 16.3278 3.67221 16.1111 3.84999 15.9334C4.02777 15.75 4.24443 15.6584 4.49999 15.6584L8.59999 15.6584L13.9167 15.6834C14.2667 15.6834 14.5611 15.5584 14.8 15.3084C15.0389 15.0639 15.1583 14.775 15.1583 14.4417L15.1583 3.98337C15.1583 3.48892 15.0361 3.03059 14.7917 2.60837C14.5417 2.1917 14.2055 1.85837 13.7833 1.60837C13.3555 1.36392 12.8944 1.2417 12.4 1.2417L4.99999 1.2417C4.46666 1.2417 3.97221 1.37225 3.51666 1.63337C3.06666 1.88892 2.70832 2.24448 2.44166 2.70003C2.17499 3.15559 2.04166 3.65003 2.04166 4.18337L2.04166 16.1417ZM8.39999 2.48337L8.39999 6.18337L7.48332 5.60003C7.38888 5.53337 7.27777 5.50003 7.14999 5.50003C7.02221 5.50003 6.90555 5.53337 6.79999 5.60003L5.88332 6.18337L5.89999 2.48337L8.39999 2.48337ZM13.9167 14.4167L4.49999 14.4C4.28888 14.4 4.07777 14.4334 3.86666 14.5C3.6611 14.5667 3.47221 14.6611 3.29999 14.7834L3.29999 4.20003C3.29999 3.78892 3.42777 3.42781 3.68332 3.1167C3.93332 2.81114 4.25277 2.61114 4.64166 2.5167L4.64166 7.3167C4.64166 7.47781 4.69166 7.6167 4.79166 7.73337C4.89166 7.84448 5.01388 7.91114 5.15832 7.93337C5.30832 7.95003 5.45555 7.92503 5.59999 7.85837L7.14166 6.85837L8.69999 7.85837C8.82221 7.9417 8.95832 7.97225 9.10832 7.95003C9.26388 7.92781 9.39443 7.86392 9.49999 7.80003C9.6111 7.73337 9.69443 7.64448 9.74999 7.53337C9.80555 7.42225 9.82221 7.31114 9.79999 7.20003L9.79999 2.48337L12.4 2.48337C12.7389 2.48337 13.0305 2.59781 13.275 2.8267C13.5194 3.05559 13.6416 3.3417 13.6416 3.68337L13.6416 14.4167L13.9167 14.4167Z" fill="#2563EB"/>
          </svg>
          <div style={{ flex: "1", "min-width": "0" }}>
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
              <div style={{ "font-size": "14px", "line-height": "22px", color: "#191919", "overflow": "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{productName()}</div>
              <div style={{ display: "flex", "align-items": "center", "flex-shrink": "0", "margin-left": "2px" }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none"
                  style={{
                    transform: "rotate(-90deg)",
                    transition: "transform 200ms cubic-bezier(0.4,0,0.2,1)",
                    "flex-shrink": "0",
                  }}
                >
                  <path d="M10.0001 13.0418C10.2556 13.0418 10.4751 12.9474 10.6584 12.7585L15.4418 8.04183C15.5584 7.91961 15.6168 7.77238 15.6168 7.60016C15.6168 7.42794 15.5584 7.27516 15.4418 7.14183C15.3195 7.01961 15.1723 6.9585 15.0001 6.9585C14.8279 6.9585 14.6751 7.01961 14.5418 7.14183L10.0001 11.6585L5.44176 7.14183C5.31953 7.01961 5.17231 6.9585 5.00009 6.9585C4.82787 6.9585 4.68064 7.01961 4.55842 7.14183C4.44176 7.27516 4.38342 7.42794 4.38342 7.60016C4.38342 7.77238 4.44176 7.91961 4.55842 8.04183L9.34176 12.7585C9.52509 12.9474 9.74453 13.0418 10.0001 13.0418Z" fill="rgba(0,0,0,0.6)"/>
                </svg>
              </div>
            </div>
            <div style={{ "font-size": "12px", "line-height": "20px", color: "rgba(0,0,0,0.6)", "margin-top": "4px", display: "flex", "align-items": "center" }}>
              <span style={{ "overflow": "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{domainProductLine()}</span>
              <span style={{ display: "inline-block", "margin-left": "4px", "margin-right": "4px", width: "1px", height: "10px", background: "rgba(0,0,0,0.1)" }}></span>
              <span style={{ "overflow": "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>当前版本：{versionLabel()}</span>
            </div>
          </div>
        </div>
      </div>
      <Show when={visible()}>
        <DialogProjectOnboarding onSelect={() => setVisible(false)} />
      </Show>
    </>
  )
}

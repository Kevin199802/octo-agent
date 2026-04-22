# Spec: 构建与发布

## 状态
待验收

## 目标

1. Mac 上一条命令产出 **macOS `.dmg`** 安装包
2. Windows 上一条命令产出 **Windows `.exe`（NSIS）** 安装包
3. 版本号管理、产物命名、内网分发方式明确

---

## 1. 构建前检查

```bash
# 确认版本号
grep '"version"' packages/desktop-electron/package.json

# 确认无明文 API Key
git grep -r "sk-" -- "*.ts" "*.json"   # 应无输出

# 确认 opencode 后端已构建（打包时以 Node.js bundle 形式内嵌）
ls packages/opencode/dist/node/node.js
# 不存在则构建：
# cd packages/opencode && bun run build:node

# 确认 octo-ui 可构建
bun --cwd packages/octo-ui run build
```

---

## 2. macOS 构建

```bash
cd packages/desktop-electron
bun run build        # electron-vite build（含 octo-ui renderer）
bun run package:mac  # electron-builder --mac
```

产物：
```
dist/Octo Agent-x.y.z-arm64.dmg   (Apple Silicon)
dist/Octo Agent-x.y.z.dmg         (Intel)
```

**未签名安装**（内网分发跳过签名）：

`electron-builder.config.ts` 设置 `mac: { identity: null }`。用户首次安装若提示"身份不明的开发者"：

```bash
xattr -cr "/Applications/Octo Agent.app"
```

---

## 3. Windows 构建

在 Windows 机器上执行：

```bash
cd packages/desktop-electron
bun run build
bun run package:win
```

产物：`dist/Octo Agent Setup x.y.z.exe`

未签名会触发 SmartScreen 警告，点击"更多信息 → 仍要运行"可继续。

---

## 4. 产物命名规范

```
Octo Agent-{version}-{arch}.dmg        macOS
Octo Agent Setup {version}.exe         Windows
```

---

## 5. 版本管理

版本号单一来源：`packages/desktop-electron/package.json` 的 `version` 字段，`electron-builder` 自动读取。

发布流程：

```bash
# 1. 合并到 main
git checkout main && git pull

# 2. 手动更新 packages/desktop-electron/package.json 中的 version

# 3. 打 tag 并推送
git tag v1.0.0
git push origin v1.0.0
```

---

## 6. 内网分发结构

```
//fileserver/octo-agent/
├── latest/
│   ├── Octo Agent-1.0.0-arm64.dmg
│   └── Octo Agent Setup 1.0.0.exe
└── archive/v0.x.x/
```

---

## 7. GitHub Actions 自动构建（第二阶段）

```yaml
# .github/workflows/release.yml（待实现）
# trigger: push tag v*
# build-mac:  runs-on: macos-latest  → bun run build → package:mac → upload artifact
# build-win:  runs-on: windows-latest → bun run build → package:win → upload artifact
# 两个 job 并行，完成后汇总到 GitHub Release
```

---

## 验收条件

- [ ] `bun run package:mac` 产出 `.dmg`，全新 Mac 安装后应用正常启动
- [ ] Windows 机器 `bun run package:win` 产出 `.exe`，Windows 10/11 安装后正常启动
- [ ] 安装包内无明文 API Key
- [ ] 应用名称和图标显示为 Octo Agent 品牌

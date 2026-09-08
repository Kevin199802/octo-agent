# fastui-vue-creator 环境安装(Windows)
#
# ⚠️ 本文件必须以 **UTF-8 with BOM** 保存。
# PowerShell 5.1(Win10/11 自带的那个)读无 BOM 的 UTF-8 时按系统 ANSI 代码页解释,
# 内网即 GBK —— 下面的中文注释会被解成乱码字节,其中可能含引号/反引号,
# 直接把脚本解析坏掉,报一堆看不懂的语法错误。内网实测踩过。 —— SPEC-DES-001 §4.1 / §4.4
#
# 本脚本只负责一件事:把 portable node 弄到共享池里。
# 拿到 node 之后立刻调 setup-env.mjs —— 装 yarn、装依赖、写清单那些跨平台逻辑
# 只在 .mjs 里写一份,PowerShell 和 bash 各写一遍必然漂移。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Manifest <url|path>] [-EnvDir <路径>]
#              [-FromLocal <目录>] [-Registry <npm 源>] [-Upgrade] [-SkipNode]
#              [-Proxy <地址>]   # 默认强制直连,只有确实必须经代理才传

[CmdletBinding()]
param(
  [string]$Manifest = "",
  [string]$EnvDir = "",
  [string]$FromLocal = "",
  [string]$Registry = "",
  [switch]$Upgrade,
  [switch]$SkipNode,
  [switch]$StrictCert,
  [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # 关掉进度条,几十 MB 的下载会快很多

# PowerShell 5.1 默认只启用 TLS 1.0/1.1,而现在的服务器普遍只收 TLS 1.2+。
# 症状极具迷惑性:浏览器打开同一个 URL 完全正常,脚本这边却报"基础连接已经关闭"。
# 这一行必须在任何 Invoke-WebRequest 之前执行。
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch { }

# **强制直连**(v14,SPEC-DES-001 §4.4.8 第二批坑 1)—— 与 install.sh 的 --noproxy '*' 等价。
#
# .NET 的 WebRequest 默认会读系统/IE 的代理设置,而 PowerShell 5.1 的 Invoke-WebRequest
# 没有 -NoProxy 参数,只能把 DefaultWebProxy 整个换掉。空的 WebProxy 对象 = 谁都不经。
#
# 2026-09-08 内网在 macOS 上实测:agent 宿主进程注入了出外网的代理,NO_PROXY 配了
# 内网域名却没能生效,请求被送进 CONNECT 隧道拿到 504,首装从第一步就卡死。
# Windows 侧同样的风险来自系统代理设置,所以两边都改成显式直连。
#
# 不做"失败了自动回退走代理":那会用第二次的结果掩盖第一次失败的真实原因。
try {
  [System.Net.WebRequest]::DefaultWebProxy =
    if ($Proxy) { New-Object System.Net.WebProxy($Proxy, $true) } else { New-Object System.Net.WebProxy }
} catch { }

# 内网证书基本都是自签名的,默认放行 —— 传 -StrictCert 才严格校验。
# 这不是把完整性检查关掉了:真正的完整性判据是下载后的 sha256 比对(见下),
# 那个比 TLS 证书链更强,因为它校验的是文件内容本身而不是传输通道。
if (-not $StrictCert) {
  try {
    Add-Type -TypeDefinition @"
using System.Net;using System.Security.Cryptography.X509Certificates;
public class OctoNoCertCheck : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate c, WebRequest r, int p) { return true; }
}
"@
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object OctoNoCertCheck
  } catch { }
}

function Fail($code, $reason, $detail, $hint) {
  Write-Output "RESULT: FAIL | ${code}: ${reason}"
  # 详情单独成行:内网排查只能靠截图(SPEC-DES-001 §8.4),埋在 HINT 里容易被忽略
  if ($detail) { Write-Output "DETAIL: $detail" }
  if ($hint) { Write-Output "HINT: $hint" }
  exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

if (-not $EnvDir) {
  $EnvDir = if ($env:OCTO_FASTUI_ENV_DIR) { $env:OCTO_FASTUI_ENV_DIR }
            else { Join-Path $env:LOCALAPPDATA "OctoAgent\fastui-env" }
}
$NodeDir = Join-Path $EnvDir "node"
$NodeBin = Join-Path $NodeDir "node.exe"

# manifest 默认从 skill 的 env.manifest.json 里读(§4.4.6:URL 直接写死在那里)
if (-not $Manifest -and -not $FromLocal) {
  $em = Get-Content (Join-Path $SkillDir "references\env.manifest.json") -Raw | ConvertFrom-Json
  $Manifest = $em.manifestUrl
}

$PlatformKey = "win32-x64"
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $PlatformKey = "win32-arm64" }

$needNode = -not ($SkipNode -or ((Test-Path $NodeBin) -and $Upgrade))
if (-not $needNode) { Write-Host "[skip] 复用已有 node: $NodeBin" }

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("octo-fastui-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
try {
  # ── 取 manifest ────────────────────────────────────────────
  # **无论要不要装 node,这一段都要跑**(v14,§4.4.8 第二批坑 4)。
  # v13 把它整块放在"要装 node"的分支里,于是走 -SkipNode 时 $Registry 一直是空、
  # 不传给 setup-env,同一台机器上带不带 -SkipNode 会用两个不同的 npm 源 ——
  # npm 源的取值挂在了"要不要下载 node"这个毫不相干的条件上。
  $m = $null
  $base = ""
  if ($FromLocal) {
    $mjson = Join-Path $FromLocal "manifest.json"
    if (-not (Test-Path $mjson)) { Fail "NO_MANIFEST" "离线目录里没有 manifest.json: $mjson" $null $null }
    $m = Get-Content $mjson -Raw | ConvertFrom-Json
    $base = $FromLocal
  } elseif ($Manifest) {
    try {
      # 加时间戳破缓存 —— 服务端没设 no-store,升级后别读到旧的(§4.4.4)
      $sep = if ($Manifest.Contains("?")) { "&" } else { "?" }
      $url = $Manifest + $sep + "t=" + [DateTimeOffset]::Now.ToUnixTimeSeconds()
      # 用 Invoke-WebRequest 取原文再自己 ConvertFrom-Json:
      # 服务器没给 .json 设 Content-Type 时(内网 /design 目录就是这样),
      # Invoke-RestMethod 会把它当纯文本返回字符串,后面取 .node 就成了 $null。
      $resp = Invoke-WebRequest -Uri $url -Headers @{ "Cache-Control" = "no-cache" } -UseBasicParsing
      $m = $resp.Content | ConvertFrom-Json
      $base = $Manifest.Substring(0, $Manifest.LastIndexOf("/"))
    } catch {
      $d = $_.Exception.Message
      if ($_.Exception.InnerException) { $d += " | inner: " + $_.Exception.InnerException.Message }
      if ($needNode) {
        Fail "DOWNLOAD_FAILED" "拉不到 manifest: $Manifest" $d "已强制直连(不经代理)。若这台机器确实必须经代理才能到内网,传 -Proxy <地址>;或改用 -FromLocal <本地目录> 离线安装"
      }
      # 只是为了拿 registry 的话不阻塞:node 已经在了,registry 缺省也能继续
      Write-Host "[warn] 拉不到 manifest($d),registry 回落到本机 npm 配置"
    }
  } elseif ($needNode) {
    Fail "NO_MANIFEST" "没有 manifest 地址" $null "传 -Manifest <url> 或 -FromLocal <目录>"
  }

  # registry 从 manifest 取;命令行 -Registry 优先
  if (-not $Registry -and $m) { $Registry = $m.npmRegistry }

  # ── 下载 + 校验 + 解压 node ──────────────────────────────────
  if ($needNode) {
    if (-not $m) { Fail "NO_MANIFEST" "要装 node,但没有可用的 manifest" $null $null }
    $p = $m.node.platforms.$PlatformKey
    if (-not $p) { Fail "NO_PLATFORM_PKG" "manifest 里没有 $PlatformKey 的 node 包" $null "在 manifest.json 的 node.platforms 里补一条" }
    $strip = if ($p.stripComponents) { $p.stripComponents } else { 1 }

    $pkg = Join-Path $Tmp (Split-Path $p.file -Leaf)
    if ($FromLocal) {
      $src = Join-Path $FromLocal $p.file
      if (-not (Test-Path $src)) { Fail "NO_LOCAL_PKG" "离线目录里没有 $($p.file)" $null $null }
      Copy-Item $src $pkg
    } else {
      Write-Host "[download] $base/$($p.file)"
      try { Invoke-WebRequest -Uri "$base/$($p.file)" -OutFile $pkg }
      catch { Fail "DOWNLOAD_FAILED" "下载 node 包失败: $base/$($p.file)" $_.Exception.Message "已强制直连(不经代理)。manifest 能拉到不代表这个包也能 —— 它有几十 MB,先核对 Content-Length(§4.4.4)" }
    }

    # Get-FileHash 输出全大写,而 SHASUMS256.txt 是小写 —— 不归一化会把正确的包判成损坏
    $got = (Get-FileHash -Algorithm SHA256 $pkg).Hash.ToLower()
    $want = ("$($p.sha256)" -replace '^sha256:', '').ToLower().Trim()
    if ($want -and $got -ne $want) {
      Fail "SHA256_MISMATCH" "node 包校验失败(下载可能被截断或代理改写)" "expected=$want actual=$got" "重新投放资源后重试"
    }

    # ── 解压 ──────────────────────────────────────────────────
    # Win10 1803+ 自带 bsdtar(tar.exe),它能解 zip 且支持 --strip-components
    New-Item -ItemType Directory -Path $NodeDir -Force | Out-Null
    & tar.exe -xf $pkg -C $NodeDir --strip-components=$strip
    if ($LASTEXITCODE -ne 0) { Fail "EXTRACT_FAILED" "解压失败: $pkg" "tar exit=$LASTEXITCODE" "确认系统自带 tar.exe(Win10 1803+)" }
    if (-not (Test-Path $NodeBin)) { Fail "EXTRACT_FAILED" "解压后找不到 $NodeBin(stripComponents 可能不对)" $null $null }
    Write-Host "[node] $(& $NodeBin -v) -> $NodeDir"
  }
} finally {
  # 只删自己刚 New-Item 出来的临时目录 —— 判一下再删,别让一个空变量把删除范围放大(§5.1.2)
  if ($Tmp -and (Test-Path $Tmp)) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

# ── 交给 setup-env.mjs ────────────────────────────────────────
$argv = @((Join-Path $SkillDir "scripts\setup-env.mjs"), "--env-dir=$EnvDir")
if ($Registry) { $argv += "--registry=$Registry" }
if ($Upgrade) { $argv += "--upgrade" }
& $NodeBin @argv
exit $LASTEXITCODE

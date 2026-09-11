# fastui-vue-creator 环境安装(Windows)
#
# ⚠️ 本文件必须以 **UTF-8 with BOM** 保存。
# PowerShell 5.1(Win10/11 自带的那个)读无 BOM 的 UTF-8 时按系统 ANSI 代码页解释,
# 内网即 GBK —— 下面的中文注释会被解成乱码字节,其中可能含引号/反引号,
# 直接把脚本解析坏掉,报一堆看不懂的语法错误。内网实测踩过。 —— SPEC-DES-001 §4.1 / §4.4
#
# ⚠️ 另一条硬约束:**函数必须定义在所有调用点之前**。PowerShell 的函数是执行到
# function 语句时才注册的(不像 C# 全文件预声明),定义在调用之后会抛
# CommandNotFoundException,而且在 $ErrorActionPreference = "Stop" 下裸崩、
# 打不出 RESULT: FAIL 契约行。零成本静态检查:比较 `function Fail` 与首次 `Fail "` 的行号。
#
# 本脚本只负责一件事:把 portable node 弄到共享池里。
# 拿到 node 之后立刻调 setup-env.mjs —— 装 yarn、装依赖、写清单那些跨平台逻辑
# 只在 .mjs 里写一份,PowerShell 和 bash 各写一遍必然漂移。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Manifest <url|path>] [-EnvDir <路径>]
#              [-FromLocal <目录>] [-Registry <npm 源>] [-Upgrade] [-SkipNode]
#              [-Proxy <地址>]   # 默认强制直连,只有确实必须经代理才传
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Check   # 只探测网络,不下载、不安装

[CmdletBinding()]
param(
  [string]$Manifest = "",
  [string]$EnvDir = "",
  [string]$FromLocal = "",
  [string]$Registry = "",
  [switch]$Upgrade,
  [switch]$SkipNode,
  [switch]$StrictCert,
  [switch]$Check,
  [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # 关掉进度条,几十 MB 的下载会快很多

# ── 日志落点(v15 S5,SPEC-DES-001 §5.1.1)────────────────────────
#
# v14 这个脚本一个字都不落盘,首装失败时唯一的证据是 agent 转述的只言片语。
# 判据是「发日志就能定位」—— 所以每一行输出(契约行与过程行)都同时写进
# 与 .mjs 共用的那个日志文件。EnvDir 要先算出来,因为日志就落在它下面。
if (-not $EnvDir) {
  $EnvDir = if ($env:OCTO_FASTUI_ENV_DIR) { $env:OCTO_FASTUI_ENV_DIR }
            else { Join-Path $env:LOCALAPPDATA "OctoAgent\fastui-env" }
}
$NodeDir = Join-Path $EnvDir "node"
$NodeBin = Join-Path $NodeDir "node.exe"
$LogPath = Join-Path $EnvDir "octo-fastui.log"
$script:LogOn = $false
$script:FailCode = 0
try {
  New-Item -ItemType Directory -Path $EnvDir -Force | Out-Null
  $script:LogOn = $true
} catch {
  # 建不了目录就不落盘,但绝不能因此让安装失败
}

# 用 .NET 直写而不是 Add-Content:PS 5.1 的 -Encoding UTF8 会写 BOM,
# 而 .mjs 那边写的是无 BOM UTF-8,同一个文件里混 BOM 只会给看日志的人添乱。
function WriteLog($text) {
  if (-not $script:LogOn) { return }
  try {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($LogPath, "$text`r`n", $enc)
  } catch {
    # 落盘失败绝不能影响脚本本身
  }
}
# 过程输出:给人看(Write-Host 不进 stdout,契约行才进)
function Say($msg) { Write-Host $msg; WriteLog $msg }
# 契约行:agent 解析的就是这几行
function Emit($msg) { Write-Output $msg; WriteLog $msg }

# ⚠️ Fail 必须定义在**所有调用点之前**(见文件头第二条硬约束)。
# v14 第一版把 -Proxy 的错误处理加在了它前面,踩过一次(§4.4.8 第二批坑 5)。
function Fail($code, $reason, $detail, $hint) {
  $script:FailCode = 1
  Emit "RESULT: FAIL | ${code}: ${reason}"
  # 详情单独成行:内网排查只能靠截图(SPEC-DES-001 §8.4),埋在 HINT 里容易被忽略
  if ($detail) { Emit "DETAIL: $detail" }
  if ($hint) { Emit "HINT: $hint" }
  if ($script:LogOn) { Emit "LOG: $LogPath" }
  exit 1
}
# 用法错误与业务失败分开:退出码 2(§5.1.1)
function BadUsage($reason) {
  $script:FailCode = 2
  Emit "RESULT: FAIL | BAD_USAGE: $reason"
  if ($script:LogOn) { Emit "LOG: $LogPath" }
  exit 2
}

# 非 2xx 的响应体就是定位依据(网关/WAF 错误页的正文),必须留下来 ——
# 2026-09-09 那次 403 现象消失后无从查起,就是因为当时没存响应体。
function WebErrorDetail($err) {
  $out = @{ code = "000"; body = "" }
  $resp = $null
  if ($err.Exception.Response) { $resp = $err.Exception.Response }
  elseif ($err.Exception.InnerException -and $err.Exception.InnerException.Response) { $resp = $err.Exception.InnerException.Response }
  if ($resp) {
    try { $out.code = [int]$resp.StatusCode } catch { }
    try {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $out.body = $sr.ReadToEnd()
      $sr.Close()
    } catch { }
  }
  return $out
}
function LogBody($label, $body) {
  if (-not $body) { Say "[body] ${label}: 空"; return }
  if ($body.Length -gt 65536) { Say "[body] ${label}: $($body.Length) 字符,过大不记录原文"; return }
  Say "[body] ${label} ($($body.Length) 字符):"
  Say $body
}
function OneLine($s, $max) {
  if (-not $s) { return "" }
  $t = ($s -replace "\s+", " ").Trim()
  if ($t.Length -gt $max) { return $t.Substring(0, $max) + "…" }
  return $t
}

$argLine = ($PSBoundParameters.GetEnumerator() | ForEach-Object { "-$($_.Key) $($_.Value)" }) -join " "
WriteLog "`r`n===== $(Get-Date -Format o) install.ps1 $argLine"
if (-not $script:LogOn) { Say "[warn] 建不了 $EnvDir,本次不落盘" }

if ($Check -and $FromLocal) { BadUsage "-Check 是网络探测,不能与 -FromLocal 同用" }

# PowerShell 5.1 默认只启用 TLS 1.0/1.1,而现在的服务器普遍只收 TLS 1.2+。
# 症状极具迷惑性:浏览器打开同一个 URL 完全正常,脚本这边却报"基础连接已经关闭"。
# 这一行必须在任何 Invoke-WebRequest 之前执行。
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch { }

# **强制直连**(v14,SPEC-DES-001 §4.4.8 第二批坑 1)—— 与 install.sh 的 --noproxy '*' 等价。
#
# .NET Framework 的 WebRequest 默认读的是 **IE / 系统代理设置**(读 HTTP_PROXY 环境变量
# 那是 .NET Core 的行为),而 PowerShell 5.1 的 Invoke-WebRequest 没有 -NoProxy 参数,
# 只能把 DefaultWebProxy 整个换掉。空的 WebProxy 对象 Address 为 null、IsBypassed() 恒真 = 直连。
#
# 所以两个平台堵的**不是同一样东西**:sh 侧堵的是环境变量,这边堵的是系统设置。
# Windows 上真正会读 agent 注入的那个环境变量的是 npm —— 那条在 setup-env.mjs 的 childEnv() 里堵。
#
# 2026-09-08 内网在 macOS 上实测:agent 宿主进程注入了出外网的代理,NO_PROXY 配了
# 内网域名却没能生效,请求被送进 CONNECT 隧道拿到 504,首装从第一步就卡死。
# Windows 侧同样的风险来自系统代理设置,所以两边都改成显式直连。
#
# 不做"失败了自动回退走代理":那会用第二次的结果掩盖第一次失败的真实原因。
if ($Proxy) {
  # 解析失败必须响亮失败 —— 吞掉的话 DefaultWebProxy 会原封不动保持系统代理、
  # 脚本继续跑,日志里一个字都没有,正好违背本脚本"不掩盖第一次失败"的原则。
  try {
    [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy($Proxy, $true)
  } catch {
    Fail "BAD_PROXY" "-Proxy 的地址无法解析: $Proxy" $_.Exception.Message "形如 http://host:port"
  }
} else {
  try {
    [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
  } catch {
    # 无参构造基本不可能抛;真抛了也不该静默 —— 那意味着后面会走系统代理
    Say "[warn] 无法关闭默认代理,后续请求可能仍走系统代理: $($_.Exception.Message)"
  }
}

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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

# ── 主体整个包在 try 里(v15 S8)────────────────────────────────────
#
# 之前 manifest 读取 / ConvertFrom-Json / Split-Path 这些都在任何 try 之外,
# 在 $ErrorActionPreference = "Stop" 下任何一处抛异常都是裸崩:
# 一行 RESULT: 都没有,§8.4「截图就能定位」在那几条路上不成立。
# 这里不求精确归因,只求**任何一次失败都有契约行 + 日志路径**。
# Fail 走的是 exit,PowerShell 的流程控制不会被 catch 接住;$script:Failing 是双保险。
try {

  # manifest 默认从 skill 的 env.manifest.json 里读(§4.4.6:URL 直接写死在那里)
  if (-not $Manifest -and -not $FromLocal) {
    $emPath = Join-Path $SkillDir "references\env.manifest.json"
    try {
      $em = Get-Content $emPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $Manifest = $em.manifestUrl
    } catch {
      Fail "SKILL_MANIFEST_BROKEN" "读不了 skill 自带的 env.manifest.json" "$emPath | $($_.Exception.Message)" "确认 skill 组装完整;也可以直接传 -Manifest <url> 绕过它"
    }
  }

  $PlatformKey = "win32-x64"
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $PlatformKey = "win32-arm64" }

  # ── -Check:只探测,不下载(v15 Q10)────────────────────────────
  #
  # 为什么探测在这里、而不在 doctor.mjs 里:doctor 用 Node 的 fetch,而 fetch(undici)
  # **完全忽略 HTTP_PROXY 环境变量**;这边用的是 .NET 的 WebRequest,读的是系统代理设置。
  # 两条路根本不同,2026-09-08 于是出现 doctor 报 200、install 同时 504,
  # 诊断工具回答了另一个问题。平行实现必然漂移,所以探测就放在真正会去下载的这个脚本里,
  # **复用同一个 Invoke-WebRequest、同一套代理/证书设置、同一条 URL 拼法**。
  #
  # 探测 manifest 里**每一个平台**的包,不只是本机这个 —— 2026-09-09 踩过:
  # 只验了跑命令那台的平台,而设计师那台是 darwin-arm64,从没被验过(§4.4.4)。
  if ($Check) {
    Emit "CHECK_MODE: probe-only"
    Emit "PLATFORM_HERE: $PlatformKey"
    if ($Proxy) { Emit "PROXY_MODE: via $Proxy" } else { Emit "PROXY_MODE: direct(DefaultWebProxy 已置空)" }
    if ($StrictCert) { Emit "TLS_VERIFY: ON" } else { Emit "TLS_VERIFY: OFF(完整性靠 sha256)" }
    Emit "PS_VERSION: $($PSVersionTable.PSVersion)"
    # 本进程看到的代理变量。**Windows 上 .NET 不读它们**(读的是系统设置),
    # 但 npm/yarn 会读 —— 首装第 3 步就卡在那儿过,所以照打不误。
    # 一个都没有时也要显式打一行,否则分不清"没有代理"和"没查代理"(§4.4.9)。
    $sawProxy = $false
    foreach ($k in @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy")) {
      $v = [System.Environment]::GetEnvironmentVariable($k)
      if ($v) { Emit "PROXY_ENV_${k}: $v"; $sawProxy = $true }
    }
    if (-not $sawProxy) { Emit "PROXY_ENV: (无)" }
    # 系统代理设置是 Windows 上真正会挡住 .NET 的那一层(环境变量它不读)。
    # GetProxy 在没有代理时会把原地址原样返回,所以要比一下才知道是不是直连。
    $sysProxy = "(读不到)"
    try {
      $probeUri = [Uri]"https://example.com/"
      $viaUri = ([System.Net.WebRequest]::GetSystemWebProxy()).GetProxy($probeUri)
      $sysProxy = if ($viaUri.AbsoluteUri -eq $probeUri.AbsoluteUri) { "(直连)" } else { $viaUri.AbsoluteUri }
    } catch { }
    Emit "SYSTEM_PROXY_FOR_HTTPS: $sysProxy"

    if (-not $Manifest) { Fail "NO_MANIFEST" "没有 manifest 地址" $null "传 -Manifest <url>" }
    Emit "MANIFEST_URL: $Manifest"
    $sep = if ($Manifest.Contains("?")) { "&" } else { "?" }
    $url = $Manifest + $sep + "t=" + [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $m = $null
    try {
      $resp = Invoke-WebRequest -Uri $url -Headers @{ "Cache-Control" = "no-cache" } -UseBasicParsing -TimeoutSec 60
      $sw.Stop()
      Emit "MANIFEST_HTTP: $([int]$resp.StatusCode)"
      Emit "MANIFEST_BYTES: $($resp.Content.Length)"
      Emit "MANIFEST_MS: $($sw.ElapsedMilliseconds)"
      try {
        $m = $resp.Content | ConvertFrom-Json
      } catch {
        LogBody "manifest 正文" $resp.Content
        Fail "MANIFEST_NOT_JSON" "manifest 拿到了但不是合法 JSON(多半是代理/网关/SSO 的错误页)" (OneLine $resp.Content 200) "响应体已记进 LOG"
      }
    } catch {
      $sw.Stop()
      $d = WebErrorDetail $_
      Emit "MANIFEST_HTTP: $($d.code)"
      Emit "MANIFEST_MS: $($sw.ElapsedMilliseconds)"
      LogBody "manifest 错误响应" $d.body
      Fail "MANIFEST_UNREACHABLE" "拉不到 manifest(HTTP $($d.code))" (OneLine "$($_.Exception.Message) $($d.body)" 200) "响应体已记进 LOG。若这台机器确实必须经代理才能到内网,加 -Proxy <地址> 再跑一次 -Check 对比"
    }

    if (-not $m.node -or -not $m.node.platforms) {
      Fail "NO_PLATFORM_PKG" "manifest 里没有 node.platforms" $null "按 §4.4.5 补齐 manifest.json"
    }
    $base = $Manifest.Substring(0, $Manifest.LastIndexOf("/"))
    $bad = 0
    $total = 0
    $probeTmp = Join-Path ([System.IO.Path]::GetTempPath()) ("octo-probe-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    foreach ($prop in $m.node.platforms.PSObject.Properties) {
      $total++
      $key = $prop.Name
      $hkey = $key.ToUpper().Replace("-", "_")
      $u = "$base/$($prop.Value.file)"
      $hcode = "000"; $hlen = "?"; $htype = "?"; $gcode = "000"; $gbytes = "?"
      try {
        $hr = Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 60
        $hcode = [int]$hr.StatusCode
        if ($hr.Headers["Content-Length"]) { $hlen = $hr.Headers["Content-Length"] }
        if ($hr.Headers["Content-Type"]) { $htype = $hr.Headers["Content-Type"] }
      } catch {
        $d = WebErrorDetail $_
        $hcode = $d.code
        LogBody "$key HEAD 错误响应" $d.body
      }
      # HEAD 之外再做一次 **1 字节的 Range GET**:2026-09-09 的阻塞正是「同一个 URL
      # 浏览器/HEAD 拿得到、curl GET 403」—— 只验 HEAD 会给出一个假的全绿,
      # 那就又变成"诊断工具回答了另一个问题"。
      # ⚠️ 服务端若忽略 Range,这一步会把整包拉下来(nginx 静态文件支持 Range,正常返回 206)。
      # 拿 GET_BYTES 就能看出来,所以不藏着。
      try {
        Invoke-WebRequest -Uri $u -Headers @{ "Range" = "bytes=0-0" } -OutFile $probeTmp -UseBasicParsing -TimeoutSec 60 | Out-Null
        $gcode = "200/206"
        if (Test-Path $probeTmp) {
          $gbytes = (Get-Item $probeTmp).Length
          Remove-Item $probeTmp -Force -ErrorAction SilentlyContinue
        }
      } catch {
        $d = WebErrorDetail $_
        $gcode = $d.code
        LogBody "$key GET 错误响应" $d.body
        if (Test-Path $probeTmp) { Remove-Item $probeTmp -Force -ErrorAction SilentlyContinue }
        $bad++
      }
      Emit "ASSET_${hkey}: HEAD=$hcode GET=$gcode bytes=$gbytes len=$hlen type=$htype"
    }
    Emit "CHECKED_PLATFORMS: $total"
    if ($total -eq 0) { Fail "NO_PLATFORM_PKG" "manifest 的 node.platforms 是空的" $null "在 manifest.json 里补平台条目" }
    if ($bad -gt 0) {
      Fail "ASSET_UNREACHABLE" "$bad/$total 个平台的 node 包拉不到(见上面 ASSET_* 行)" $null "文件在不在、nginx 给没给这个扩展名配 MIME、WAF 有没有按 UA/扩展名拦 —— 这三项要内网投放侧确认(§4.4.4)"
    }
    Emit "RESULT: OK"
    Emit "NOTE: 只做了 HEAD 与 1 字节 Range GET,没有整包下载;整包完整性仍由安装时的 sha256 比对保证"
    exit 0
  }

  $needNode = -not ($SkipNode -or ((Test-Path $NodeBin) -and $Upgrade))
  if (-not $needNode) { Say "[skip] 复用已有 node: $NodeBin" }

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
      try {
        $m = Get-Content $mjson -Raw -Encoding UTF8 | ConvertFrom-Json
      } catch {
        Fail "MANIFEST_NOT_JSON" "离线目录里的 manifest.json 不是合法 JSON" "$mjson | $($_.Exception.Message)" $null
      }
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
        Say "[http] $url -> $([int]$resp.StatusCode) $($resp.Content.Length) 字节"
        try {
          $m = $resp.Content | ConvertFrom-Json
        } catch {
          # 拿到 200 却不是 JSON,现实里就是代理/网关/SSO 的错误页 —— 直接说出来,
          # 别让它拖到后面变成"$m.node 是 null"这种离根因很远的形态(§4.4.8)。
          LogBody "manifest 正文" $resp.Content
          if ($needNode) {
            Fail "MANIFEST_NOT_JSON" "manifest 拿到了但不是合法 JSON(多半是代理/网关/SSO 的错误页)" (OneLine $resp.Content 200) "响应体已记进 LOG。跑 -Check 看每个平台各是什么状态"
          }
          Say "[warn] manifest 不是 JSON,registry 回落到本机 npm 配置"
          $m = $null
        }
      } catch {
        $d = WebErrorDetail $_
        LogBody "manifest 错误响应" $d.body
        $detail = OneLine "$($_.Exception.Message) | HTTP $($d.code) | $($d.body)" 300
        if ($_.Exception.InnerException) { $detail = OneLine "$detail | inner: $($_.Exception.InnerException.Message)" 400 }
        if ($needNode) {
          Fail "DOWNLOAD_FAILED" "拉不到 manifest: $Manifest" $detail "已强制直连(不经代理),响应体已记进 LOG。先跑 -Check 看每个平台的包各是什么状态;若这台机器确实必须经代理才能到内网,传 -Proxy <地址>;或改用 -FromLocal <本地目录> 离线安装"
        }
        # 只是为了拿 registry 的话不阻塞:node 已经在了,registry 缺省也能继续
        Say "[warn] 拉不到 manifest($detail),registry 回落到本机 npm 配置"
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
        Say "[download] $base/$($p.file)"
        try { Invoke-WebRequest -Uri "$base/$($p.file)" -OutFile $pkg }
        catch {
          $d = WebErrorDetail $_
          LogBody "node 包错误响应" $d.body
          Fail "DOWNLOAD_FAILED" "下载 node 包失败: $base/$($p.file)" (OneLine "$($_.Exception.Message) | HTTP $($d.code) | $($d.body)" 300) "已强制直连(不经代理),响应体已记进 LOG。manifest 能拉到不代表这个包也能 —— 跑 -Check 逐平台对比"
        }
      }

      # Get-FileHash 输出全大写,而 SHASUMS256.txt 是小写 —— 不归一化会把正确的包判成损坏
      $got = (Get-FileHash -Algorithm SHA256 $pkg).Hash.ToLower()
      $want = ("$($p.sha256)" -replace '^sha256:', '').ToLower().Trim()
      if ($want -and $got -ne $want) {
        Fail "SHA256_MISMATCH" "node 包校验失败(下载可能被截断或代理改写)" "expected=$want actual=$got size=$((Get-Item $pkg).Length)" "重新投放资源后重试"
      }

      # ── 解压 ──────────────────────────────────────────────────
      # Win10 1803+ 自带 bsdtar(tar.exe),它能解 zip 且支持 --strip-components
      New-Item -ItemType Directory -Path $NodeDir -Force | Out-Null
      & tar.exe -xf $pkg -C $NodeDir --strip-components=$strip
      if ($LASTEXITCODE -ne 0) { Fail "EXTRACT_FAILED" "解压失败: $pkg" "tar exit=$LASTEXITCODE" "确认系统自带 tar.exe(Win10 1803+)" }
      if (-not (Test-Path $NodeBin)) { Fail "EXTRACT_FAILED" "解压后找不到 $NodeBin(stripComponents 可能不对)" $null $null }
      Say "[node] $(& $NodeBin -v) -> $NodeDir"
    }
  } finally {
    # 只删自己刚 New-Item 出来的临时目录 —— 判一下再删,别让一个空变量把删除范围放大(§5.1.2)
    if ($Tmp -and (Test-Path $Tmp)) { Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }

  # ── 交给 setup-env.mjs ────────────────────────────────────────
  $argv = @((Join-Path $SkillDir "scripts\setup-env.mjs"), "--env-dir=$EnvDir")
  if ($Registry) { $argv += "--registry=$Registry" }
  if ($Upgrade) { $argv += "--upgrade" }
  if ($Proxy) { $argv += "--proxy=$Proxy" }   # 不透传的话,逃生开关只对下载 node 那一步有效
  # 它自己会往同一个日志文件写,所以这边不转录它的输出 —— 转录了日志里就是双份。
  Say "[handoff] setup-env.mjs $($argv[1..($argv.Length-1)] -join ' ')"
  & $NodeBin @argv
  exit $LASTEXITCODE

} catch {
  # Fail 走的是 exit(PowerShell 的流程控制不进 catch),这里兜的是**没人管的异常**。
  if ($script:FailCode) { exit $script:FailCode }
  Fail "UNEXPECTED" "安装脚本意外中止" (OneLine "$($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber) 行" 300) "这条路径没有专门的错误处理,把 LOG 里这次运行的整段(从 ===== 那行起)发出来"
}

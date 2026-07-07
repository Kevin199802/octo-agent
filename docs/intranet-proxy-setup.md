# 内网终端代理配置（Windows / macOS）

让终端命令行和 Octo Agent 桌面端（webfetch 等）能访问外网。照顺序复制粘贴即可，原理与排查背景见 [learning/terminal-proxy-and-corporate-gateway.md](learning/terminal-proxy-and-corporate-gateway.md)。

## 1. 拼好你的代理地址

格式（`工号`、`编码后密码` 换成你自己的，全文只在此出现一次）：

```
http://工号:编码后密码@proxyhk.huawei.com:8080
```

密码里的**字母、数字和 `-` `_` `.` `~` 原样保留**，其余特殊字符必须替换成对应编码（只改密码部分）。密码含 `%` 时**先替换 `%`**、再替换其他字符，避免二次转义：

| 字符 | 写成 | 字符 | 写成 | 字符 | 写成 | 字符 | 写成 |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `%` | `%25` | 空格 | `%20` | `!` | `%21` | `"` | `%22` |
| `#` | `%23` | `$` | `%24` | `&` | `%26` | `'` | `%27` |
| `(` | `%28` | `)` | `%29` | `*` | `%2A` | `+` | `%2B` |
| `,` | `%2C` | `/` | `%2F` | `:` | `%3A` | `;` | `%3B` |
| `<` | `%3C` | `=` | `%3D` | `>` | `%3E` | `?` | `%3F` |
| `@` | `%40` | `[` | `%5B` | `\` | `%5C` | `]` | `%5D` |
| `^` | `%5E` | `` ` `` | `%60` | `{` | `%7B` | `\|` | `%7C` |
| `}` | `%7D` | | | | | | |

示例：密码 `abc;def` → `abc%3Bdef`；密码 `Pw@2026#1` → `Pw%402026%231`；密码 `100%safe` → `100%25safe`。

表里没有的字符（生僻符号等），自行搜索「URL 编码」（percent-encoding）对照表替换即可。

下文的 **【代理地址】** 都替换成拼好的这一串。密码轮换后记得回来更新。

## 2. Windows

1. 按 `Win` 键 → 输入 `powershell` → 回车（无需管理员）。
2. 整段复制执行（只改第一行）：

   ```powershell
   $p = '【代理地址】'
   $n = 'localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com'
   [Environment]::SetEnvironmentVariable('HTTP_PROXY',  $p, 'User')
   [Environment]::SetEnvironmentVariable('HTTPS_PROXY', $p, 'User')
   [Environment]::SetEnvironmentVariable('NO_PROXY',    $n, 'User')
   [Environment]::SetEnvironmentVariable('http_proxy',  $p, 'User')
   [Environment]::SetEnvironmentVariable('https_proxy', $p, 'User')
   [Environment]::SetEnvironmentVariable('no_proxy',    $n, 'User')
   ```

3. **关闭当前窗口，新开一个 PowerShell**，验证：

   ```powershell
   $env:HTTP_PROXY
   curl.exe --ssl-no-revoke -s https://ifconfig.me/ip
   ```

   第一条打印出代理地址、第二条返回公网 IP（如 `119.x.x.x`）即通。注意必须写 `curl.exe` 并带 `--ssl-no-revoke`。

## 3. macOS

1. `⌘ + 空格` → 输入 `终端`（或 `Terminal`）→ 回车。
2. 整段复制执行（只改第二行，【代理地址】不要加引号）：

   ```bash
   cat >> ~/.zshrc <<'EOF'
   export http_proxy=【代理地址】
   export https_proxy=$http_proxy
   export HTTP_PROXY=$http_proxy
   export HTTPS_PROXY=$http_proxy
   export no_proxy=localhost,127.0.0.1,.local,.huawei.com,.inhuawei.com
   export NO_PROXY=$no_proxy
   EOF
   ```

3. 同一窗口验证：

   ```bash
   source ~/.zshrc
   env | grep -i proxy
   curl -k -s https://ifconfig.me/ip
   ```

   第二条打印出 6 个变量、第三条返回公网 IP 即通。

## 4. 在 Octo Agent 里验证

1. **完全退出** Agent 再重开（Windows 含托盘图标；Mac 用 `⌘Q`，不是点红叉）。
2. 聊天框发送：

   > 请用 webfetch 工具抓取 https://ifconfig.me/ip ，把返回的原始内容贴给我，不要做任何加工。

3. 返回公网 IP 即完成 ✅。

## 5. 出问题速查

| 现象 | 处理 |
| --- | --- |
| 报 `407` | 密码错 / 已轮换 / 没按第 1 节转义，改对后重做第 2 或 3 节并重启 Agent |
| Windows 报 `CRYPT_E_NO_REVOCATION_CHECK` | 命令加 `--ssl-no-revoke` |
| Mac 报 `self signed certificate` | 命令加 `-k`（仅终端验证需要，Agent 不受影响） |
| 终端命令秒退无输出 | 去掉 `-s`、加 `-v` 重跑看真实报错 |
| 终端通了但 Agent 不通 | 没完全重启 Agent；仍不行则注销系统重新登录 |
| 某网站抓不到、其他正常 | 浏览器开同一网址：也打不开 → 网关封站，换源；能打开 → 找 Octo 团队 |
| 验证网址 | 统一用 `https://ifconfig.me/ip`，不要用 httpbin.org |

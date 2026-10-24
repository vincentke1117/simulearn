# 打出知帆拓展发布包 simulearn-grid-<版本>.zip（知帆拓展约定 zhifan-ext/1 §1）。
#
#   powershell -File scripts/release-ext.ps1                  # 构建前端 + 构建拓展程序（约 35 分钟）+ 拼装 + 打包
#   powershell -File scripts/release-ext.ps1 -SkipAppBuild    # 复用已有的拓展程序（packages/grid-backend/sysimage/ext/simulearn-grid）
#
# 产物在 dist/ext/（已 gitignore）。上传走知帆的 downloads-worker/sync.mjs --ext：
# 清单里的 bytes / sha256 / unpackedBytes 由它从 zip 本身算出，这里打印的数字只用于核对。
[CmdletBinding()]
param(
    [switch]$SkipWebBuild,
    [switch]$SkipAppBuild,
    [string]$OutDir = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Import-Module (Join-Path $root 'scripts\ext-package.psm1') -Force
if (-not $OutDir) { $OutDir = Join-Path $root 'dist\ext' }
$id = 'simulearn-grid'
$grid = Join-Path $root 'packages\grid-backend'
$appDir = Join-Path $grid 'sysimage\ext\simulearn-grid'

$serverJl = Get-Content -Raw -Encoding UTF8 (Join-Path $grid 'src\server.jl')
if ($serverJl -notmatch 'const EXT_VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"') { throw '在 src/server.jl 里找不到 EXT_VERSION' }
$version = $Matches[1]
Write-Host "打包 $id $version" -ForegroundColor Cyan

Push-Location $root
try {
    if (-not $SkipWebBuild) {
        & npm run build -w '@simulearn/grid-web'
        if ($LASTEXITCODE -ne 0) { throw 'grid-web 构建失败' }
    }

    if (-not $SkipAppBuild) {
        # 设计记录 D22：PackageCompiler 子进程失败时会把整个环境变量表打进日志，先剥离密钥类变量
        Get-ChildItem env: | Where-Object { $_.Name -match '(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)' } |
            ForEach-Object { Remove-Item -LiteralPath ("env:" + $_.Name) }
        # 构建的中间文件有几个 GB，放到仓库所在盘（C 盘空间常常不够）
        $tmp = Join-Path $grid 'sysimage\ext\tmp'
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        $env:TMP = $tmp
        $env:TEMP = $tmp
        & julia --startup-file=no (Join-Path $grid 'scripts\build_ext.jl') $appDir
        if ($LASTEXITCODE -ne 0) { throw '拓展程序构建失败（日志见上方输出）' }
    }
    if (-not (Test-Path (Join-Path $appDir 'bin\simulearn-grid.exe'))) { throw "找不到拓展程序：$appDir" }

    $staging = Join-Path $OutDir "$id-$version"
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    foreach ($part in 'bin', 'lib', 'libexec', 'share') {
        $src = Join-Path $appDir $part
        if (Test-Path $src) { Copy-Item -Recurse -Path $src -Destination (Join-Path $staging $part) }
    }
    Copy-Item -Recurse -Path (Join-Path $root 'packages\grid-web\dist') -Destination (Join-Path $staging 'ui')
    New-Item -ItemType Directory -Force -Path (Join-Path $staging 'examples') | Out-Null
    Get-ChildItem -File -Path (Join-Path $grid 'examples') -Filter '*.json' |
        Copy-Item -Destination (Join-Path $staging 'examples')

    & julia --project=$grid --startup-file=no (Join-Path $grid 'scripts\gen_licenses.jl') $appDir `
        (Join-Path $staging 'LICENSES\index.html') (Join-Path $root 'node_modules\@joint\core')
    if ($LASTEXITCODE -ne 0) { throw '许可清单生成失败' }

    # 约定 §1：宿主拒装含越界路径、只差大小写的重名文件的 zip
    $files = @(Get-ChildItem -Recurse -File -Path $staging)
    $relative = $files | ForEach-Object { $_.FullName.Substring($staging.Length + 1).Replace('\', '/') }
    $dupes = $relative | Group-Object { $_.ToLowerInvariant() } | Where-Object Count -gt 1
    if ($dupes) { throw ('发布包里有只差大小写的重名文件：' + (($dupes | ForEach-Object Name) -join ', ')) }
    if ($relative | Where-Object { $_ -match '(^|/)\.\.(/|$)' }) { throw '发布包里有越界路径' }
    foreach ($required in 'bin/simulearn-grid.exe', 'ui/index.html', 'LICENSES/index.html') {
        if ($relative -notcontains $required) { throw "发布包缺少 $required" }
    }

    # 条目名必须用正斜杠：.NET Framework 的 CreateFromDirectory 会写反斜杠，知帆宿主据此拒装（见 ext-package.psm1）
    $zip = Join-Path $OutDir "$id-$version.zip"
    [void](New-ForwardSlashZip -SourceDirectory $staging -ZipPath $zip)

    # 读回 zip 里实际写入的条目名，按知帆宿主 safePath 的规则逐条核对
    $entryNames = @(Get-ZipEntryNames -ZipPath $zip)
    $bad = @($entryNames | ForEach-Object { $problem = Get-ZipEntryNameProblem -Name $_; if ($problem) { "$_（$problem）" } })
    if ($bad.Count -gt 0) { throw ('zip 条目名不合约定：' + (($bad | Select-Object -First 5) -join '；')) }
    if ($entryNames.Count -ne $files.Count) { throw "zip 条目数 $($entryNames.Count) 与文件数 $($files.Count) 不一致" }
    foreach ($required in 'bin/simulearn-grid.exe', 'ui/index.html', 'LICENSES/index.html') {
        if ($entryNames -cnotcontains $required) { throw "zip 里缺少条目 $required" }
    }

    $bytes = (Get-Item $zip).Length
    $unpacked = ($files | Measure-Object -Property Length -Sum).Sum
    $sha = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
    $summary = [ordered]@{
        id = $id; version = $version; contract = 'zhifan-ext/1'; minHost = '0.11.0'
        file = "$id-$version.zip"; bytes = $bytes; unpackedBytes = $unpacked; sha256 = $sha
        entry = 'bin/simulearn-grid.exe'; licenses = 'LICENSES/index.html'; requires = @{ memoryMB = 2048 }
        files = $files.Count
    }
    $summary | ConvertTo-Json | Set-Content -Encoding UTF8 -Path (Join-Path $OutDir "$id-$version.summary.json")
    $summary | Format-List | Out-String | Write-Host
    if ($bytes -gt 300MB) {
        Write-Warning ('zip 超过 300 MB：知帆下载站用 wrangler 直传有单文件上限，要走 R2 的 S3 接口上传（约定 §1）')
    }
    Write-Host "发布包：$zip" -ForegroundColor Green
}
finally {
    Pop-Location
}

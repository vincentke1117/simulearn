# SimuLearn 一键启动：2 个 Julia 后端 + Caddy 网关
# 用法：在仓库根目录运行  powershell -File scripts/start-all.ps1
# 就绪后访问  http://127.0.0.1:8100

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Wait-Health {
    param([string]$Url, [string]$Name, [int]$TimeoutSec = 240)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Proxy $null
            if ($resp.StatusCode -eq 200) { Write-Host "  [OK] $Name" -ForegroundColor Green; return $true }
        } catch { }
        Start-Sleep -Seconds 3
    }
    Write-Host "  [超时] $Name（$Url）" -ForegroundColor Red
    return $false
}

Write-Host "启动 SimuLearn 服务栈（首启含 Julia 编译，约 1-2 分钟）..." -ForegroundColor Cyan

# 1. 配电网内核（JGDO / Oxygen, 127.0.0.1:8123）；有 sysimage 就用（启动 30s → 7s，构建见 build_sysimage.jl）
$gridSysimage = Join-Path $root 'packages\grid-backend\sysimage\grid.sysimage.dll'
$gridArgs = @('--project=packages/grid-backend', 'packages/grid-backend/scripts/serve.jl')
if (Test-Path $gridSysimage) { $gridArgs = @("-J$gridSysimage") + $gridArgs }
Start-Process julia -ArgumentList $gridArgs -WorkingDirectory $root -WindowStyle Minimized
# 2. 电路内核（JCircuitServer, 127.0.0.1:8080）
Start-Process julia -ArgumentList '--project=packages/lab-backend', 'packages/lab-backend/run_server.jl' `
    -WorkingDirectory $root -WindowStyle Minimized
# 3. 网关（Caddy, 127.0.0.1:8100）
Start-Process "$root\gateway\bin\caddy.exe" -ArgumentList 'run', '--config', 'gateway/Caddyfile' `
    -WorkingDirectory $root -WindowStyle Minimized

$ok = $true
$ok = (Wait-Health 'http://127.0.0.1:8100/' '网关 :8100') -and $ok
$ok = (Wait-Health 'http://127.0.0.1:8123/health' '配电网内核 :8123') -and $ok
$ok = (Wait-Health 'http://127.0.0.1:8080/health' '电路内核 :8080') -and $ok

if ($ok) {
    Write-Host ""
    Write-Host "SimuLearn 就绪 → http://127.0.0.1:8100" -ForegroundColor Green
    Write-Host "  电路实验室   http://127.0.0.1:8100/circuit/"
    Write-Host "  配电网实验室 http://127.0.0.1:8100/grid/"
} else {
    Write-Host "部分服务未就绪，请查看各进程窗口日志。" -ForegroundColor Yellow
}

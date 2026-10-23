[CmdletBinding()]
param(
    [string]$Root,
    [ValidateRange(1, 3600)][int]$TimeoutSec = 240
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$modulePath = Join-Path $PSScriptRoot 'stack-lifecycle.psm1'
Import-Module $modulePath -Force

$mutex = $null
$paths = $null
$ownsState = $false
$records = New-Object System.Collections.ArrayList
try {
    $mutex = Enter-StackMutex
    $paths = Get-StackPaths -Root $Root
    Assert-StackPrerequisites -Paths $paths
    Assert-NoRunningStack -StatePath $paths.StatePath
    Assert-StackPortsAvailable
    # 子进程继承本进程环境：两个内核据此校验令牌，Caddy 据此在转发时注入
    $env:SIMULEARN_TOKEN = New-StackToken
    Invoke-CaddyValidation -Paths $paths
    $launchArguments = Get-StackLaunchArguments -Paths $paths

    Write-Host '启动 SimuLearn 服务栈（首启含 Julia 编译，约 1-2 分钟）...' -ForegroundColor Cyan

    [void]$records.Add((Start-TrackedProcess -Role 'grid' -FilePath $paths.JuliaExecutable `
        -ArgumentList $launchArguments.Grid -WorkingDirectory $paths.Root -RunDirectory $paths.RunDirectory))
    Write-StackState -StatePath $paths.StatePath -Records @($records)
    $ownsState = $true

    [void]$records.Add((Start-TrackedProcess -Role 'lab' -FilePath $paths.JuliaExecutable `
        -ArgumentList $launchArguments.Lab `
        -WorkingDirectory $paths.Root -RunDirectory $paths.RunDirectory))
    Write-StackState -StatePath $paths.StatePath -Records @($records)

    [void]$records.Add((Start-TrackedProcess -Role 'gateway' -FilePath $paths.CaddyExecutable `
        -ArgumentList $launchArguments.Gateway `
        -WorkingDirectory $paths.Root -RunDirectory $paths.RunDirectory))
    Write-StackState -StatePath $paths.StatePath -Records @($records)

    $endpoints = @(
        [pscustomobject]@{ Name = 'gateway'; Url = 'http://127.0.0.1:8100/healthz' },
        [pscustomobject]@{ Name = 'lab backend through gateway'; Url = 'http://127.0.0.1:8100/api/lab/health' },
        [pscustomobject]@{ Name = 'grid backend through gateway'; Url = 'http://127.0.0.1:8100/api/grid/health' }
    )
    Wait-StackHealthy -Records @($records) -Endpoints $endpoints -TimeoutSec $TimeoutSec

    Write-Host ''
    Write-Host 'SimuLearn 就绪 → http://127.0.0.1:8100' -ForegroundColor Green
    Write-Host '  电路实验室   http://127.0.0.1:8100/circuit/'
    Write-Host '  配电网实验室 http://127.0.0.1:8100/grid/'
    Write-Host '  停止服务     powershell -File scripts/stop-all.ps1'
}
catch {
    if ($records.Count -gt 0) {
        Write-Warning '启动失败，正在回滚本次启动的进程...'
        Stop-TrackedProcesses -Records @($records)
    }
    if ($ownsState -and $null -ne $paths) { Clear-StackState -StatePath $paths.StatePath }
    throw
}
finally {
    Exit-StackMutex -Mutex $mutex
}

[CmdletBinding()]
param([string]$Root)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$modulePath = Join-Path $PSScriptRoot 'stack-lifecycle.psm1'
Import-Module $modulePath -Force

$mutex = $null
try {
    $mutex = Enter-StackMutex
    $paths = Get-StackPaths -Root $Root
    $state = Read-StackState -StatePath $paths.StatePath
    if ($null -eq $state) {
        Write-Host 'SimuLearn 服务栈未运行。'
        return
    }

    Stop-TrackedProcesses -Records @($state.processes)
    Clear-StackState -StatePath $paths.StatePath
    Write-Host 'SimuLearn 服务栈已停止。' -ForegroundColor Green
}
finally {
    Exit-StackMutex -Mutex $mutex
}

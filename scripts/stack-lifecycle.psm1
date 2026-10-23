Set-StrictMode -Version Latest

function Resolve-StackRoot {
    param([Parameter(Mandatory = $true)][string]$Root)

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "Stack root does not exist: $Root"
    }
    return (Resolve-Path -LiteralPath $Root).Path
}

function Get-StackPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$JuliaExecutable
    )

    $resolvedRoot = Resolve-StackRoot -Root $Root
    if (-not $JuliaExecutable) {
        $juliaCommand = Get-Command julia -ErrorAction SilentlyContinue
        $JuliaExecutable = if ($juliaCommand) { $juliaCommand.Source } else { $null }
    }

    $runDirectory = Join-Path $resolvedRoot 'scripts\.run'
    return [pscustomobject]@{
        Root = $resolvedRoot
        RunDirectory = $runDirectory
        StatePath = Join-Path $runDirectory 'processes.json'
        JuliaExecutable = $JuliaExecutable
        CaddyExecutable = Join-Path $resolvedRoot 'gateway\bin\caddy.exe'
        Caddyfile = Join-Path $resolvedRoot 'gateway\Caddyfile'
        LabServer = Join-Path $resolvedRoot 'packages\lab-backend\run_server.jl'
        GridServer = Join-Path $resolvedRoot 'packages\grid-backend\scripts\serve.jl'
        LabBuild = Join-Path $resolvedRoot 'packages\lab-web\dist\index.html'
        GridBuild = Join-Path $resolvedRoot 'packages\grid-web\dist\index.html'
        GatewaySite = Join-Path $resolvedRoot 'gateway\site\index.html'
    }
}

function Get-MissingStackPrerequisites {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Paths)

    $required = @(
        @('Julia executable', $Paths.JuliaExecutable),
        @('Caddy executable', $Paths.CaddyExecutable),
        @('Caddyfile', $Paths.Caddyfile),
        @('lab backend entrypoint', $Paths.LabServer),
        @('grid backend entrypoint', $Paths.GridServer),
        @('lab-web build', $Paths.LabBuild),
        @('grid-web build', $Paths.GridBuild),
        @('gateway site', $Paths.GatewaySite)
    )
    $missing = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $required) {
        if (-not $entry[1] -or -not (Test-Path -LiteralPath $entry[1] -PathType Leaf)) {
            $missing.Add([string]$entry[0])
        }
    }
    return @($missing)
}

function Assert-StackPrerequisites {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Paths)

    $missing = @(Get-MissingStackPrerequisites -Paths $Paths)
    if ($missing.Count -gt 0) {
        throw "Stack preflight failed. Missing: $($missing -join ', ')"
    }
}

function Assert-StackPortsAvailable {
    [CmdletBinding()]
    param([int[]]$Ports = @(8080, 8100, 8123))

    $occupied = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in $Ports })
    if ($occupied.Count -gt 0) {
        $details = $occupied | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) (PID $($_.OwningProcess))" }
        throw "Stack ports are already occupied: $($details -join ', ')"
    }
}

function Invoke-CaddyValidation {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Paths)

    & $Paths.CaddyExecutable validate --config $Paths.Caddyfile
    if ($LASTEXITCODE -ne 0) {
        throw "Caddy configuration validation failed with exit code $LASTEXITCODE"
    }
}

function Write-StackState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StatePath,
        [Parameter(Mandatory = $true)][object[]]$Records
    )

    $directory = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporaryPath = "$StatePath.tmp"
    try {
        $state = [ordered]@{
            version = 1
            generatedAtUtc = [DateTime]::UtcNow.ToString('o')
            processes = @($Records)
        }
        $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
        Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Read-StackState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StatePath)

    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Lifecycle state is malformed: $StatePath"
    }
    if ($null -eq $state -or $state.version -ne 1 -or $null -eq $state.processes) {
        throw "Lifecycle state has an unsupported shape: $StatePath"
    }
    foreach ($record in @($state.processes)) {
        foreach ($property in @('role', 'pid', 'startTimeUtc', 'executable', 'arguments')) {
            if ($null -eq $record.PSObject.Properties[$property]) {
                throw "Lifecycle state record is missing '$property': $StatePath"
            }
        }
    }
    return $state
}

function Test-TrackedProcessIdentity {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)]$Process
    )

    try {
        if ($null -eq $Process -or $Process.HasExited -or $Process.Id -ne [int]$Record.pid) { return $false }
        $expectedStart = [DateTime]::Parse([string]$Record.startTimeUtc).ToUniversalTime()
        $actualStart = $Process.StartTime.ToUniversalTime()
        if ([Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -ge 1) { return $false }
        $expectedPath = [IO.Path]::GetFullPath([string]$Record.executable)
        $actualPath = [IO.Path]::GetFullPath([string]$Process.Path)
        return $expectedPath.Equals($actualPath, [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Test-TrackedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Record,
        [scriptblock]$ProcessResolver = { param($id) Get-Process -Id $id -ErrorAction Stop }
    )

    try {
        $process = & $ProcessResolver ([int]$Record.pid)
        return Test-TrackedProcessIdentity -Record $Record -Process $process
    }
    catch {
        return $false
    }
}

function ConvertTo-NativeArgument {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Argument)

    if ($Argument -notmatch '[\s"]') { return $Argument }
    $escaped = $Argument -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function New-StackToken {
    # 每次启动一个随机令牌（32 字节十六进制，同 zhifan-ext/1 §2）：
    # 两个内核只认带 X-Zhifan-Ext-Token 的请求，网关转发时注入（设计记录 D17）。
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-StackLaunchArguments {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Paths)

    $grid = @('--project=packages/grid-backend', 'packages/grid-backend/scripts/serve.jl')
    $gridSysimage = Join-Path $Paths.Root 'packages\grid-backend\sysimage\grid.sysimage.dll'
    if (Test-Path -LiteralPath $gridSysimage -PathType Leaf) {
        $grid = @('-Jpackages/grid-backend/sysimage/grid.sysimage.dll') + $grid
    }
    return [pscustomobject]@{
        Grid = $grid
        Lab = @('--project=packages/lab-backend', 'packages/lab-backend/run_server.jl')
        Gateway = @('run', '--config', 'gateway/Caddyfile')
    }
}

function Start-TrackedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$RunDirectory
    )

    New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
    $stdoutPath = Join-Path $RunDirectory "$Role.out.log"
    $stderrPath = Join-Path $RunDirectory "$Role.err.log"
    $nativeArguments = @($ArgumentList | ForEach-Object { ConvertTo-NativeArgument -Argument $_ })
    $process = Start-Process -FilePath $FilePath -ArgumentList ([string]::Join(' ', $nativeArguments)) `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $process.Refresh()
    return [pscustomobject]@{
        role = $Role
        pid = $process.Id
        startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o')
        executable = [IO.Path]::GetFullPath($FilePath)
        arguments = @($ArgumentList)
    }
}

function Stop-TrackedProcesses {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object[]]$Records,
        [scriptblock]$ProcessResolver = { param($id) Get-Process -Id $id -ErrorAction Stop },
        [scriptblock]$Stopper = {
            param($process)
            Stop-Process -InputObject $process -Force -ErrorAction Stop
            Wait-Process -InputObject $process -Timeout 10 -ErrorAction SilentlyContinue
        }
    )

    for ($index = $Records.Count - 1; $index -ge 0; $index--) {
        $record = $Records[$index]
        try { $process = & $ProcessResolver ([int]$record.pid) } catch { $process = $null }
        if (-not (Test-TrackedProcessIdentity -Record $record -Process $process)) {
            Write-Warning "Skipping $($record.role) PID $($record.pid): process identity no longer matches"
            continue
        }
        & $Stopper $process
    }
}

function Assert-NoRunningStack {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StatePath)

    $state = Read-StackState -StatePath $StatePath
    if ($null -eq $state) { return }
    $running = @($state.processes | Where-Object { Test-TrackedProcess -Record $_ })
    if ($running.Count -gt 0) {
        $details = $running | ForEach-Object { "$($_.role) PID $($_.pid)" }
        throw "SimuLearn stack is already running: $($details -join ', ')"
    }
    Remove-Item -LiteralPath $StatePath -Force
}

function Wait-StackHealthy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object[]]$Records,
        [Parameter(Mandatory = $true)][object[]]$Endpoints,
        [int]$TimeoutSec = 240
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    $pending = @($Endpoints)
    while ([DateTime]::UtcNow -lt $deadline) {
        foreach ($record in $Records) {
            if (-not (Test-TrackedProcess -Record $record)) {
                throw "$($record.role) process exited before the stack became healthy (PID $($record.pid))"
            }
        }
        $pending = @($Endpoints | Where-Object {
            try {
                $response = Invoke-WebRequest -Uri $_.Url -UseBasicParsing -TimeoutSec 3 -Proxy $null
                $response.StatusCode -ne 200
            }
            catch { $true }
        })
        if ($pending.Count -eq 0) { return }
        Start-Sleep -Seconds 2
    }
    throw "Stack health deadline exceeded: $((@($pending | ForEach-Object { $_.Name })) -join ', ')"
}

function Enter-StackMutex {
    [CmdletBinding()]
    param([string]$Name = 'Local\SimuLearn.StackLifecycle')

    $mutex = New-Object Threading.Mutex($false, $Name)
    try {
        if (-not $mutex.WaitOne(0)) {
            $mutex.Dispose()
            throw 'Another SimuLearn lifecycle operation is already running'
        }
    }
    catch [Threading.AbandonedMutexException] { }
    return $mutex
}

function Exit-StackMutex {
    param($Mutex)
    if ($null -eq $Mutex) { return }
    try { $Mutex.ReleaseMutex() } catch [ApplicationException] { }
    $Mutex.Dispose()
}

function Clear-StackState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StatePath)
    if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
        Remove-Item -LiteralPath $StatePath -Force
    }
}

Export-ModuleMember -Function @(
    'Get-StackPaths',
    'Get-MissingStackPrerequisites',
    'Assert-StackPrerequisites',
    'Assert-StackPortsAvailable',
    'Invoke-CaddyValidation',
    'Write-StackState',
    'Read-StackState',
    'Test-TrackedProcess',
    'New-StackToken',
    'Get-StackLaunchArguments',
    'Start-TrackedProcess',
    'Stop-TrackedProcesses',
    'Assert-NoRunningStack',
    'Wait-StackHealthy',
    'Enter-StackMutex',
    'Exit-StackMutex',
    'Clear-StackState'
)

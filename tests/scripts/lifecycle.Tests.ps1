$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $repoRoot 'scripts\stack-lifecycle.psm1'
$startPath = Join-Path $repoRoot 'scripts\start-all.ps1'
$stopPath = Join-Path $repoRoot 'scripts\stop-all.ps1'
$caddyPath = Join-Path $repoRoot 'gateway\Caddyfile'

Describe 'SimuLearn stack lifecycle artifacts' {
    It 'provides a shared lifecycle module' {
        (Test-Path -LiteralPath $modulePath -PathType Leaf) | Should Be $true
    }

    It 'provides an idempotent stop command' {
        (Test-Path -LiteralPath $stopPath -PathType Leaf) | Should Be $true
    }

    It 'resolves the repository root after PowerShell binds omitted parameters' {
        $scripts = Join-Path $TestDrive 'scripts'
        New-Item -ItemType Directory -Force -Path $scripts | Out-Null
        Copy-Item -LiteralPath $stopPath -Destination $scripts
        Copy-Item -LiteralPath $modulePath -Destination $scripts

        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'stop-all.ps1') 2>&1

        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'SimuLearn'
    }

    It 'saves every non-ASCII PowerShell script as UTF-8 with BOM' {
        # Windows PowerShell 5.1 reads BOM-less scripts in the system ANSI code page: on English systems
        # (GitHub runners, many student PCs) UTF-8 Chinese turns into quote-like characters and breaks parsing.
        $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
        $offenders = @(Get-ChildItem -Path (Join-Path $repoRoot 'scripts'), (Join-Path $repoRoot 'tests\scripts') -Recurse -File -Include '*.ps1', '*.psm1' |
            Where-Object {
                $bytes = [IO.File]::ReadAllBytes($_.FullName)
                $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
                $nonAscii = @($bytes | Where-Object { $_ -gt 127 }).Count -gt 0
                $nonAscii -and -not $hasBom
            } | ForEach-Object { $_.Name })
        ($offenders -join ', ') | Should Be ''
    }

    It 'exposes a gateway-owned health endpoint' {
        $config = Get-Content -LiteralPath $caddyPath -Raw
        $config | Should Match 'handle /healthz'
        $config | Should Match 'respond "ok" 200'
    }
}

if (Test-Path -LiteralPath $modulePath -PathType Leaf) {
    Import-Module $modulePath -Force

    Describe 'Stack path preflight' {
        It 'reports every required artifact for an empty root' {
            $missingJulia = Join-Path $TestDrive 'julia.exe'
            $paths = Get-StackPaths -Root $TestDrive -JuliaExecutable $missingJulia
            $missing = Get-MissingStackPrerequisites -Paths $paths

            ($missing -contains 'Julia executable') | Should Be $true
            ($missing -contains 'Caddy executable') | Should Be $true
            ($missing -contains 'Caddyfile') | Should Be $true
            ($missing -contains 'lab-web build') | Should Be $true
            ($missing -contains 'grid-web build') | Should Be $true
        }

        It 'fails before creating runtime state when preflight fails' {
            $threw = $false
            try { & $startPath -Root $TestDrive -TimeoutSec 1 } catch { $threw = $true }
            $threw | Should Be $true
            (Test-Path -LiteralPath (Join-Path $TestDrive 'scripts\.run\processes.json')) | Should Be $false
        }

        It 'accepts a complete repository when no prerequisites are missing' {
            $fixtureRoot = Join-Path $TestDrive 'complete-root'
            $juliaPath = Join-Path $fixtureRoot 'tools\julia.exe'
            $requiredFiles = @(
                $juliaPath,
                (Join-Path $fixtureRoot 'gateway\bin\caddy.exe'),
                (Join-Path $fixtureRoot 'gateway\Caddyfile'),
                (Join-Path $fixtureRoot 'packages\lab-backend\run_server.jl'),
                (Join-Path $fixtureRoot 'packages\grid-backend\scripts\serve.jl'),
                (Join-Path $fixtureRoot 'packages\lab-web\dist\index.html'),
                (Join-Path $fixtureRoot 'packages\grid-web\dist\index.html'),
                (Join-Path $fixtureRoot 'gateway\site\index.html')
            )
            foreach ($file in $requiredFiles) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
                New-Item -ItemType File -Force -Path $file | Out-Null
            }
            $paths = Get-StackPaths -Root $fixtureRoot -JuliaExecutable $juliaPath

            @(Get-MissingStackPrerequisites -Paths $paths).Count | Should Be 0
            { Assert-StackPrerequisites -Paths $paths } | Should Not Throw
        }
    }

    Describe 'Atomic lifecycle state' {
        It 'round-trips tracked process records' {
            $statePath = Join-Path $TestDrive 'scripts\.run\processes.json'
            $records = @(
                [pscustomobject]@{
                    role = 'grid'
                    pid = 123
                    startTimeUtc = '2026-07-15T00:00:00.0000000Z'
                    executable = 'C:\tools\julia.exe'
                    arguments = @('--project=x', 'serve.jl')
                }
            )

            Write-StackState -StatePath $statePath -Records $records
            $state = Read-StackState -StatePath $statePath

            $state.processes.Count | Should Be 1
            $state.processes[0].role | Should Be 'grid'
            $state.processes[0].arguments[1] | Should Be 'serve.jl'
            (Test-Path -LiteralPath "$statePath.tmp") | Should Be $false
        }

        It 'rejects malformed state instead of adopting unknown processes' {
            $statePath = Join-Path $TestDrive 'scripts\.run\processes.json'
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statePath) | Out-Null
            Set-Content -LiteralPath $statePath -Value '{not-json'

            $threw = $false
            try { Read-StackState -StatePath $statePath } catch { $threw = $true }
            $threw | Should Be $true
        }
    }

    Describe 'Process identity safety' {
        $record = [pscustomobject]@{
            role = 'lab'
            pid = 42
            startTimeUtc = '2026-07-15T12:00:00.0000000Z'
            executable = 'C:\tools\julia.exe'
            arguments = @()
        }

        It 'accepts a matching pid, start time, and executable' {
            $resolver = {
                param($id)
                [pscustomobject]@{
                    Id = $id
                    StartTime = [DateTime]::Parse('2026-07-15T12:00:00Z').ToLocalTime()
                    Path = 'C:\tools\julia.exe'
                    HasExited = $false
                }
            }

            (Test-TrackedProcess -Record $record -ProcessResolver $resolver) | Should Be $true
        }

        It 'rejects pid reuse when start time does not match' {
            $resolver = {
                param($id)
                [pscustomobject]@{
                    Id = $id
                    StartTime = [DateTime]::Parse('2026-07-15T12:05:00Z').ToLocalTime()
                    Path = 'C:\tools\julia.exe'
                    HasExited = $false
                }
            }

            (Test-TrackedProcess -Record $record -ProcessResolver $resolver) | Should Be $false
        }

        It 'does not stop a process whose identity does not match' {
            $stopped = New-Object System.Collections.ArrayList
            $resolver = {
                param($id)
                [pscustomobject]@{
                    Id = $id
                    StartTime = [DateTime]::Parse('2026-07-15T12:05:00Z').ToLocalTime()
                    Path = 'C:\tools\julia.exe'
                    HasExited = $false
                }
            }
            $stopper = { param($process) [void]$stopped.Add($process.Id) }

            Stop-TrackedProcesses -Records @($record) -ProcessResolver $resolver -Stopper $stopper

            $stopped.Count | Should Be 0
        }

        It 'resolves and validates a process only once before stopping it' {
            $stopped = New-Object System.Collections.ArrayList
            $resolutions = New-Object System.Collections.ArrayList
            $resolver = {
                param($id)
                [void]$resolutions.Add($id)
                $start = if ($resolutions.Count -eq 1) { '2026-07-15T12:00:00Z' } else { '2026-07-15T12:05:00Z' }
                $path = if ($resolutions.Count -eq 1) { 'C:\tools\julia.exe' } else { 'C:\tools\other.exe' }
                [pscustomobject]@{
                    Id = $id
                    StartTime = [DateTime]::Parse($start).ToLocalTime()
                    Path = $path
                    HasExited = $false
                }
            }
            $stopper = { param($process) [void]$stopped.Add("$($process.Path)|$($process.StartTime.ToUniversalTime().ToString('o'))") }

            Stop-TrackedProcesses -Records @($record) -ProcessResolver $resolver -Stopper $stopper

            $resolutions.Count | Should Be 1
            $stopped.Count | Should Be 1
            $stopped[0] | Should Match '^C:\\tools\\julia\.exe\|2026-07-15T12:00:00'
        }

        It 'generates a fresh 32-byte hex token for every launch' {
            $first = New-StackToken
            $second = New-StackToken

            $first | Should Match '^[0-9a-f]{64}$'
            $second | Should Match '^[0-9a-f]{64}$'
            ($first -eq $second) | Should Be $false
        }

        It 'keeps launch arguments safe when the repository path contains spaces' {
            $rootWithSpaces = Join-Path $TestDrive 'repo with spaces'
            $sysimageDirectory = Join-Path $rootWithSpaces 'packages\grid-backend\sysimage'
            New-Item -ItemType Directory -Force -Path $sysimageDirectory | Out-Null
            New-Item -ItemType File -Force -Path (Join-Path $sysimageDirectory 'grid.sysimage.dll') | Out-Null
            $arguments = Get-StackLaunchArguments -Paths ([pscustomobject]@{ Root = $rootWithSpaces })

            $arguments.Grid[0] | Should Be '-Jpackages/grid-backend/sysimage/grid.sysimage.dll'
            $arguments.Gateway[2] | Should Be 'gateway/Caddyfile'
            (@($arguments.Grid + $arguments.Lab + $arguments.Gateway) -join ' ') | Should Not Match [regex]::Escape($rootWithSpaces)
        }
    }

    Describe 'Rollback ordering and idempotency' {
        It 'stops and waits on the validated process object instead of resolving its pid again' {
            $moduleSource = Get-Content -LiteralPath $modulePath -Raw

            $moduleSource | Should Match 'Stop-Process -InputObject \$process'
            $moduleSource | Should Match 'Wait-Process -InputObject \$process'
            $moduleSource | Should Not Match 'Stop-Process -Id \$process\.Id'
        }

        It 'preserves pre-existing state when duplicate start is rejected' {
            $duplicateRoot = Join-Path $TestDrive 'duplicate'
            $scripts = Join-Path $duplicateRoot 'scripts'
            $runDirectory = Join-Path $scripts '.run'
            New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
            Copy-Item -LiteralPath $startPath -Destination $scripts
            $statePath = Join-Path $runDirectory 'processes.json'
            Set-Content -LiteralPath $statePath -Value '{"version":1,"processes":[]}'
            @'
function Enter-StackMutex { return $null }
function Exit-StackMutex { param($Mutex) }
function Get-StackPaths {
    param($Root)
    return [pscustomobject]@{ StatePath = Join-Path $Root 'scripts\.run\processes.json' }
}
function Assert-StackPrerequisites { param($Paths) }
function Assert-NoRunningStack { param($StatePath) throw 'already running' }
function Stop-TrackedProcesses { param($Records) }
function Clear-StackState { param($StatePath) Remove-Item -LiteralPath $StatePath -Force }
Export-ModuleMember -Function *
'@ | Set-Content -LiteralPath (Join-Path $scripts 'stack-lifecycle.psm1')

            $threw = $false
            try { & (Join-Path $scripts 'start-all.ps1') -Root $duplicateRoot -TimeoutSec 1 } catch { $threw = $true }
            Import-Module $modulePath -Force

            $threw | Should Be $true
            (Test-Path -LiteralPath $statePath -PathType Leaf) | Should Be $true
        }

        It 'stops owned processes in reverse start order' {
            $stopped = New-Object System.Collections.ArrayList
            $records = @(
                [pscustomobject]@{ role = 'grid'; pid = 1; startTimeUtc = '2026-07-15T12:00:00Z'; executable = 'C:\tools\julia.exe'; arguments = @() },
                [pscustomobject]@{ role = 'lab'; pid = 2; startTimeUtc = '2026-07-15T12:00:00Z'; executable = 'C:\tools\julia.exe'; arguments = @() },
                [pscustomobject]@{ role = 'gateway'; pid = 3; startTimeUtc = '2026-07-15T12:00:00Z'; executable = 'C:\tools\caddy.exe'; arguments = @() }
            )
            $resolver = {
                param($id)
                $path = if ($id -eq 3) { 'C:\tools\caddy.exe' } else { 'C:\tools\julia.exe' }
                [pscustomobject]@{
                    Id = $id
                    StartTime = [DateTime]::Parse('2026-07-15T12:00:00Z').ToLocalTime()
                    Path = $path
                    HasExited = $false
                }
            }
            $stopper = { param($process) [void]$stopped.Add($process.Id) }

            Stop-TrackedProcesses -Records $records -ProcessResolver $resolver -Stopper $stopper

            (@($stopped) -join ',') | Should Be '3,2,1'
        }

        It 'allows stop to run twice when no state exists' {
            { & $stopPath -Root $TestDrive } | Should Not Throw
            { & $stopPath -Root $TestDrive } | Should Not Throw
        }
    }
}

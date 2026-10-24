$modulePath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts\ext-package.psm1'
Import-Module $modulePath -Force

Describe 'Extension package entry names (zhifan-ext/1 section 1)' {
    It 'accepts normal forward-slash paths' {
        (Get-ZipEntryNameProblem -Name 'bin/simulearn-grid.exe') | Should Be $null
        (Get-ZipEntryNameProblem -Name 'LICENSES/index.html') | Should Be $null
        (Get-ZipEntryNameProblem -Name 'share/julia/artifacts/abc/lib/libfoo.dll') | Should Be $null
    }

    It 'rejects the names the zhifan host safePath rejects' {
        foreach ($bad in @('bin\julia.exe', 'c:/x', '/bin/x', 'bin//x', './x', 'a/../x', 'dir./x', 'dir /x', 'aux.dll', 'lib/nul', 'com1/x', '')) {
            (Get-ZipEntryNameProblem -Name $bad) | Should Not Be $null
        }
    }

    It 'writes forward-slash entry names even under Windows PowerShell 5.1' {
        $source = Join-Path $TestDrive 'pkg'
        New-Item -ItemType Directory -Force -Path (Join-Path $source 'bin') | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $source 'LICENSES') | Out-Null
        Set-Content -LiteralPath (Join-Path $source 'bin\app.exe') -Value 'x'
        Set-Content -LiteralPath (Join-Path $source 'LICENSES\index.html') -Value '<p>x</p>'
        $zip = Join-Path $TestDrive 'pkg.zip'

        $written = New-ForwardSlashZip -SourceDirectory $source -ZipPath $zip
        $read = Get-ZipEntryNames -ZipPath $zip

        ($read | Sort-Object) -join ',' | Should Be 'bin/app.exe,LICENSES/index.html'
        @($written).Count | Should Be 2
        @($read | Where-Object { Get-ZipEntryNameProblem -Name $_ }).Count | Should Be 0
    }
}

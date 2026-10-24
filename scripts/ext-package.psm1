# 知帆拓展发布包（zhifan-ext/1 §1）的打包与条目名检查，供 release-ext.ps1 使用，Pester 有测试。
#
# 为什么不用 [IO.Compression.ZipFile]::CreateFromDirectory：Windows PowerShell 5.1 底下的 .NET Framework
# 会把条目名写成 bin\julia.exe（反斜杠）。zip 规范要求正斜杠，知帆宿主解压时的 safePath 见到反斜杠
# 就以「不安全路径」拒装（M0 之后用知帆的 sync.mjs 预演时发现，模拟宿主用 .NET 解压所以没测出来）。

$script:Reserved = '^(con|prn|aux|nul|com\d|lpt\d)(\.|$)'

function Get-ZipEntryNameProblem {
    # 与知帆 desktop/lib/packages.mjs 的 safePath 同一套规则；没问题返回 $null
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Name)

    if (-not $Name) { return '空条目名' }
    if ($Name.Contains('\')) { return '含反斜杠' }
    if ($Name.Contains(':')) { return '含冒号' }
    if ($Name.Contains([char]0)) { return '含空字符' }
    if ($Name.StartsWith('/')) { return '以 / 开头' }
    foreach ($part in $Name.Split('/')) {
        if (-not $part) { return '有空路径段' }
        if ($part -eq '.' -or $part -eq '..') { return '有 . 或 .. 路径段' }
        if ($part -match '[. ]$') { return "路径段以点或空格结尾：$part" }
        if ($part -match $script:Reserved) { return "路径段是 Windows 保留名：$part" }
    }
    return $null
}

function New-ForwardSlashZip {
    # 把目录打成 zip，条目名一律用正斜杠；返回写入的条目名
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceDirectory,
        [Parameter(Mandatory = $true)][string]$ZipPath
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $source = (Resolve-Path -LiteralPath $SourceDirectory).Path.TrimEnd('\')
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    $names = New-Object System.Collections.Generic.List[string]
    $archive = [IO.Compression.ZipFile]::Open($ZipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
            $name = $file.FullName.Substring($source.Length + 1).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
            $names.Add($name)
        }
    }
    finally {
        $archive.Dispose()
    }
    return $names.ToArray()
}

function Get-ZipEntryNames {
    # 读回 zip 里实际写入的条目名（不含目录条目），用于事后核对
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ZipPath)

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        return @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object { $_.FullName })
    }
    finally {
        $archive.Dispose()
    }
}

Export-ModuleMember -Function @('Get-ZipEntryNameProblem', 'New-ForwardSlashZip', 'Get-ZipEntryNames')

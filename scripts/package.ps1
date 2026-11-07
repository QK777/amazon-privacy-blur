# Creates release and source archives using only explicitly listed project files.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw 'Invalid manifest version.' }

$extensionFiles = @(
    'manifest.json', 'content.js', 'content.css',
    'popup.html', 'popup.js', 'popup.css', '使い方.txt', 'LICENSE'
)
$sourceFiles = $extensionFiles + @(
    'README.md', 'CHANGELOG.md', '.gitignore', '.gitattributes',
    'scripts/package.ps1', 'tests/content.test.cjs'
)

foreach ($relativePath in $sourceFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
        throw "Required file missing: $relativePath"
    }
}

$outputDirectory = Join-Path $projectRoot 'dist'
[void][IO.Directory]::CreateDirectory($outputDirectory)

function Write-Package {
    param([string]$FileName, [string[]]$Files)
    $destination = Join-Path $outputDirectory $FileName
    # Overwrite only this generated file; no directory copying or recursive deletion.
    $stream = [IO.File]::Open($destination, [IO.FileMode]::Create, [IO.FileAccess]::Write)
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($relativePath in $Files) {
                $entryName = 'AmazonPrivacyBlur/' + $relativePath.Replace('\', '/')
                [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $archive, (Join-Path $projectRoot $relativePath), $entryName,
                    [IO.Compression.CompressionLevel]::Optimal
                )
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }

    # Check entry names and uncompressed bytes, including non-ASCII filenames.
    $archive = [IO.Compression.ZipFile]::OpenRead($destination)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        if ($archive.Entries.Count -ne $Files.Count) { throw "Entry count mismatch: $FileName" }
        $expected = @{}
        foreach ($relativePath in $Files) { $expected['AmazonPrivacyBlur/' + $relativePath.Replace('\', '/')] = $relativePath }
        foreach ($entry in $archive.Entries) {
            if (-not $expected.ContainsKey($entry.FullName)) { throw "Unexpected entry: $($entry.FullName)" }
            $entryStream = $entry.Open()
            try {
                $actualHash = [BitConverter]::ToString($sha.ComputeHash($entryStream)).Replace('-', '')
            } finally { $entryStream.Dispose() }
            $originalHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot $expected[$entry.FullName]) -Algorithm SHA256).Hash
            if ($actualHash -ne $originalHash) { throw "Content mismatch: $($entry.FullName)" }
            $expected.Remove($entry.FullName)
        }
        if ($expected.Count) { throw "Missing entries: $FileName" }
    } finally {
        $sha.Dispose()
        $archive.Dispose()
    }

    [PSCustomObject]@{
        File = $FileName
        Entries = $Files.Count
        Bytes = (Get-Item -LiteralPath $destination).Length
        SHA256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$packages = @(
    Write-Package -FileName "AmazonPrivacyBlur-$version.zip" -Files $extensionFiles
    Write-Package -FileName "AmazonPrivacyBlur-source-$version.zip" -Files $sourceFiles
)
$checksums = ($packages | ForEach-Object { "$($_.SHA256)  $($_.File)" }) -join "`n"
[IO.File]::WriteAllText((Join-Path $outputDirectory 'SHA256SUMS.txt'), $checksums + "`n", [Text.UTF8Encoding]::new($false))
$packages | Format-Table -AutoSize
Write-Output "Packages verified. Output: $outputDirectory"

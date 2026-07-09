param(
  [string]$ProjectWorkspace = (Get-Location).Path,
  [string]$OutputPath = "outputs/implementation_verification/baseline_file_manifest_2026-07-09.csv"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath $ProjectWorkspace).Path

if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  $manifestPath = $OutputPath
} else {
  $manifestPath = Join-Path $root $OutputPath
}

$manifestDir = Split-Path -Parent $manifestPath
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

$excludedSegments = @(
  ".git",
  "node_modules",
  ".venv-dwg",
  ".codegraph",
  ".playwright-cli",
  "__pycache__",
  "chrome-profile"
)

$excludedPrefixes = @(
  "outputs/implementation_verification/",
  "prototypes/opentakeoff/web/dist/",
  "prototypes/opentakeoff/.git/"
)

function Get-RelativePathCompat {
  param(
    [string]$BasePath,
    [string]$FullPath
  )

  $prefix = $BasePath.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  if ($FullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $FullPath.Substring($prefix.Length)
  }

  return $FullPath
}

function Test-ExcludedPath {
  param([string]$RelativePath)

  $normal = $RelativePath.Replace("\", "/")

  foreach ($prefix in $excludedPrefixes) {
    if ($normal.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  $segments = $normal.Split("/")
  foreach ($segment in $segments) {
    if ($excludedSegments -contains $segment) {
      return $true
    }
  }

  return $false
}

$rows = Get-ChildItem -LiteralPath $root -Recurse -File -Force |
  ForEach-Object {
    $relativePath = Get-RelativePathCompat -BasePath $root -FullPath $_.FullName
    if (Test-ExcludedPath -RelativePath $relativePath) {
      return
    }

    [pscustomobject]@{
      RelativePath = $relativePath
      Length = $_.Length
      LastWriteTimeUtc = $_.LastWriteTimeUtc.ToString("o")
      Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
    }
  } |
  Sort-Object RelativePath

$rows | Export-Csv -LiteralPath $manifestPath -NoTypeInformation

Write-Host ("Wrote {0} rows to {1}" -f $rows.Count, $manifestPath)

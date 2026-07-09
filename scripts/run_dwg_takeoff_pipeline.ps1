param(
  [string]$ProjectWorkspace = (Get-Location).Path,

  [string]$DwgDir = "DWG",

  [string]$Mapping = "inputs\dwg_takeoff_mapping.sample.json",

  [string]$ReviewOverrides = "inputs\dwg_takeoff_review_overrides.csv",

  [string]$OdaConverterPath = "C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe",

  [string]$PythonExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",

  [string]$NodeExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",

  [string]$SkillRunBuild = "C:\Users\AlanRichardson\.codex\skills\timber-frame-cutting-list\scripts\run_build.ps1",

  [switch]$IncludeWorkbook,

  [switch]$InventoryOnly,

  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"

function Resolve-WorkspacePath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return (Resolve-Path -LiteralPath $PathValue).Path
  }
  return (Resolve-Path -LiteralPath (Join-Path $workspacePath $PathValue)).Path
}

function Get-WorkspaceRelativePath {
  param([string]$FullPath)
  $basePath = $workspacePath
  if (-not $basePath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $basePath = "$basePath$([System.IO.Path]::DirectorySeparatorChar)"
  }
  $baseUri = [System.Uri]::new($basePath)
  $fileUri = [System.Uri]::new((Resolve-Path -LiteralPath $FullPath).Path)
  return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString()).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
}

function Get-FileRecord {
  param([string]$PathValue)
  $resolved = Resolve-WorkspacePath $PathValue
  $item = Get-Item -LiteralPath $resolved
  $hash = Get-FileHash -LiteralPath $resolved -Algorithm SHA256
  return [ordered]@{
    path = $item.FullName
    relativePath = Get-WorkspaceRelativePath $item.FullName
    size = $item.Length
    modifiedUtc = $item.LastWriteTimeUtc.ToString("o")
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}

function Get-OptionalFileRecord {
  param([string]$PathValue)
  if ($PathValue -and (Test-Path -LiteralPath $PathValue)) {
    return Get-FileRecord $PathValue
  }
  return $null
}

function Invoke-Checked {
  param(
    [scriptblock]$Command,
    [string]$Description
  )
  Write-Host "==> $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

function Write-JsonNoBom {
  param(
    [string]$PathValue,
    [object]$Value,
    [int]$Depth = 12
  )
  $json = $Value | ConvertTo-Json -Depth $Depth
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($PathValue, $json, $utf8NoBom)
}

$workspacePath = (Resolve-Path -LiteralPath $ProjectWorkspace).Path
$dwgDirPath = Resolve-WorkspacePath $DwgDir
$mappingPath = Resolve-WorkspacePath $Mapping
$reviewOverridesPath = if (Test-Path -LiteralPath (Join-Path $workspacePath $ReviewOverrides)) { Resolve-WorkspacePath $ReviewOverrides } else { Join-Path $workspacePath $ReviewOverrides }
$outputDir = Join-Path $workspacePath "outputs\dwg_takeoff"
$dxfDir = Join-Path $outputDir "dxf"
$layerSummaryCsv = Join-Path $outputDir "dwg_layer_summary.csv"
$entityInventoryCsv = Join-Path $outputDir "dwg_entity_inventory.csv"
$reviewCsv = Join-Path $outputDir "dwg_takeoff_review.csv"
$extractorSummaryJson = Join-Path $outputDir "dwg_takeoff_extractor_summary.json"
$manifestPath = Join-Path $outputDir "dwg_takeoff_manifest.json"
$pipelineSummaryPath = Join-Path $outputDir "dwg_takeoff_pipeline_summary.json"
$importJson = Join-Path $workspacePath "inputs\dwg_takeoff_import.json"

if (-not (Test-Path -LiteralPath $OdaConverterPath)) {
  throw "ODA File Converter not found: $OdaConverterPath"
}
if (-not (Test-Path -LiteralPath $PythonExe)) {
  throw "Python executable not found: $PythonExe"
}
if (-not (Test-Path -LiteralPath $dwgDirPath)) {
  throw "DWG directory not found: $dwgDirPath"
}
if (-not (Test-Path -LiteralPath $mappingPath)) {
  throw "DWG mapping file not found: $mappingPath"
}

$dwgFiles = @(Get-ChildItem -LiteralPath $dwgDirPath -File -Filter *.dwg)
if ($dwgFiles.Count -eq 0) {
  throw "No .dwg files found in $dwgDirPath"
}

$ezdxfVersion = ""
$ErrorActionPreference = "Continue"
$ezdxfProbe = & $PythonExe -c "import ezdxf; print(getattr(ezdxf, '__version__', 'unknown'))" 2>&1
$ezdxfExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($ezdxfExit -ne 0) {
  throw "Python package ezdxf is not available for $PythonExe. Use a Python environment with ezdxf installed and pass it via -PythonExe. Probe output: $($ezdxfProbe -join ' ')"
}
$ezdxfVersion = ($ezdxfProbe | Select-Object -First 1)

$ErrorActionPreference = "Continue"
$odaProbe = & $OdaConverterPath 2>&1
$odaProbeExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
$odaProbeText = (($odaProbe | Select-Object -First 30) -join "`n")

$preflight = [ordered]@{
  kind = "dwg-takeoff-preflight"
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  workspace = $workspacePath
  odaConverterPath = $OdaConverterPath
  odaProbeExit = $odaProbeExit
  odaProbeOutput = $odaProbeText
  pythonExe = $PythonExe
  ezdxfVersion = $ezdxfVersion
  dwgCount = $dwgFiles.Count
  mapping = $mappingPath
}

New-Item -ItemType Directory -Force -Path $outputDir, $dxfDir | Out-Null
Write-JsonNoBom -PathValue $pipelineSummaryPath -Value $preflight
if ($PreflightOnly) {
  Write-Output "DWG_PREFLIGHT summary=$pipelineSummaryPath"
  return
}

Push-Location -LiteralPath $workspacePath
try {
  Invoke-Checked -Description "Convert DWG files to DXF with ODA File Converter" -Command {
    & $OdaConverterPath $dwgDirPath $dxfDir "ACAD2018" "DXF" "0" "1" "*.dwg"
  }

  $dxfFiles = @(Get-ChildItem -LiteralPath $dxfDir -File -Filter *.dxf)
  if ($dxfFiles.Count -eq 0) {
    throw "ODA conversion completed but no DXF files were found in $dxfDir"
  }

  $extractArgs = @(
    "scripts\extract_dwg_takeoff.py",
    "--dxf-dir", $dxfDir,
    "--dwg-dir", $dwgDirPath,
    "--mapping", $mappingPath,
    "--review-overrides", $reviewOverridesPath,
    "--project", "Sample Duplex",
    "--output-dir", $outputDir,
    "--import-json", $importJson,
    "--layer-summary-csv", $layerSummaryCsv,
    "--entity-inventory-csv", $entityInventoryCsv,
    "--review-csv", $reviewCsv,
    "--summary-json", $extractorSummaryJson
  )
  if ($InventoryOnly) {
    $extractArgs += "--inventory-only"
  }

  Invoke-Checked -Description "Extract DWG takeoff inventory and review rows" -Command {
    & $PythonExe @extractArgs
  }

  $extractorSummary = Get-Content -Raw -LiteralPath $extractorSummaryJson | ConvertFrom-Json
  $unitWarning = if ($extractorSummary.unitWarnings) { ($extractorSummary.unitWarnings -join " ") } else { "" }
  $manifest = [ordered]@{
    kind = "dwg-takeoff-manifest"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    unitWarning = $unitWarning
    tools = [ordered]@{
      pipeline = "scripts/run_dwg_takeoff_pipeline.ps1"
      converter = $OdaConverterPath
      extractor = "scripts/extract_dwg_takeoff.py"
      workbookBuilder = "timber-frame-cutting-list/scripts/build_timber_frame_workbook.mjs"
    }
    files = [ordered]@{
      dwgFiles = @($dwgFiles | ForEach-Object { Get-FileRecord $_.FullName })
      dxfFiles = @($dxfFiles | ForEach-Object { Get-FileRecord $_.FullName })
      mapping = Get-FileRecord $mappingPath
      reviewOverrides = Get-OptionalFileRecord $reviewOverridesPath
      importJson = if (-not $InventoryOnly -and (Test-Path -LiteralPath $importJson)) { Get-FileRecord $importJson } else { $null }
      reviewCsv = Get-FileRecord $reviewCsv
      layerSummary = Get-FileRecord $layerSummaryCsv
      entityInventory = Get-FileRecord $entityInventoryCsv
      extractorSummary = Get-FileRecord $extractorSummaryJson
    }
  }
  Write-JsonNoBom -PathValue $manifestPath -Value $manifest

  $summary = [ordered]@{
    kind = "dwg-takeoff-pipeline-summary"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    preflight = $preflight
    inventoryOnly = [bool]$InventoryOnly
    counts = [ordered]@{
      dwgFiles = $dwgFiles.Count
      dxfFiles = $dxfFiles.Count
      entities = $extractorSummary.entityCount
      layers = $extractorSummary.layerCount
      measurements = $extractorSummary.measurementCount
      reviewOverrides = $extractorSummary.reviewOverrideCount
      unitWarnings = @($extractorSummary.unitWarnings).Count
    }
    files = [ordered]@{
      manifest = Get-FileRecord $manifestPath
      importJson = if (-not $InventoryOnly -and (Test-Path -LiteralPath $importJson)) { Get-FileRecord $importJson } else { $null }
      reviewCsv = Get-FileRecord $reviewCsv
      layerSummary = Get-FileRecord $layerSummaryCsv
      entityInventory = Get-FileRecord $entityInventoryCsv
      extractorSummary = Get-FileRecord $extractorSummaryJson
    }
  }
  Write-JsonNoBom -PathValue $pipelineSummaryPath -Value $summary

  if ($IncludeWorkbook) {
    if (-not (Test-Path -LiteralPath $SkillRunBuild)) {
      throw "Skill build runner not found: $SkillRunBuild"
    }
    Invoke-Checked -Description "Build and verify workbook with DWG takeoff import state" -Command {
      & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe
    }
  }
}
finally {
  Pop-Location
}

Write-Output "DWG_PIPELINE manifest=$manifestPath"
Write-Output "DWG_PIPELINE summary=$pipelineSummaryPath"
Write-Output "DWG_PIPELINE layerSummary=$layerSummaryCsv"
Write-Output "DWG_PIPELINE entityInventory=$entityInventoryCsv"
if (-not $InventoryOnly) {
  Write-Output "DWG_PIPELINE importJson=$importJson"
}

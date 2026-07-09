param(
  [string]$ProjectWorkspace = (Get-Location).Path,

  [string]$ArchitecturalPdf = "sample-architectural-plans.pdf",

  [int]$SiteAPage = 11,

  [int]$SiteBPage = 12,

  [switch]$IncludeMeasurement,

  [string]$OpenTakeoffExport = "",

  [string]$OpenTakeoffMapping = "inputs\opentakeoff_mapping.sample.json",

  [string]$ReviewOverrides = "inputs\opening_schedule_review_overrides.csv",

  [string]$NodeExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",

  [string]$PythonExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",

  [string]$SkillRunBuild = "C:\Users\AlanRichardson\.codex\skills\timber-frame-cutting-list\scripts\run_build.ps1"
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

$workspacePath = (Resolve-Path -LiteralPath $ProjectWorkspace).Path
$extractCsv = Join-Path $workspacePath "outputs\pdf_plan_index\opening_schedule_extract.csv"
$crosscheckCsv = Join-Path $workspacePath "outputs\opening_schedule_crosscheck.csv"
$manifestPath = Join-Path $workspacePath "outputs\pdf_plan_index\opening_schedule_crosscheck_manifest.json"
$pipelineSummaryPath = Join-Path $workspacePath "outputs\pdf_plan_index\pipeline_run_summary.json"
$sourceWorkbookSnapshot = Join-Path $workspacePath "outputs\pdf_plan_index\opening_schedule_crosscheck_source_full.xlsx"
$fullWorkbook = Join-Path $workspacePath "outputs\timber_frame_cutting_list\Sample_Timber_Framing_Takeoff_Cutting_List_full.xlsx"
$measurementWorkbook = Join-Path $workspacePath "outputs\timber_frame_cutting_list\Sample_Timber_Framing_Takeoff_Cutting_List_measurement.xlsx"

if (-not (Test-Path -LiteralPath $NodeExe)) {
  throw "Node executable not found: $NodeExe"
}
if (-not (Test-Path -LiteralPath $PythonExe)) {
  throw "Python executable not found: $PythonExe"
}
if (-not (Test-Path -LiteralPath $SkillRunBuild)) {
  throw "Skill build runner not found: $SkillRunBuild"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $extractCsv) | Out-Null
$pageDiscoveryPages = @()
$pageDiscoveryWarning = ""
$fullVerifierStatus = "Not Run"
$measurementVerifierStatus = "Not Run"

Push-Location -LiteralPath $workspacePath
try {
  if ($OpenTakeoffExport -ne "") {
    Invoke-Checked -Description "Convert OpenTakeoff export" -Command {
      & $NodeExe scripts\convert_opentakeoff_export.mjs `
        --input $OpenTakeoffExport `
        --mapping $OpenTakeoffMapping `
        --output inputs\pdf_takeoff_import.json `
        --review-csv outputs\pdf_takeoff_import_review.csv
    }
  }

  Invoke-Checked -Description "Build source full workbook for schedule cross-check" -Command {
    & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe -SkipVerify
  }

  Copy-Item -LiteralPath $fullWorkbook -Destination $sourceWorkbookSnapshot -Force

  if (Test-Path -LiteralPath "scripts\pdf_plan_index.py") {
    Invoke-Checked -Description "Index architectural PDF schedule page candidates" -Command {
      & $PythonExe scripts\pdf_plan_index.py `
        --pdf $ArchitecturalPdf `
        --output-dir outputs\pdf_plan_index
    }
    $candidateCsv = Join-Path $workspacePath "outputs\pdf_plan_index\pdf_schedule_text_candidates.csv"
    if (Test-Path -LiteralPath $candidateCsv) {
      $pageDiscoveryPages = @(Import-Csv -LiteralPath $candidateCsv |
        Where-Object { $_."Likely Role" -eq "Opening/Schedule candidate" } |
        Select-Object -ExpandProperty Page -Unique)
      $selectedPages = @([string]$SiteAPage, [string]$SiteBPage)
      $missingSelected = @($selectedPages | Where-Object { $pageDiscoveryPages -notcontains $_ })
      if ($pageDiscoveryPages.Count -gt 0 -and $missingSelected.Count -gt 0) {
        $pageDiscoveryWarning = "Detected opening schedule candidate pages ($($pageDiscoveryPages -join ', ')) do not include selected page(s): $($missingSelected -join ', ')."
      }
    }
  }

  Invoke-Checked -Description "Extract architectural opening schedule IDs" -Command {
    & $PythonExe scripts\extract_opening_schedule.py `
      --pdf $ArchitecturalPdf `
      --site-a-page $SiteAPage `
      --site-b-page $SiteBPage `
      --output $extractCsv
  }

  Invoke-Checked -Description "Cross-check PDF opening IDs against source workbook" -Command {
    & $NodeExe scripts\crosscheck_opening_schedule.mjs `
      --workbook $sourceWorkbookSnapshot `
      --extract $extractCsv `
      --output $crosscheckCsv `
      --manifest $manifestPath `
      --review-overrides $ReviewOverrides
  }

  $manifest = [ordered]@{
    kind = "opening-schedule-crosscheck-manifest"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    siteAPage = $SiteAPage
    siteBPage = $SiteBPage
    tools = [ordered]@{
      pipeline = "scripts/run_pdf_schedule_pipeline.ps1"
      extractor = "scripts/extract_opening_schedule.py"
      crosscheck = "scripts/crosscheck_opening_schedule.mjs"
      workbookBuilder = "timber-frame-cutting-list/scripts/build_timber_frame_workbook.mjs"
    }
    pageDiscovery = [ordered]@{
      candidatePages = $pageDiscoveryPages
      warning = $pageDiscoveryWarning
    }
    files = [ordered]@{
      architecturalPdf = Get-FileRecord $ArchitecturalPdf
      extractCsv = Get-FileRecord $extractCsv
      workbook = Get-FileRecord $sourceWorkbookSnapshot
      crosscheckCsv = Get-FileRecord $crosscheckCsv
    }
  }
  $manifestJson = $manifest | ConvertTo-Json -Depth 10
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
  Write-Host "MANIFEST $manifestPath"

  Invoke-Checked -Description "Build and verify final full workbook" -Command {
    & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe
  }
  $fullVerifierStatus = "Passed"

  if ($IncludeMeasurement) {
    Invoke-Checked -Description "Build and verify measurement workbook" -Command {
      & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode measurement -NodeExe $NodeExe
    }
    $measurementVerifierStatus = "Passed"
  }

  $crosscheckRows = @()
  if (Test-Path -LiteralPath $crosscheckCsv) {
    $crosscheckRows = @(Import-Csv -LiteralPath $crosscheckCsv)
  }
  $unresolvedCrosscheck = @($crosscheckRows | Where-Object { $_.openingId -and $_.reviewStatus -ne "Reviewed" })
  $dimensionMismatch = @($crosscheckRows | Where-Object { $_.status -eq "Dimension Mismatch" })
  $sourceManifestRecord = Get-FileRecord $manifestPath
  $summary = [ordered]@{
    kind = "pdf-schedule-pipeline-run-summary"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    readinessStatus = if ($unresolvedCrosscheck.Count -eq 0) { "Schedule Cross-Check Ready" } else { "Open Items" }
    siteAPage = $SiteAPage
    siteBPage = $SiteBPage
    pageDiscovery = [ordered]@{
      candidatePages = $pageDiscoveryPages
      warning = $pageDiscoveryWarning
    }
    counts = [ordered]@{
      extractedRows = if (Test-Path -LiteralPath $extractCsv) { @(Import-Csv -LiteralPath $extractCsv).Count } else { 0 }
      crosscheckRows = $crosscheckRows.Count
      unresolvedCrosscheckRows = $unresolvedCrosscheck.Count
      dimensionMismatchRows = $dimensionMismatch.Count
    }
    verifiers = [ordered]@{
      full = $fullVerifierStatus
      measurement = $measurementVerifierStatus
    }
    files = [ordered]@{
      fullWorkbook = Get-FileRecord $fullWorkbook
      measurementWorkbook = if ($IncludeMeasurement -and (Test-Path -LiteralPath $measurementWorkbook)) { Get-FileRecord $measurementWorkbook } else { $null }
      extractCsv = Get-FileRecord $extractCsv
      crosscheckCsv = Get-FileRecord $crosscheckCsv
      manifest = $sourceManifestRecord
      tbaCsv = Get-FileRecord (Join-Path $workspacePath "outputs\timber_frame_cutting_list\exports\tba_items.csv")
    }
  }
  $summaryJson = $summary | ConvertTo-Json -Depth 12
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($pipelineSummaryPath, $summaryJson, $utf8NoBom)
  Write-Host "SUMMARY $pipelineSummaryPath"
}
finally {
  Pop-Location
}

Write-Output "PIPELINE fullWorkbook=$fullWorkbook"
if ($IncludeMeasurement) {
  Write-Output "PIPELINE measurementWorkbook=$measurementWorkbook"
}
Write-Output "PIPELINE extractCsv=$extractCsv"
Write-Output "PIPELINE crosscheckCsv=$crosscheckCsv"
Write-Output "PIPELINE manifest=$manifestPath"
Write-Output "PIPELINE summary=$pipelineSummaryPath"

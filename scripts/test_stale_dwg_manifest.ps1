param(
  [string]$ProjectWorkspace = (Get-Location).Path,

  [string]$NodeExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",

  [string]$SkillRunBuild = "C:\Users\AlanRichardson\.codex\skills\timber-frame-cutting-list\scripts\run_build.ps1"
)

$ErrorActionPreference = "Stop"

$workspacePath = (Resolve-Path -LiteralPath $ProjectWorkspace).Path
$dwgImportPath = Join-Path $workspacePath "inputs\dwg_takeoff_import.json"
$manifestDir = Join-Path $workspacePath "outputs\dwg_takeoff"
$manifestPath = Join-Path $manifestDir "dwg_takeoff_manifest.json"
$staleLogPath = Join-Path $manifestDir "stale_dwg_manifest_test.log"
$fullWorkbook = Join-Path $workspacePath "outputs\timber_frame_cutting_list\Sample_Timber_Framing_Takeoff_Cutting_List_full.xlsx"
$tbaCsv = Join-Path $workspacePath "outputs\timber_frame_cutting_list\exports\tba_items.csv"
$copiedBuilder = Join-Path $workspacePath ".timber-frame-cutting-list\build_timber_frame_workbook.mjs"
$copiedVerifier = Join-Path $workspacePath ".timber-frame-cutting-list\verify_workbook.mjs"
$backupDir = Join-Path $workspacePath "outputs\dwg_takeoff\stale_test_backup"
$backupImport = Join-Path $backupDir "dwg_takeoff_import.json"
$backupManifest = Join-Path $backupDir "dwg_takeoff_manifest.json"

if (-not (Test-Path -LiteralPath $NodeExe)) {
  throw "Node executable not found: $NodeExe"
}
if (-not (Test-Path -LiteralPath $SkillRunBuild)) {
  throw "Skill build runner not found: $SkillRunBuild"
}

function Write-JsonNoBom {
  param([string]$PathValue, [object]$Value)
  $json = $Value | ConvertTo-Json -Depth 12
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($PathValue, $json, $utf8NoBom)
}

Push-Location -LiteralPath $workspacePath
try {
  New-Item -ItemType Directory -Force -Path $manifestDir, $backupDir | Out-Null
  if (Test-Path -LiteralPath $dwgImportPath) {
    Copy-Item -LiteralPath $dwgImportPath -Destination $backupImport -Force
  }
  if (Test-Path -LiteralPath $manifestPath) {
    Copy-Item -LiteralPath $manifestPath -Destination $backupManifest -Force
  }

  & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe -SkipVerify
  if ($LASTEXITCODE -ne 0) {
    throw "Clean build before stale DWG test failed with exit code $LASTEXITCODE"
  }

  $testImport = [ordered]@{
    project = "Sample Duplex"
    source = [ordered]@{
      system = "DWG"
      importedAt = (Get-Date).ToUniversalTime().ToString("o")
      sourceDir = "stale-test"
      mappingFile = "stale-test"
    }
    measurements = @(
      [ordered]@{
        id = "DWG-STALE-TEST"
        project = "Sample Duplex"
        sourceSystem = "DWG"
        sourceDwg = "stale-test.dwg"
        sourcePdf = "stale-test.dwg"
        sourceLayout = "Model"
        sourceLayer = "STALE_TEST"
        sourceEntityType = "LINE"
        sourceEntityHandle = "1"
        pageNumber = 1
        sheetNumber = "Model"
        drawingRevision = "STALE TEST"
        calibrationSource = "Stale manifest regression fixture"
        measurementType = "linear"
        tradeComponent = "External Wall"
        targetWorkbookSheet = "Wall Measurements"
        site = "A"
        level = "Ground"
        wallId = "DWG-STALE-TEST"
        sourceValue = 1000
        sourceUnit = "mm"
        value = 1
        unit = "m"
        valueM = 1
        valueMm = 1000
        reviewStatus = "Needs Review"
        reviewer = ""
        reviewedDate = ""
        conditionName = "DWG stale manifest fixture"
        confidence = 0.1
        notes = "Temporary stale-DWG manifest regression row."
      }
    )
  }
  Write-JsonNoBom -PathValue $dwgImportPath -Value $testImport

  $item = Get-Item -LiteralPath $dwgImportPath
  $staleManifest = [ordered]@{
    kind = "dwg-takeoff-manifest"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    tools = [ordered]@{
      pipeline = "scripts/test_stale_dwg_manifest.ps1"
      converter = "stale-test"
      extractor = "stale-test"
      workbookBuilder = "timber-frame-cutting-list/scripts/build_timber_frame_workbook.mjs"
    }
    files = [ordered]@{
      importJson = [ordered]@{
        path = $item.FullName
        relativePath = "inputs\dwg_takeoff_import.json"
        size = $item.Length
        modifiedUtc = $item.LastWriteTimeUtc.ToString("o")
        sha256 = "0000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  }
  Write-JsonNoBom -PathValue $manifestPath -Value $staleManifest

  & $NodeExe $copiedBuilder --mode full
  if ($LASTEXITCODE -ne 0) {
    throw "Stale-DWG workbook build failed with exit code $LASTEXITCODE"
  }

  $tbaText = Get-Content -Raw -LiteralPath $tbaCsv
  if (-not $tbaText.Contains("Source / Pipeline Check")) {
    throw "TBA CSV did not include Source / Pipeline Check for stale DWG manifest."
  }

  $ErrorActionPreference = "Continue"
  & $NodeExe $copiedVerifier --workbook $fullWorkbook --mode full --project-workspace $workspacePath *> $staleLogPath
  $verifyExit = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($verifyExit -eq 0) {
    throw "Verifier passed with stale DWG manifest; expected failure."
  }

  $staleLog = Get-Content -Raw -LiteralPath $staleLogPath
  if (-not $staleLog.Contains("Source manifest is stale")) {
    throw "Verifier failure did not report stale DWG source manifest."
  }

  Write-Output "STALE_DWG_MANIFEST_TEST expectedVerifierExit=$verifyExit"
}
finally {
  $ErrorActionPreference = "Continue"
  if (Test-Path -LiteralPath $backupImport) {
    Copy-Item -LiteralPath $backupImport -Destination $dwgImportPath -Force
  } else {
    Remove-Item -LiteralPath $dwgImportPath -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $backupManifest) {
    Copy-Item -LiteralPath $backupManifest -Destination $manifestPath -Force
  } else {
    Remove-Item -LiteralPath $manifestPath -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $staleLogPath -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue
  & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe | Out-Host
  Pop-Location
}

param(
  [string]$ProjectWorkspace = (Get-Location).Path,

  [string]$NodeExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",

  [string]$SkillRunBuild = "C:\Users\AlanRichardson\.codex\skills\timber-frame-cutting-list\scripts\run_build.ps1"
)

$ErrorActionPreference = "Stop"

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
$outputDir = Join-Path $workspacePath "outputs\implementation_verification"
$crosscheckCsv = Join-Path $workspacePath "outputs\opening_schedule_crosscheck.csv"
$crosscheckManifest = Join-Path $workspacePath "outputs\pdf_plan_index\opening_schedule_crosscheck_manifest.json"
$fullWorkbook = Join-Path $workspacePath "outputs\timber_frame_cutting_list\Sample_Timber_Framing_Takeoff_Cutting_List_full.xlsx"
$measurementWorkbook = Join-Path $workspacePath "outputs\timber_frame_cutting_list\Sample_Timber_Framing_Takeoff_Cutting_List_measurement.xlsx"
$fullVerifierJson = Join-Path $outputDir "full_verifier.json"
$measurementVerifierJson = Join-Path $outputDir "measurement_verifier.json"

if (-not (Test-Path -LiteralPath $NodeExe)) {
  throw "Node executable not found: $NodeExe"
}
if (-not (Test-Path -LiteralPath $SkillRunBuild)) {
  throw "Skill build runner not found: $SkillRunBuild"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location -LiteralPath $workspacePath
try {
$refreshSchedule = $false
if (-not (Test-Path -LiteralPath $crosscheckCsv) -or -not (Test-Path -LiteralPath $crosscheckManifest)) {
  $refreshSchedule = $true
} else {
  Write-Host "==> Check opening schedule cross-check freshness"
  $freshnessOutput = & $NodeExe scripts\check_opening_schedule_freshness.mjs --project-workspace $workspacePath
  $freshnessExit = $LASTEXITCODE
  if ($freshnessOutput) {
    [System.IO.File]::WriteAllText((Join-Path $outputDir "opening_schedule_freshness.json"), ($freshnessOutput -join "`n"), [System.Text.UTF8Encoding]::new($false))
  }
  if ($freshnessExit -ne 0) {
    $refreshSchedule = $true
  }
}

if ($refreshSchedule) {
    Invoke-Checked -Description "Refresh missing opening schedule cross-check state" -Command {
      & scripts\run_pdf_schedule_pipeline.ps1 -ProjectWorkspace $workspacePath -IncludeMeasurement
    }
  } else {
    Write-Host "==> Opening schedule cross-check CSV and manifest are current; skipping PDF schedule extraction."
  }

  Invoke-Checked -Description "Build full workbook for measurement iteration" -Command {
    & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe -SkipVerify -SkipRender
  }

  Write-Host "==> Verify full workbook"
  $fullVerifyOutput = & $NodeExe .timber-frame-cutting-list\verify_workbook.mjs `
    --workbook $fullWorkbook `
    --mode full `
    --project-workspace $workspacePath
  $fullVerifyExit = $LASTEXITCODE
  [System.IO.File]::WriteAllText($fullVerifierJson, ($fullVerifyOutput -join "`n"), [System.Text.UTF8Encoding]::new($false))
  if ($fullVerifyExit -ne 0) {
    throw "Full workbook verifier failed with exit code $fullVerifyExit"
  }

  Invoke-Checked -Description "Build measurement workbook for measurement iteration" -Command {
    & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode measurement -NodeExe $NodeExe -SkipVerify -SkipRender
  }

  Write-Host "==> Verify measurement workbook"
  $measurementVerifyOutput = & $NodeExe .timber-frame-cutting-list\verify_workbook.mjs `
    --workbook $measurementWorkbook `
    --mode measurement `
    --project-workspace $workspacePath
  $measurementVerifyExit = $LASTEXITCODE
  [System.IO.File]::WriteAllText($measurementVerifierJson, ($measurementVerifyOutput -join "`n"), [System.Text.UTF8Encoding]::new($false))
  if ($measurementVerifyExit -ne 0) {
    throw "Measurement workbook verifier failed with exit code $measurementVerifyExit"
  }

  Invoke-Checked -Description "Generate measurement task queue, summary, and readiness report" -Command {
    & $NodeExe scripts\generate_measurement_iteration_artifacts.mjs `
      --project-workspace $workspacePath `
      --full-verifier $fullVerifierJson `
      --measurement-verifier $measurementVerifierJson
  }
}
finally {
  Pop-Location
}

Write-Output "MEASUREMENT_ITERATION fullWorkbook=$fullWorkbook"
Write-Output "MEASUREMENT_ITERATION measurementWorkbook=$measurementWorkbook"
Write-Output "MEASUREMENT_ITERATION taskQueue=$(Join-Path $outputDir 'measurement_task_queue.csv')"
Write-Output "MEASUREMENT_ITERATION summary=$(Join-Path $outputDir 'measurement_iteration_summary.json')"
Write-Output "MEASUREMENT_ITERATION report=$(Join-Path $outputDir 'cutting_list_readiness_report.md')"

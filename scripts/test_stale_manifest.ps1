param(
  [string]$ProjectWorkspace = (Get-Location).Path,

  [string]$NodeExe = "C:\Users\AlanRichardson\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",

  [string]$SkillRunBuild = "C:\Users\AlanRichardson\.codex\skills\timber-frame-cutting-list\scripts\run_build.ps1"
)

$ErrorActionPreference = "Stop"

$workspacePath = (Resolve-Path -LiteralPath $ProjectWorkspace).Path
$manifestPath = Join-Path $workspacePath "outputs\pdf_plan_index\opening_schedule_crosscheck_manifest.json"
$staleManifestPath = Join-Path $workspacePath "outputs\pdf_plan_index\opening_schedule_crosscheck_manifest.stale-test.json"
$staleLogPath = Join-Path $workspacePath "outputs\pdf_plan_index\stale_manifest_test.log"
$fullWorkbook = Join-Path $workspacePath "outputs\timber_frame_cutting_list\Sample_Timber_Framing_Takeoff_Cutting_List_full.xlsx"
$tbaCsv = Join-Path $workspacePath "outputs\timber_frame_cutting_list\exports\tba_items.csv"
$copiedBuilder = Join-Path $workspacePath ".timber-frame-cutting-list\build_timber_frame_workbook.mjs"
$copiedVerifier = Join-Path $workspacePath ".timber-frame-cutting-list\verify_workbook.mjs"

if (-not (Test-Path -LiteralPath $NodeExe)) {
  throw "Node executable not found: $NodeExe"
}
if (-not (Test-Path -LiteralPath $SkillRunBuild)) {
  throw "Skill build runner not found: $SkillRunBuild"
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Manifest not found. Run scripts\run_pdf_schedule_pipeline.ps1 first."
}

Push-Location -LiteralPath $workspacePath
try {
  & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe
  if ($LASTEXITCODE -ne 0) {
    throw "Clean build before stale test failed with exit code $LASTEXITCODE"
  }

  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $manifest.files.crosscheckCsv.sha256 = "0000000000000000000000000000000000000000000000000000000000000000"
  $staleJson = $manifest | ConvertTo-Json -Depth 12
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($staleManifestPath, $staleJson, $utf8NoBom)

  & $NodeExe $copiedBuilder --mode full --opening-manifest $staleManifestPath
  if ($LASTEXITCODE -ne 0) {
    throw "Stale-manifest workbook build failed with exit code $LASTEXITCODE"
  }

  $tbaText = Get-Content -Raw -LiteralPath $tbaCsv
  if (-not $tbaText.Contains("Source / Pipeline Check")) {
    throw "TBA CSV did not include Source / Pipeline Check for stale manifest."
  }

  $ErrorActionPreference = "Continue"
  & $NodeExe $copiedVerifier --workbook $fullWorkbook --mode full --project-workspace $workspacePath --opening-manifest $staleManifestPath *> $staleLogPath
  $verifyExit = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($verifyExit -eq 0) {
    throw "Verifier passed with stale manifest; expected failure."
  }

  $staleLog = Get-Content -Raw -LiteralPath $staleLogPath
  if (-not $staleLog.Contains("Source manifest is stale")) {
    throw "Verifier failure did not report stale source manifest."
  }

  Write-Output "STALE_MANIFEST_TEST expectedVerifierExit=$verifyExit"
}
finally {
  $ErrorActionPreference = "Continue"
  & $SkillRunBuild -ProjectWorkspace $workspacePath -Mode full -NodeExe $NodeExe | Out-Host
  Remove-Item -LiteralPath $staleManifestPath, $staleLogPath -ErrorAction SilentlyContinue
  Pop-Location
}

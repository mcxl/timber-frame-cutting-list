import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { validateDwgTakeoffManifest, validateOpeningScheduleManifest } from "./lib/source_manifest.mjs";

const cliArgs = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    cliArgs.set(key, next);
    i += 1;
  } else {
    cliArgs.set(key, true);
  }
}

const workbookPath = cliArgs.get("workbook");
const mode = cliArgs.get("mode") || "full";
const projectWorkspace = path.resolve(cliArgs.get("project-workspace") || process.cwd());

if (!workbookPath) {
  throw new Error("Missing --workbook <path>.");
}
if (!["full", "measurement"].includes(mode)) {
  throw new Error(`Unsupported --mode '${mode}'.`);
}

const requiredFullSheets = [
  "Inputs & Assumptions",
  "PDF Takeoff Import",
  "Wall Measurements",
  "Opening Schedule",
  "Opening Schedule Check",
  "LVL Cutting Optimizer",
  "Bulk Framing Takeoff",
  "Floor Framing",
  "Engineering Details Check",
  "AS 1684 Check Register",
  "Source Manifest",
  "Order Summary",
  "Engineer RFI",
  "Export - LVL",
  "Export - Framing Timber",
  "Export - Floor",
  "Export - TBA",
  "QA Checks",
];

const requiredMeasurementSheets = [
  "Inputs & Assumptions",
  "PDF Takeoff Import",
  "Wall Measurements",
  "Opening Schedule",
  "Opening Schedule Check",
  "Floor Framing",
  "Engineering Details Check",
  "AS 1684 Check Register",
  "Source Manifest",
  "QA Checks",
];

const failures = [];
const warnings = [];

function assertCheck(condition, message) {
  if (!condition) failures.push(message);
}

function finalCutLength(clearSpanMm, bearingMm = 300) {
  return clearSpanMm == null || clearSpanMm === "" ? "" : clearSpanMm + bearingMm;
}

function blockingRows(spanMm) {
  if (spanMm === "" || spanMm == null) return "";
  if (spanMm > 6000) return "TBA";
  if (spanMm < 3000) return 0;
  if (spanMm <= 4200) return 1;
  return 2;
}

function as1684Completion(status, checkedBy, checkedDate, ref) {
  if (status === "Not Applicable") return "Complete";
  if (status !== "OK") return status;
  return checkedBy && checkedDate && ref ? "Complete" : "Audit Incomplete";
}

function exportLineStatus({ quantity = 0, missingMeasure = false, engineerTba = false, as1684Block = false } = {}) {
  if (missingMeasure || quantity === "" || quantity == null || Number(quantity) === 0) return "Pending Measure";
  if (engineerTba) return "Engineer TBA";
  if (as1684Block) return "Check AS 1684";
  return "Ready";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => String(value ?? "").trim() !== ""));
}

function csvToRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function loadImportMeasurements(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return Array.isArray(parsed.measurements) ? parsed.measurements : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function runRegressionFixtures() {
  const fixtureFailures = [];
  const check = (condition, message) => {
    if (!condition) fixtureFailures.push(message);
  };

  check(finalCutLength(1200) === 1500, "Fixture final cut should add 300mm bearing.");
  check(finalCutLength(5920) > 6000, "Fixture over-6m LVL should exceed standard stock.");
  check(finalCutLength("") === "", "Fixture missing span should stay blank.");
  check(blockingRows(2500) === 0, "Fixture <3000mm span should have 0 blocking rows.");
  check(blockingRows(3000) === 1, "Fixture 3000mm span should have 1 blocking row.");
  check(blockingRows(4200) === 1, "Fixture 4200mm span should have 1 blocking row.");
  check(blockingRows(4201) === 2, "Fixture >4200mm span should have 2 blocking rows.");
  check(blockingRows(6001) === "TBA", "Fixture >6000mm span should be TBA.");
  check(as1684Completion("OK", "", "", "") === "Audit Incomplete", "Fixture AS 1684 OK row without audit fields should be incomplete.");
  check(as1684Completion("OK", "AR", "2026-07-08", "Table ref") === "Complete", "Fixture AS 1684 audited OK row should be complete.");
  check(exportLineStatus({ quantity: 1 }) === "Ready", "Fixture positive ready line should be Ready.");
  check(exportLineStatus({ quantity: 1, as1684Block: true }) === "Check AS 1684", "Fixture AS blocked line should be Check AS 1684.");
  check(exportLineStatus({ quantity: 1, engineerTba: true }) === "Engineer TBA", "Fixture engineering blocked line should be Engineer TBA.");
  check(exportLineStatus({ missingMeasure: true }) === "Pending Measure", "Fixture missing measure line should be Pending Measure.");

  return fixtureFailures;
}

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const requiredSheets = mode === "full" ? requiredFullSheets : requiredMeasurementSheets;

for (const sheetName of requiredSheets) {
  try {
    workbook.worksheets.getItem(sheetName);
  } catch {
    failures.push(`Missing required sheet: ${sheetName}`);
  }
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "verification formula error scan",
  maxChars: 3000,
});
assertCheck(errors.ndjson.includes("Cell search matched 0 entries"), "Workbook formula error scan found error cells.");

const openingSheet = workbook.worksheets.getItem("Opening Schedule");
const openingHeaders = openingSheet.getRange("A4:U4").values[0].map((value) => String(value ?? ""));
assertCheck(openingHeaders.includes("Wall ID"), "Opening Schedule is missing Wall ID column.");
assertCheck(openingHeaders.includes("Top Cripple Qty"), "Opening Schedule is missing Top Cripple Qty column.");
assertCheck(openingHeaders.includes("Bottom Cripple Qty"), "Opening Schedule is missing Bottom Cripple Qty column.");
assertCheck(openingHeaders.includes("Cripple Status"), "Opening Schedule is missing Cripple Status column.");
const openingFormulas = openingSheet.getRange("K5:T5").formulas?.[0] || [];
assertCheck(String(openingFormulas[0] || "").includes("Inputs & Assumptions"), "Opening Schedule bearing formula is missing.");
assertCheck(String(openingFormulas[1] || "").includes("F5+K5"), "Opening Schedule final cut formula is not clear span plus bearing.");
assertCheck(String(openingFormulas[5] || "").includes("Wall Measurements"), "Opening Schedule cripple quantity formula is not linked to wall stud spacing.");

const openingCheckSheet = workbook.worksheets.getItem("Opening Schedule Check");
const openingCheckHeaders = openingCheckSheet.getRange("A4:O4").values[0].map((value) => String(value ?? ""));
assertCheck(openingCheckHeaders.includes("Opening ID"), "Opening Schedule Check is missing Opening ID column.");
assertCheck(openingCheckHeaders.includes("Status"), "Opening Schedule Check is missing Status column.");
assertCheck(openingCheckHeaders.includes("Review Status"), "Opening Schedule Check is missing Review Status column.");
assertCheck(openingCheckHeaders.includes("Source Ref"), "Opening Schedule Check is missing Source Ref column.");
assertCheck(openingCheckHeaders.includes("PDF Clear Span mm"), "Opening Schedule Check is missing PDF Clear Span mm column.");
assertCheck(openingCheckHeaders.includes("Reviewed By"), "Opening Schedule Check is missing Reviewed By column.");
assertCheck(openingCheckHeaders.includes("Reviewed Date"), "Opening Schedule Check is missing Reviewed Date column.");

const pdfImportSheet = workbook.worksheets.getItem("PDF Takeoff Import");
const pdfImportHeaders = pdfImportSheet.getRange("A4:U4").values[0].map((value) => String(value ?? ""));
assertCheck(pdfImportHeaders.includes("Review Status"), "PDF Takeoff Import is missing Review Status column.");
assertCheck(pdfImportHeaders.includes("Source PDF"), "PDF Takeoff Import is missing Source PDF column.");
assertCheck(pdfImportHeaders.includes("Sheet Number"), "PDF Takeoff Import is missing Sheet Number column.");
assertCheck(pdfImportHeaders.includes("Calibration Source"), "PDF Takeoff Import is missing Calibration Source column.");

const wallMeasurementSheet = workbook.worksheets.getItem("Wall Measurements");
const wallMeasurementHeaders = wallMeasurementSheet.getRange("A4:N4").values[0].map((value) => String(value ?? ""));
assertCheck(wallMeasurementHeaders.includes("Base Stud Qty"), "Wall Measurements is missing Base Stud Qty helper column.");

let expectedTakeoffUnresolvedCount = null;
let expectedOpeningScheduleUnresolvedCount = null;
const pdfImportPath = path.resolve(projectWorkspace, "inputs", "pdf_takeoff_import.json");
const dwgImportPath = path.resolve(projectWorkspace, "inputs", "dwg_takeoff_import.json");
try {
  const pdfTakeoffMeasurements = await loadImportMeasurements(pdfImportPath);
  const dwgTakeoffMeasurements = await loadImportMeasurements(dwgImportPath);
  const takeoffMeasurements = [
    ...pdfTakeoffMeasurements,
    ...dwgTakeoffMeasurements,
  ];
  expectedTakeoffUnresolvedCount = takeoffMeasurements.filter((measurement) => measurement.reviewStatus !== "Reviewed").length;
  const importIds = pdfImportSheet.getRange("A5:A154").values.flat().map((value) => String(value ?? ""));
  const firstImportId = takeoffMeasurements[0]?.id;
  if (firstImportId) {
    assertCheck(importIds.includes(firstImportId), "Takeoff Import Staging does not include the first normalized import row.");
  }
  const firstReviewedWall = pdfTakeoffMeasurements.find((measurement) => (
    measurement.reviewStatus === "Reviewed"
    && measurement.targetWorkbookSheet === "Wall Measurements"
    && measurement.measurementType === "linear"
  ));
  if (firstReviewedWall) {
    const wallIds = wallMeasurementSheet.getRange("C5:C84").values.flat().map((value) => String(value ?? ""));
    assertCheck(wallIds.includes(firstReviewedWall.wallId || firstReviewedWall.id), "Reviewed takeoff wall measurement did not roll into Wall Measurements.");
    const baseStudCounts = wallMeasurementSheet.getRange("N5:N84").values.flat().map((value) => Number(value || 0));
    assertCheck(baseStudCounts.some((value) => value > 0), "Reviewed takeoff wall measurement did not calculate a base stud quantity.");
  }
  const firstReviewedArea = pdfTakeoffMeasurements.find((measurement) => (
    measurement.reviewStatus === "Reviewed"
    && measurement.targetWorkbookSheet === "Floor Framing"
    && measurement.measurementType === "area"
  ));
  if (firstReviewedArea) {
    const floorZoneIds = workbook.worksheets.getItem("Floor Framing").getRange("B5:B34").values.flat().map((value) => String(value ?? ""));
    assertCheck(floorZoneIds.includes(firstReviewedArea.zoneId || firstReviewedArea.id), "Reviewed takeoff floor area measurement did not roll into Floor Framing.");
  }
} catch (error) {
  failures.push(`Could not read normalized takeoff import fixture: ${error.message}`);
}

const openingCrosscheckPath = path.resolve(projectWorkspace, "outputs", "opening_schedule_crosscheck.csv");
const openingManifestArg = cliArgs.get("opening-manifest") || path.join("outputs", "pdf_plan_index", "opening_schedule_crosscheck_manifest.json");
const openingManifestPath = path.isAbsolute(openingManifestArg) ? openingManifestArg : path.resolve(projectWorkspace, openingManifestArg);
const sourcePipelineCheck = await validateOpeningScheduleManifest(openingCrosscheckPath, openingManifestPath);
const dwgManifestArg = cliArgs.get("dwg-manifest") || path.join("outputs", "dwg_takeoff", "dwg_takeoff_manifest.json");
const dwgManifestPath = path.isAbsolute(dwgManifestArg) ? dwgManifestArg : path.resolve(projectWorkspace, dwgManifestArg);
const dwgSourceCheck = await validateDwgTakeoffManifest(dwgImportPath, dwgManifestPath);
const sourceFreshnessIssueCount = sourcePipelineCheck.issueCount + dwgSourceCheck.issueCount;
const sourceFreshnessNotes = [sourcePipelineCheck, dwgSourceCheck]
  .filter((check) => check.issueCount > 0)
  .map((check) => check.notes)
  .join(" ") || "Source manifests and hashes are current.";
try {
  const openingCrosscheck = csvToRecords(await fs.readFile(openingCrosscheckPath, "utf8"));
  expectedOpeningScheduleUnresolvedCount = openingCrosscheck.filter((row) => row.openingId && row.reviewStatus !== "Reviewed").length;
  const workbookOpeningCheckIds = openingCheckSheet.getRange("D5:D154").values.flat().map((value) => String(value ?? ""));
  const firstCrosscheckId = openingCrosscheck.find((row) => row.openingId)?.openingId;
  if (firstCrosscheckId) {
    assertCheck(workbookOpeningCheckIds.includes(firstCrosscheckId), "Opening Schedule Check does not include the first cross-check row.");
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    failures.push(`Could not read opening schedule cross-check CSV: ${error.message}`);
  }
}

const qaSheet = workbook.worksheets.getItem("QA Checks");
const qaValues = qaSheet.getRange("A5:C23").values.flat().map((value) => String(value ?? ""));
assertCheck(qaValues.includes("Drawing revision control"), "QA Checks does not include drawing revision control.");
assertCheck(qaValues.includes("Workbook status"), "QA Checks does not include workbook status.");
assertCheck(qaValues.includes("AS 1684 audit incomplete"), "QA Checks does not include AS 1684 audit incomplete check.");
assertCheck(qaValues.includes("Cripple stud inputs"), "QA Checks does not include cripple stud input check.");
assertCheck(qaValues.includes("Takeoff import review status"), "QA Checks does not include takeoff import review status check.");
assertCheck(qaValues.includes("Opening schedule cross-check"), "QA Checks does not include opening schedule cross-check status.");
assertCheck(qaValues.includes("Source / Pipeline Check"), "QA Checks does not include source/pipeline freshness check.");
assertCheck(qaValues.includes("Measurement Ready"), "QA Checks does not include Measurement Ready status.");
assertCheck(qaValues.includes("Schedule Cross-Check Ready"), "QA Checks does not include Schedule Cross-Check Ready status.");
assertCheck(qaValues.includes("AS 1684 / Engineering Ready"), "QA Checks does not include AS 1684 / Engineering Ready status.");
assertCheck(qaValues.includes("Supplier Order Ready"), "QA Checks does not include Supplier Order Ready status.");
if (expectedTakeoffUnresolvedCount != null) {
  const pdfReviewQaRow = qaSheet.getRange("A17:C17").values[0];
  assertCheck(Number(pdfReviewQaRow?.[1] || 0) === expectedTakeoffUnresolvedCount, "QA takeoff import review count does not match normalized import data.");
}
if (expectedOpeningScheduleUnresolvedCount != null) {
  const openingCheckQaRow = qaSheet.getRange("A18:C18").values[0];
  assertCheck(Number(openingCheckQaRow?.[1] || 0) === expectedOpeningScheduleUnresolvedCount, "QA opening schedule cross-check count does not match cross-check CSV.");
}
const sourcePipelineQaRow = qaSheet.getRange("A19:C19").values[0];
assertCheck(Number(sourcePipelineQaRow?.[1] || 0) === sourceFreshnessIssueCount, "QA source/pipeline check count does not match manifest validation.");
assertCheck(sourceFreshnessIssueCount === 0, `Source manifest is stale: ${sourceFreshnessNotes}`);

const sourceManifestSheet = workbook.worksheets.getItem("Source Manifest");
const sourceManifestHeaders = sourceManifestSheet.getRange("A4:I4").values[0].map((value) => String(value ?? ""));
assertCheck(sourceManifestHeaders.includes("Manifest SHA256"), "Source Manifest is missing Manifest SHA256 column.");
assertCheck(sourceManifestHeaders.includes("Current SHA256"), "Source Manifest is missing Current SHA256 column.");
assertCheck(sourceManifestHeaders.includes("Status"), "Source Manifest is missing Status column.");
const sourceManifestStatuses = sourceManifestSheet.getRange("H5:H32").values.flat().map((value) => String(value ?? ""));
if (sourcePipelineCheck.fileChecks.length || dwgSourceCheck.fileChecks.length) {
  assertCheck(sourceManifestStatuses.includes("Current"), "Source Manifest does not show current source file status.");
}

const engineeringSheet = workbook.worksheets.getItem("Engineering Details Check");
const engineeringHeaders = engineeringSheet.getRange("A4:P4").values[0].map((value) => String(value ?? ""));
assertCheck(engineeringHeaders.includes("Workbook Assumption Ref"), "Engineering Details Check is missing Workbook Assumption Ref column.");
assertCheck(engineeringHeaders.includes("Engineer Member Ref"), "Engineering Details Check is missing Engineer Member Ref column.");
assertCheck(engineeringHeaders.includes("Affected Order Component"), "Engineering Details Check is missing Affected Order Component column.");
assertCheck(engineeringHeaders.includes("Overrides Workbook?"), "Engineering Details Check is missing Overrides Workbook? column.");
assertCheck(engineeringHeaders.includes("Order Impact"), "Engineering Details Check is missing Order Impact column.");

const asSheet = workbook.worksheets.getItem("AS 1684 Check Register");
const asHeaders = asSheet.getRange("A4:L4").values[0].map((value) => String(value ?? ""));
assertCheck(asHeaders.includes("Checked By"), "AS 1684 Check Register is missing Checked By column.");
assertCheck(asHeaders.includes("Reference Clause/Table"), "AS 1684 Check Register is missing Reference Clause/Table column.");
assertCheck(asHeaders.includes("Completion Status"), "AS 1684 Check Register is missing Completion Status column.");
const asCompletionFormula = String(asSheet.getRange("L5:L5").formulas?.[0]?.[0] || "");
assertCheck(asCompletionFormula.includes("Audit Incomplete"), "AS 1684 completion formula does not enforce audit fields.");

if (mode === "full") {
  const bulkSheet = workbook.worksheets.getItem("Bulk Framing Takeoff");
  const bulkValues = bulkSheet.getRange("A5:D14").values;
  const groundBaseStudRow = bulkValues.find((row) => row[0] === "Ground Floor Base Wall Studs");
  const calculatedWallStuds = wallMeasurementSheet.getRange("N5:N84").values.flat().some((value) => Number(value || 0) > 0);
  if (calculatedWallStuds) {
    assertCheck(Number(groundBaseStudRow?.[3] || 0) > 0, "Bulk Framing Takeoff did not sum calculated wall base studs.");
  }

  const exportDir = path.resolve(projectWorkspace, "outputs", "timber_frame_cutting_list", "exports");
  const csvFiles = ["lvl_order_ready.csv", "framing_timber_ready.csv", "floor_ready.csv", "tba_items.csv"];
  for (const fileName of csvFiles) {
    const filePath = path.join(exportDir, fileName);
    try {
      const text = await fs.readFile(filePath, "utf8");
      assertCheck(text.trim().length > 0, `CSV export is empty: ${fileName}`);
      if (fileName === "tba_items.csv" && text.trim().split(/\r?\n/).length < 2) {
        failures.push("TBA CSV does not contain unresolved item rows.");
      }
    } catch {
      failures.push(`Missing CSV export: ${fileName}`);
    }
  }

  const orderSheet = workbook.worksheets.getItem("Order Summary");
  const orderHeaders = orderSheet.getRange("A4:J4").values[0].map((value) => String(value ?? ""));
  assertCheck(orderHeaders.includes("Source Ref"), "Order Summary is missing Source Ref column.");
  const orderValues = orderSheet.getRange("A5:A20").values.flat().map((value) => String(value ?? ""));
  assertCheck(orderValues.includes("Cripple Studs"), "Order Summary is missing Cripple Studs row.");
  const orderStatusFormulas = orderSheet.getRange("H5:H20").formulas.flat().map((value) => String(value ?? "")).join(" ");
  assertCheck(orderStatusFormulas.includes("PDF Takeoff Import"), "Order Summary statuses do not reference PDF Takeoff Import review status.");
  assertCheck(orderStatusFormulas.includes("Opening Schedule Check"), "Order Summary statuses do not reference Opening Schedule Check review status.");
  assertCheck(orderStatusFormulas.includes("QA Checks"), "Order Summary statuses do not reference source/pipeline QA status.");

  const exportLvlSheet = workbook.worksheets.getItem("Export - LVL");
  const exportLvlHeaders = exportLvlSheet.getRange("A4:H4").values[0].map((value) => String(value ?? ""));
  assertCheck(exportLvlHeaders.includes("Line Status"), "Export - LVL is missing Line Status column.");

  const exportTbaSheet = workbook.worksheets.getItem("Export - TBA");
  const exportTbaHeaders = exportTbaSheet.getRange("A4:H4").values[0].map((value) => String(value ?? ""));
  assertCheck(exportTbaHeaders.includes("Source Ref"), "Export - TBA is missing Source Ref column.");
  const exportTbaFormulas = exportTbaSheet.getRange("A5:H500").formulas.flat().map((value) => String(value ?? "")).join(" ");
  assertCheck(exportTbaFormulas.includes("PDF Takeoff Import"), "Export - TBA does not include PDF import review blockers.");
  assertCheck(exportTbaFormulas.includes("Opening Schedule Check"), "Export - TBA does not include opening schedule cross-check blockers.");
  assertCheck(exportTbaFormulas.includes("QA Checks"), "Export - TBA does not include source/pipeline freshness blockers.");
  if (expectedOpeningScheduleUnresolvedCount && expectedOpeningScheduleUnresolvedCount > 0) {
    const tbaCsvPath = path.resolve(projectWorkspace, "outputs", "timber_frame_cutting_list", "exports", "tba_items.csv");
    const tbaCsvText = await fs.readFile(tbaCsvPath, "utf8");
    assertCheck(tbaCsvText.includes("Opening Schedule Check"), "TBA CSV does not include unresolved opening schedule cross-check rows.");
  }
  if (sourceFreshnessIssueCount > 0) {
    const tbaCsvPath = path.resolve(projectWorkspace, "outputs", "timber_frame_cutting_list", "exports", "tba_items.csv");
    const tbaCsvText = await fs.readFile(tbaCsvPath, "utf8");
    assertCheck(tbaCsvText.includes("Source / Pipeline Check"), "TBA CSV does not include stale source/pipeline rows.");
  }
} else {
  for (const fullOnlySheet of ["Order Summary", "Export - LVL", "Export - Framing Timber", "Export - Floor", "Export - TBA"]) {
    try {
      workbook.worksheets.getItem(fullOnlySheet);
      failures.push(`Measurement mode should not include full-only sheet: ${fullOnlySheet}`);
    } catch {
      // Expected.
    }
  }
}

const fixtureFailures = runRegressionFixtures();
for (const failure of fixtureFailures) {
  failures.push(`Regression fixture failed: ${failure}`);
}

const result = {
  kind: "workbook-verification",
  mode,
  workbook: workbookPath,
  warnings,
  fixtureFailures,
  failures,
};

console.log(JSON.stringify(result));
if (failures.length) {
  throw new Error(`Workbook verification failed: ${failures.join("; ")}`);
}

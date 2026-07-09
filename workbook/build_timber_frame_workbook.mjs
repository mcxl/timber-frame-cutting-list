import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { validateDwgTakeoffManifest, validateOpeningScheduleManifest } from "./lib/source_manifest.mjs";

const outputDir = path.resolve("outputs", "timber_frame_cutting_list");
await fs.mkdir(outputDir, { recursive: true });

const cliArgs = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      cliArgs.set(key, next);
      i += 1;
    } else {
      cliArgs.set(key, true);
    }
  }
}

const workbookMode = cliArgs.get("mode") || "full";
if (!["full", "measurement"].includes(workbookMode)) {
  throw new Error(`Unsupported workbook mode '${workbookMode}'. Use 'full' or 'measurement'.`);
}
const skipRender = Boolean(cliArgs.get("skip-render"));

const stockProfiles = {
  "LVL 6000": {
    lvlStockMm: 6000,
    plateStockMm: [4800, 5400, 6000],
    nogginStockMm: [4800, 5400, 6000],
    studPrecutMm: [2700, 2740, 3000],
  },
};

const activeStockProfile = stockProfiles["LVL 6000"];

async function loadJsonObject(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== "" && value != null) return value;
  }
  return "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function isTbaText(value) {
  const text = cleanText(value);
  return text === "" || /\bTBA\b/i.test(text);
}

function isReviewedRecord(record) {
  return cleanText(record?.reviewStatus || record?.status).toLowerCase() === "reviewed";
}

const project = {
  name: "Sample Duplex Timber Framing Takeoff + Cutting List",
  address: "Sample Duplex Site, NSW",
  scope: "Measure + Order",
  workbookMode,
  activeStockProfile: "LVL 6000",
  architecturalDrawingNo: "TBA",
  architecturalRevision: "TBA",
  architecturalDateReceived: "",
  engineeringDrawingNo: "TBA",
  engineeringRevision: "TBA",
  engineeringDateReceived: "",
  estimator: "TBA",
  measurementDate: "",
  measurementSource: "TBA",
  workbookStatus: "Draft",
  sawKerfMm: 0,
  stockLengthMm: 6000,
  bearingEachEndMm: 150,
  wallWastePct: 10,
  externalStudSpacingMm: 450,
  internalStudSpacingMm: 600,
  floorToFloorHeightMm: 3350,
  upperFloorJoistDepthMm: 240,
  plateThicknessAllowanceMm: 135,
  nogginRows: 2,
  deckingWastePct: 10,
  bracingWastePct: 10,
  alphafloorSheetAreaM2: 2.88,
  structuralPlySheetAreaM2: 2.88,
  lintelMaterial: "LVL",
  as1684Part: "AS 1684.2:2021",
  windClassification: "TBA",
  windClassificationSource: "Engineer / certifier / plans TBA",
  buildingClass: "Class 1a / Class 10a TBA",
  bracingSource: "Bracing plan TBA",
  complianceMethod: "NCC DTS via AS 1684 / Engineer TBA",
};

const projectAssumptionsPath = path.resolve(cliArgs.get("project-assumptions") || "inputs/project_assumptions.json");
const projectAssumptions = await loadJsonObject(projectAssumptionsPath);
const reviewedProjectAssumptions = isReviewedRecord(projectAssumptions);
if (reviewedProjectAssumptions) {
  const architectural = projectAssumptions.drawingRegister?.architectural || {};
  const engineering = projectAssumptions.drawingRegister?.engineering || {};
  Object.assign(project, {
    architecturalDrawingNo: firstPresent(projectAssumptions.architecturalDrawingNo, architectural.drawingNo, project.architecturalDrawingNo),
    architecturalRevision: firstPresent(projectAssumptions.architecturalRevision, architectural.revision, project.architecturalRevision),
    architecturalDateReceived: firstPresent(projectAssumptions.architecturalDateReceived, architectural.dateReceived, project.architecturalDateReceived),
    engineeringDrawingNo: firstPresent(projectAssumptions.engineeringDrawingNo, engineering.drawingNo, project.engineeringDrawingNo),
    engineeringRevision: firstPresent(projectAssumptions.engineeringRevision, engineering.revision, project.engineeringRevision),
    engineeringDateReceived: firstPresent(projectAssumptions.engineeringDateReceived, engineering.dateReceived, project.engineeringDateReceived),
    estimator: firstPresent(projectAssumptions.estimator, project.estimator),
    measurementDate: firstPresent(projectAssumptions.measurementDate, project.measurementDate),
    measurementSource: firstPresent(projectAssumptions.measurementSource, project.measurementSource),
    workbookStatus: firstPresent(projectAssumptions.workbookStatus, project.workbookStatus),
    windClassification: firstPresent(projectAssumptions.windClassification, project.windClassification),
    windClassificationSource: firstPresent(projectAssumptions.windClassificationSource, project.windClassificationSource),
    buildingClass: firstPresent(projectAssumptions.buildingClass, project.buildingClass),
    bracingSource: firstPresent(projectAssumptions.bracingSource, project.bracingSource),
    complianceMethod: firstPresent(projectAssumptions.complianceMethod, project.complianceMethod),
  });
}

project.stockLengthMm = stockProfiles[project.activeStockProfile]?.lvlStockMm || project.stockLengthMm;
const totalBearingAllowanceMm = project.bearingEachEndMm * 2;
const groundFloorStudLengthMm = project.floorToFloorHeightMm - project.upperFloorJoistDepthMm - project.plateThicknessAllowanceMm;
const TAKEOFF_IMPORT_ROW_COUNT = 150;

async function loadTakeoffImport(filePath, sourceSystemFallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const source = parsed.source || {};
    const measurements = Array.isArray(parsed.measurements)
      ? parsed.measurements.map((measurement) => ({
        sourceSystem: measurement.sourceSystem || source.system || sourceSystemFallback,
        ...measurement,
      }))
      : [];
    return {
      path: filePath,
      project: parsed.project || "",
      source,
      measurements,
      missing: false,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: filePath, project: "", source: {}, measurements: [], missing: true };
    }
    throw error;
  }
}

const pdfTakeoffImportPath = path.resolve(cliArgs.get("pdf-import") || "inputs/pdf_takeoff_import.json");
const dwgTakeoffImportPath = path.resolve(cliArgs.get("dwg-import") || "inputs/dwg_takeoff_import.json");
const pdfTakeoffImport = await loadTakeoffImport(pdfTakeoffImportPath, "OpenTakeoff");
const dwgTakeoffImport = await loadTakeoffImport(dwgTakeoffImportPath, "DWG");
const pdfMeasurements = pdfTakeoffImport.measurements;
const dwgMeasurements = dwgTakeoffImport.measurements;
const takeoffMeasurements = [...pdfMeasurements, ...dwgMeasurements];
const reviewedTakeoffMeasurements = takeoffMeasurements.filter((measurement) => measurement.reviewStatus === "Reviewed");
const reviewedPdfTakeoffMeasurements = pdfMeasurements.filter((measurement) => measurement.reviewStatus === "Reviewed");
const pendingTakeoffMeasurements = takeoffMeasurements.filter((measurement) => measurement.id && measurement.reviewStatus !== "Reviewed");
const openingScheduleCrosscheckPath = path.resolve(cliArgs.get("opening-crosscheck") || "outputs/opening_schedule_crosscheck.csv");
const openingScheduleCrosscheckRows = await loadCsvRecords(openingScheduleCrosscheckPath);
const unresolvedOpeningScheduleChecks = openingScheduleCrosscheckRows.filter((row) => row.openingId && row.reviewStatus !== "Reviewed");
const openingScheduleManifestPath = path.resolve(cliArgs.get("opening-manifest") || "outputs/pdf_plan_index/opening_schedule_crosscheck_manifest.json");
const dwgTakeoffManifestPath = path.resolve(cliArgs.get("dwg-manifest") || "outputs/dwg_takeoff/dwg_takeoff_manifest.json");
const sourcePipelineCheck = await validateOpeningScheduleManifest(openingScheduleCrosscheckPath, openingScheduleManifestPath);
const dwgSourceCheck = await validateDwgTakeoffManifest(dwgTakeoffImportPath, dwgTakeoffManifestPath);
const sourceFreshnessCheck = {
  issueCount: sourcePipelineCheck.issueCount + dwgSourceCheck.issueCount,
  status: sourcePipelineCheck.issueCount + dwgSourceCheck.issueCount ? "Stale Source" : "OK",
  result: sourcePipelineCheck.issueCount + dwgSourceCheck.issueCount ? `${sourcePipelineCheck.issueCount + dwgSourceCheck.issueCount} issue${sourcePipelineCheck.issueCount + dwgSourceCheck.issueCount === 1 ? "" : "s"}` : "Current",
  action: [sourcePipelineCheck, dwgSourceCheck].filter((check) => check.issueCount > 0).map((check) => check.action).join(" ") || "No action required.",
  notes: [sourcePipelineCheck, dwgSourceCheck].filter((check) => check.issueCount > 0).map((check) => check.notes).join(" ") || "Source manifests and hashes are current.",
  sourceRef: [sourcePipelineCheck.sourceRef, dwgSourceCheck.sourceRef].filter((sourceRef) => sourceRef && sourceRef !== "Not run").join(" | "),
};

if (takeoffMeasurements.length) {
  const sourceLabels = [
    pdfMeasurements.length ? `PDF/OpenTakeoff (${pdfMeasurements.length} row${pdfMeasurements.length === 1 ? "" : "s"})` : "",
    dwgMeasurements.length ? `DWG Takeoff (${dwgMeasurements.length} row${dwgMeasurements.length === 1 ? "" : "s"})` : "",
  ].filter(Boolean);
  if (!reviewedProjectAssumptions || isTbaText(projectAssumptions.measurementSource)) {
    project.measurementSource = `Takeoff Import: ${sourceLabels.join(" + ")}`;
  }
  if (!reviewedProjectAssumptions || isTbaText(projectAssumptions.workbookStatus) || cleanText(projectAssumptions.workbookStatus) === "Draft") {
    project.workbookStatus = pendingTakeoffMeasurements.length ? "Engineer Review" : "Measured";
  }
}

const workbook = Workbook.create();

const fullSheetNames = [
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

const measurementSheetNames = [
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

const sheetNames = project.workbookMode === "measurement" ? measurementSheetNames : fullSheetNames;
const sheets = Object.fromEntries(sheetNames.map((name) => [name, workbook.worksheets.add(name)]));

const colors = {
  navy: "#17365D",
  teal: "#0F766E",
  header: "#1F4E78",
  input: "#D9EAF7",
  assumption: "#E7E6E6",
  calc: "#FFFFFF",
  amber: "#FCE4D6",
  warning: "#C00000",
  paleGreen: "#E2F0D9",
  border: "#D9E2F3",
  darkText: "#1F2937",
};

const qaFailures = [];
const qaWarnings = [];

function qaCheck(condition, message, { fatal = false } = {}) {
  if (condition) return;
  if (fatal) {
    qaFailures.push(message);
  } else {
    qaWarnings.push(message);
  }
}

function setTitle(sheet, range, title, subtitle = "") {
  const titleRange = sheet.getRange(range);
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = {
    fill: colors.navy,
    font: { bold: true, color: "#FFFFFF", size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "middle",
  };
  titleRange.format.rowHeight = 28;
  if (subtitle) {
    const startCell = range.split(":")[0];
    const col = startCell.match(/[A-Z]+/)[0];
    const row = Number(startCell.match(/\d+/)[0]) + 1;
    const sub = sheet.getRange(`${col}${row}:H${row}`);
    sub.merge();
    sub.values = [[subtitle]];
    sub.format = {
      fill: "#EEF2F7",
      font: { italic: true, color: colors.darkText },
      wrapText: true,
    };
  }
}

function styleHeader(range) {
  range.format = {
    fill: colors.header,
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    wrapText: true,
  };
}

function styleTable(range) {
  range.format.borders = { preset: "all", style: "thin", color: colors.border };
}

function autofit(sheet) {
  sheet.getUsedRange(true).format.autofitColumns();
  sheet.getUsedRange(true).format.autofitRows();
}

function mmToMFormula(cell) {
  return `=IF(${cell}="","",${cell}/1000)`;
}

function cutLabel(cut) {
  return `${cut.id} ${cut.lengthMm}`;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeCsv(filePath, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  await fs.writeFile(filePath, csv, "utf8");
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

async function loadCsvRecords(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows[0].map((header) => String(header || "").trim());
    return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function asNumber(value, fallback = "") {
  if (value === "" || value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sourceNoteFromTakeoffMeasurement(measurement) {
  const parts = [
    measurement.sourceSystem,
    measurement.sourcePdf || measurement.sourceDwg,
    measurement.sheetNumber,
    measurement.pageNumber ? `p${measurement.pageNumber}` : "",
    measurement.sourceLayout ? `layout ${measurement.sourceLayout}` : "",
    measurement.sourceLayer ? `layer ${measurement.sourceLayer}` : "",
    measurement.sourceEntityHandle ? `entity ${measurement.sourceEntityHandle}` : "",
    measurement.drawingRevision ? `rev ${measurement.drawingRevision}` : "",
    measurement.calibrationSource,
  ].filter(Boolean);
  return parts.join(" | ");
}

function wallTypeFromTradeComponent(component) {
  if (component === "External Wall") return "External";
  if (component === "Internal Wall") return "Internal";
  if (component === "Bracing Panel") return "Bracing";
  return "";
}

function linearMetresFromMeasurement(measurement) {
  const direct = asNumber(measurement.valueM, null);
  if (direct != null) return direct;
  const raw = asNumber(measurement.value, null);
  if (raw == null) return "";
  if (measurement.unit === "mm") return raw / 1000;
  if (measurement.unit === "lf") return raw * 0.3048;
  return raw;
}

function squareMetresFromMeasurement(measurement) {
  const direct = asNumber(measurement.valueM2, null);
  if (direct != null) return direct;
  const raw = asNumber(measurement.value, null);
  if (raw == null) return "";
  if (measurement.unit === "sf") return raw * 0.09290304;
  return raw;
}

const takeoffWallImports = reviewedPdfTakeoffMeasurements.filter((measurement) => (
  measurement.targetWorkbookSheet === "Wall Measurements"
  && measurement.measurementType === "linear"
  && ["External Wall", "Internal Wall", "Bracing Panel"].includes(measurement.tradeComponent)
));

const takeoffFloorAreaImports = reviewedPdfTakeoffMeasurements.filter((measurement) => (
  measurement.targetWorkbookSheet === "Floor Framing"
  && measurement.measurementType === "area"
));

function binUsedMm(bin, sawKerfMm) {
  if (!bin.length) return 0;
  return bin.reduce((sum, item) => sum + item.lengthMm, 0) + Math.max(0, bin.length - 1) * sawKerfMm;
}

function canFit(bin, cut, stockLengthMm, sawKerfMm) {
  return binUsedMm([...bin, cut], sawKerfMm) <= stockLengthMm;
}

function improvePackedBins(initialBins, stockLengthMm, sawKerfMm) {
  const bins = initialBins.map((bin) => [...bin]);
  let improved = true;
  let passes = 0;

  while (improved && passes < 50) {
    improved = false;
    passes += 1;
    bins.sort((a, b) => binUsedMm(b, sawKerfMm) - binUsedMm(a, sawKerfMm));
    for (let sourceIndex = bins.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
      const source = bins[sourceIndex];
      if (!source?.length) continue;
      const trialBins = bins.map((bin) => [...bin]);
      const cutsToMove = [...trialBins[sourceIndex]].sort((a, b) => b.lengthMm - a.lengthMm);
      trialBins[sourceIndex] = [];
      let allMoved = true;
      for (const cut of cutsToMove) {
        let bestTarget = -1;
        let bestWaste = Infinity;
        for (let targetIndex = 0; targetIndex < trialBins.length; targetIndex += 1) {
          if (targetIndex === sourceIndex) continue;
          if (!canFit(trialBins[targetIndex], cut, stockLengthMm, sawKerfMm)) continue;
          const waste = stockLengthMm - binUsedMm([...trialBins[targetIndex], cut], sawKerfMm);
          if (waste < bestWaste) {
            bestTarget = targetIndex;
            bestWaste = waste;
          }
        }
        if (bestTarget === -1) {
          allMoved = false;
          break;
        }
        trialBins[bestTarget].push(cut);
      }
      if (allMoved) {
        bins.splice(0, bins.length, ...trialBins.filter((bin) => bin.length));
        improved = true;
        break;
      }
    }
  }

  return bins;
}

function packCuts(openingRows, stockLengthMm, bearingAllowanceMm, sawKerfMm = 0) {
  const standardCuts = [];
  const specialCuts = [];

  for (const [site, level, id, type, clearSpanMm] of openingRows) {
    if (clearSpanMm === "" || clearSpanMm == null) {
      specialCuts.push({ status: "TBA", id, clearSpanMm: "", lengthMm: "", note: "Missing clear span" });
      continue;
    }
    const lengthMm = clearSpanMm + bearingAllowanceMm;
    const cut = { site, level, id, type, clearSpanMm, lengthMm };
    if (lengthMm > stockLengthMm) {
      specialCuts.push({ status: "TBA", id, clearSpanMm, lengthMm, note: "Over stock length; engineer confirm LVL/steel" });
    } else {
      standardCuts.push(cut);
    }
  }

  standardCuts.sort((a, b) => b.lengthMm - a.lengthMm || a.id.localeCompare(b.id));
  const bins = [];
  for (const cut of standardCuts) {
    let bestIndex = -1;
    let bestUsed = -1;
    for (let i = 0; i < bins.length; i += 1) {
      const used = binUsedMm(bins[i], sawKerfMm);
      if (canFit(bins[i], cut, stockLengthMm, sawKerfMm) && used > bestUsed) {
        bestIndex = i;
        bestUsed = used;
      }
    }
    if (bestIndex === -1) {
      bins.push([cut]);
    } else {
      bins[bestIndex].push(cut);
    }
  }

  const improvedBins = improvePackedBins(bins, stockLengthMm, sawKerfMm);
  const packedRows = improvedBins.map((bin, index) => {
    const used = binUsedMm(bin, sawKerfMm);
    return [
      index + 1,
      bin.map(cutLabel).join(" + "),
      used,
      stockLengthMm - used,
      `=IF(C${index + 5}<='Inputs & Assumptions'!$B$9,"OK","DOES NOT FIT")`,
      bin.some((item) => item.clearSpanMm >= 3200) ? "Engineer confirmation required for large-span member(s)" : "Standard stock",
    ];
  });

  return { packedRows, specialCuts };
}

// Inputs & Assumptions
{
  const sheet = sheets["Inputs & Assumptions"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:H1", project.name, "Formula-driven workbook for field measurements, LVL lintels, framing takeoff, floor framing, order summary and engineer RFI tracking.");
  sheet.getRange("A4:D4").values = [["Assumption", "Value", "Unit", "Notes"]];
  styleHeader(sheet.getRange("A4:D4"));
  const rows = [
    ["Project", project.address, "", "Duplex framing estimate"],
    ["Workbook Scope", project.scope, "", "Field measurement capture plus purchase-ready summaries"],
    ["Workbook Mode", project.workbookMode, "", "measurement or full"],
    ["Active Stock Profile", project.activeStockProfile, "", "Select supplier stock profile"],
    ["Supplier Stock Length", project.stockLengthMm, "mm", "Used for LVL cutting optimizer"],
    ["Saw Kerf", project.sawKerfMm, "mm", "Optional allowance between cuts"],
    ["Bearing Each End", project.bearingEachEndMm, "mm", "Applied each side of clear opening"],
    ["Total Bearing Allowance", "=B11*2", "mm", "Added to clear span"],
    ["Wall Waste Factor", project.wallWastePct, "%", "Applied to plates/decking/bracing where noted"],
    ["External Stud Spacing", project.externalStudSpacingMm, "mm", "Default for external walls"],
    ["Internal Stud Spacing", project.internalStudSpacingMm, "mm", "Default for internal walls"],
    ["Floor-to-Floor Height", project.floorToFloorHeightMm, "mm", "Ground FFL 127.85 to first floor FFL 131.20"],
    ["Upper Floor Joist Depth", project.upperFloorJoistDepthMm, "mm", "Assumed until engineer confirms"],
    ["Plate Thickness Allowance", project.plateThicknessAllowanceMm, "mm", "Top/bottom plates allowance"],
    ["Ground Floor Stud Length", "=B16-B17-B18", "mm", "Default precut length"],
    ["Noggin Rows", project.nogginRows, "rows", "Default allowance for approx 2975mm wall frames"],
    ["Decking Waste Factor", project.deckingWastePct, "%", "Applied to Alphafloor sheet count"],
    ["Bracing Waste Factor", project.bracingWastePct, "%", "Applied to bracing sheet count"],
    ["Alphafloor Sheet Area", project.alphafloorSheetAreaM2, "m2", "Default 2400 x 1200 sheet coverage; update if supplier differs"],
    ["Structural Ply Sheet Area", project.structuralPlySheetAreaM2, "m2", "Default 2400 x 1200 sheet coverage; update if specified differently"],
    ["All Lintels Material", project.lintelMaterial, "", "Large spans remain engineer/TBA until confirmed"],
    ["AS 1684 Part", project.as1684Part, "", "Default for non-cyclonic residential timber framing"],
    ["Wind Classification", project.windClassification, "", "Required before AS 1684 table checks"],
    ["Wind Classification Source", project.windClassificationSource, "", "Engineer / certifier / plans"],
    ["Building Class", project.buildingClass, "", "Confirm NCC class"],
    ["Bracing Source", project.bracingSource, "", "Bracing plan or engineer notes"],
    ["Compliance Method", project.complianceMethod, "", "Estimating/checking aid only"],
    ["Plate Stock Options", activeStockProfile.plateStockMm.join(", "), "mm", "Supplier profile options for plates and similar linear timber"],
    ["Noggin Stock Options", activeStockProfile.nogginStockMm.join(", "), "mm", "Supplier profile options for noggins/blocking where applicable"],
    ["Precut Stud Options", activeStockProfile.studPrecutMm.join(", "), "mm", "Supplier profile options for precut studs"],
  ];
  sheet.getRange(`A5:D${4 + rows.length}`).values = rows;
  sheet.getRange(`B7:B${4 + rows.length}`).format.fill = colors.assumption;
  sheet.getRange("B9:B22").format.numberFormat = "#,##0";
  sheet.getRange("B23:B24").format.numberFormat = "#,##0.00";
  styleTable(sheet.getRange(`A4:D${4 + rows.length}`));
  sheet.getRange("F4:I4").values = [["Project Control Field", "Value", "Date / Status", "Notes"]];
  styleHeader(sheet.getRange("F4:I4"));
  sheet.getRange("F5:I14").values = [
    ["Architectural Drawing No.", project.architecturalDrawingNo, "", "Source drawing for measured walls/openings"],
    ["Architectural Revision", project.architecturalRevision, "", "Revision used for this estimate"],
    ["Architectural Date Received", "", project.architecturalDateReceived, ""],
    ["Engineering Drawing No.", project.engineeringDrawingNo, "", "Source drawing for structural member assumptions"],
    ["Engineering Revision", project.engineeringRevision, "", "Revision used for this estimate"],
    ["Engineering Date Received", "", project.engineeringDateReceived, ""],
    ["Estimator", project.estimator, "", ""],
    ["Measurement Date", "", project.measurementDate, ""],
    ["Measurement Source", project.measurementSource, "", "Site measure, architectural dimension, or other source"],
    ["Workbook Status", "", project.workbookStatus, "Draft, Measured, Engineer Review, or Ready For Order"],
  ];
  sheet.getRange("G5:H14").format.fill = colors.input;
  sheet.getRange("H7:H13").format.numberFormat = "yyyy-mm-dd";
  sheet.getRange("F4:I14").format.borders = { preset: "all", style: "thin", color: colors.border };
  const keyRow = 6 + rows.length;
  sheet.getRange(`A${keyRow}:H${keyRow}`).merge();
  sheet.getRange(`A${keyRow}:H${keyRow}`).values = [["Colour key: blue = user input, grey = assumption, white = formula/calculation, amber = engineer/TBA item, red text = warning."]];
  sheet.getRange(`A${keyRow}:H${keyRow}`).format = { fill: "#F8FAFC", font: { italic: true }, wrapText: true };
  sheet.freezePanes.freezeRows(4);
}

// Takeoff Import Staging
{
  const sheet = sheets["PDF Takeoff Import"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:U1", "Takeoff Import Staging", "Staging register for PDF/OpenTakeoff and DWG measurement imports. Only rows marked Reviewed roll into workbook calculation sheets.");
  sheet.getRange("A4:U4").values = [[
    "Import ID",
    "Target Workbook Sheet",
    "Condition",
    "Measurement Type",
    "Trade Component",
    "Site",
    "Level",
    "Wall ID",
    "Zone ID",
    "Opening ID",
    "Value",
    "Unit",
    "Source PDF",
    "Page",
    "Sheet Number",
    "Drawing Revision",
    "Calibration Source",
    "Review Status",
    "Reviewer",
    "Reviewed Date",
    "Notes",
  ]];
  styleHeader(sheet.getRange("A4:U4"));
  const importedRows = takeoffMeasurements.slice(0, TAKEOFF_IMPORT_ROW_COUNT).map((measurement) => [
    measurement.id || "",
    measurement.targetWorkbookSheet || "",
    measurement.conditionName || "",
    measurement.measurementType || "",
    measurement.tradeComponent || "",
    measurement.site || "",
    measurement.level || "",
    measurement.wallId || "",
    measurement.zoneId || "",
    measurement.openingId || "",
    asNumber(measurement.value, ""),
    measurement.unit || "",
    measurement.sourcePdf || "",
    asNumber(measurement.pageNumber, ""),
    measurement.sheetNumber || "",
    measurement.drawingRevision || "",
    measurement.calibrationSource || "",
    measurement.reviewStatus || "Needs Review",
    measurement.reviewer || "",
    measurement.reviewedDate || "",
    measurement.notes || "",
  ]);
  const rows = [
    ...importedRows,
    ...Array.from({ length: Math.max(0, TAKEOFF_IMPORT_ROW_COUNT - importedRows.length) }, () => Array(21).fill(null)),
  ];
  const importEndRow = 4 + TAKEOFF_IMPORT_ROW_COUNT;
  sheet.getRange(`A5:U${importEndRow}`).values = rows;
  sheet.getRange(`A5:Q${importEndRow}`).format.fill = colors.assumption;
  sheet.getRange(`R5:U${importEndRow}`).format.fill = colors.input;
  sheet.getRange(`K5:K${importEndRow}`).format.numberFormat = "#,##0.000";
  sheet.getRange(`N5:N${importEndRow}`).format.numberFormat = "#,##0";
  sheet.getRange(`T5:T${importEndRow}`).format.numberFormat = "yyyy-mm-dd";
  sheet.getRange(`A4:U${importEndRow}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`A5:U${importEndRow}`).format.wrapText = true;
  sheet.tables.add(`A4:U${importEndRow}`, true, "PDFTakeoffImport");
  sheet.freezePanes.freezeRows(4);
}

// Wall Measurements
{
  const sheet = sheets["Wall Measurements"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:N1", "Wall Measurements", "Enter outside-to-outside straight wall runs. Formulas on other sheets roll these measurements into framing quantities.");
  const headers = [["Site", "Level", "Wall ID", "Wall Type", "Outside-to-Outside Length", "Unit", "Length LM", "Stud Spacing mm", "Openings in Wall", "Opening Count", "Corners/T-Junctions", "Bracing Panel Length LM", "Notes", "Base Stud Qty"]];
  sheet.getRange("A4:N4").values = headers;
  styleHeader(sheet.getRange("A4:N4"));
  const rows = Array.from({ length: 80 }, (_, i) => {
    const r = i + 5;
    const imported = takeoffWallImports[i];
    if (imported) {
      const wallType = wallTypeFromTradeComponent(imported.tradeComponent);
      const lengthM = linearMetresFromMeasurement(imported);
      const bracingLengthM = wallType === "Bracing" ? lengthM : "";
      return [
        imported.site || "",
        imported.level || "",
        imported.wallId || imported.id || "",
        wallType,
        lengthM,
        "m",
        `=IF(E${r}="","",IF(F${r}="m",E${r},E${r}/1000))`,
        `=IF(D${r}="External",'Inputs & Assumptions'!$B$14,IF(D${r}="Internal",'Inputs & Assumptions'!$B$15,""))`,
        "",
        imported.tradeComponent === "Opening Count" ? asNumber(imported.value, "") : "",
        "",
        bracingLengthM,
        sourceNoteFromTakeoffMeasurement(imported),
        `=IF(OR(G${r}="",H${r}=""),"",ROUNDUP(G${r}*1000/H${r},0)+1)`,
      ];
    }
    return ["", "", "", "", "", "mm", `=IF(E${r}="","",IF(F${r}="m",E${r},E${r}/1000))`, `=IF(D${r}="External",'Inputs & Assumptions'!$B$14,IF(D${r}="Internal",'Inputs & Assumptions'!$B$15,""))`, "", "", "", "", "", `=IF(OR(G${r}="",H${r}=""),"",ROUNDUP(G${r}*1000/H${r},0)+1)`];
  });
  sheet.getRange("A5:N84").values = rows;
  sheet.getRange("A5:F84").format.fill = colors.input;
  sheet.getRange("I5:M84").format.fill = colors.input;
  sheet.getRange("G5:H84").format.fill = colors.calc;
  sheet.getRange("N5:N84").format.fill = colors.calc;
  sheet.getRange("A4:N84").format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange("E5:E84").format.numberFormat = "#,##0.00";
  sheet.getRange("G5:G84").format.numberFormat = "#,##0.00";
  sheet.getRange("H5:H84").format.numberFormat = "#,##0";
  sheet.getRange("N5:N84").format.numberFormat = "#,##0";
  sheet.getRange("J5:L84").format.numberFormat = "#,##0.00";
  sheet.tables.add("A4:N84", true, "WallMeasurements");
  sheet.getRange("O4:R4").values = [["Summary", "Ground", "First", "Total"]];
  styleHeader(sheet.getRange("O4:R4"));
  sheet.getRange("O5:O8").values = [["External Wall LM"], ["Internal Wall LM"], ["Corners/T-Junctions"], ["Bracing Panel LM"]];
  sheet.getRange("P5:R8").formulas = [
    [`=SUMIFS($G$5:$G$84,$B$5:$B$84,"Ground",$D$5:$D$84,"External")`, `=SUMIFS($G$5:$G$84,$B$5:$B$84,"First",$D$5:$D$84,"External")`, `=SUM(P5:Q5)`],
    [`=SUMIFS($G$5:$G$84,$B$5:$B$84,"Ground",$D$5:$D$84,"Internal")`, `=SUMIFS($G$5:$G$84,$B$5:$B$84,"First",$D$5:$D$84,"Internal")`, `=SUM(P6:Q6)`],
    [`=SUMIFS($K$5:$K$84,$B$5:$B$84,"Ground")`, `=SUMIFS($K$5:$K$84,$B$5:$B$84,"First")`, `=SUM(P7:Q7)`],
    [`=SUMIFS($L$5:$L$84,$B$5:$B$84,"Ground")`, `=SUMIFS($L$5:$L$84,$B$5:$B$84,"First")`, `=SUM(P8:Q8)`],
  ];
  sheet.getRange("O4:R8").format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange("P5:R8").format.numberFormat = "#,##0.00";
  sheet.freezePanes.freezeRows(4);
}

const openingMeasurementOverridesPath = path.resolve(cliArgs.get("opening-measurement-overrides") || "inputs/opening_measurement_overrides.csv");
const engineeringOpeningOverridesPath = path.resolve(cliArgs.get("engineering-opening-overrides") || "inputs/engineering_opening_overrides.csv");
const openingMeasurementOverrides = await loadCsvRecords(openingMeasurementOverridesPath);
const engineeringOpeningOverrides = await loadCsvRecords(engineeringOpeningOverridesPath);

function openingMeasurementOverrideIsComplete(row) {
  if (!isReviewedRecord(row)) return false;
  return !isTbaText(row.openingId)
    && !isTbaText(row.wallId)
    && !isTbaText(row.sillHeightMm)
    && !isTbaText(row.headHeightMm)
    && !isTbaText(row.sourceRef);
}

const reviewedOpeningMeasurementOverrides = new Map(openingMeasurementOverrides
  .filter((row) => openingMeasurementOverrideIsComplete(row))
  .map((row) => [cleanText(row.openingId).toUpperCase(), row]));
const unresolvedOpeningMeasurementOverrides = openingMeasurementOverrides
  .filter((row) => cleanText(row.openingId) && !openingMeasurementOverrideIsComplete(row));

function engineeringOpeningOverrideIsComplete(row) {
  if (!isReviewedRecord(row)) return false;
  return !isTbaText(row.memberType)
    && !isTbaText(row.memberSize)
    && !isTbaText(firstPresent(row.bearingMm, row.bearing))
    && !isTbaText(row.connections)
    && !isTbaText(firstPresent(row.sourceDrawingDetail, row.sourceRef, row.sourceDrawing))
    && !isTbaText(row.responseStatus)
    && !/^open$/i.test(cleanText(row.responseStatus));
}

const reviewedEngineeringOpeningOverrides = new Map(engineeringOpeningOverrides
  .filter((row) => cleanText(row.openingId) && engineeringOpeningOverrideIsComplete(row))
  .map((row) => [cleanText(row.openingId).toUpperCase(), row]));
const unresolvedEngineeringOpeningOverrides = engineeringOpeningOverrides
  .filter((row) => cleanText(row.openingId) && !engineeringOpeningOverrideIsComplete(row));

function openingEngineeringResolved(openingId) {
  return reviewedEngineeringOpeningOverrides.has(cleanText(openingId).toUpperCase());
}

function applyOpeningMeasurementOverride(row) {
  const [site, level, id, type, clearSpanMm, wallId, openingHeightMm, sillHeightMm, headHeightMm, source] = row;
  const override = reviewedOpeningMeasurementOverrides.get(cleanText(id).toUpperCase());
  if (!override) return row;
  return [
    site,
    level,
    id,
    type,
    clearSpanMm,
    firstPresent(override.wallId, wallId),
    firstPresent(override.openingHeightMm, openingHeightMm),
    firstPresent(override.sillHeightMm, sillHeightMm),
    firstPresent(override.headHeightMm, headHeightMm),
    firstPresent(override.sourceRef, source),
  ];
}

// Opening Schedule
const openings = [
  ["A", "Ground", "W01A", "Window", 1200, "", "", "", "", "Schedule"],
  ["A", "Ground", "W02A", "Window", 1200, "", "", "", "", "Schedule"],
  ["A", "Ground", "W03A", "Window", 3555, "", "", "", "", "Schedule"],
  ["A", "Ground", "W04A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "Ground", "W05A", "Window", 3800, "", "", "", "", "Schedule"],
  ["A", "Ground", "W06A", "Window", 3800, "", "", "", "", "Schedule"],
  ["A", "Ground", "W07A", "Window", 1800, "", "", "", "", "Schedule"],
  ["A", "Ground", "W08A", "Window", 1600, "", "", "", "", "Schedule"],
  ["A", "Ground", "W09A", "Window", 3200, "", "", "", "", "Schedule"],
  ["A", "Ground", "D01A", "Sliding Door", 5920, "", "", "", "", "Schedule"],
  ["A", "Ground", "D02A", "Sliding Door", 1880, "", "", "", "", "Schedule"],
  ["A", "Ground", "D03A", "Swing Door", 820, "", "", "", "", "Schedule"],
  ["A", "Ground", "D04A", "Panel Lift Door", 5400, "", "", "", "", "Schedule"],
  ["A", "Ground", "D05A", "Swing Door", 1180, "", "", "", "", "Schedule"],
  ["A", "First", "W10A", "Window", 2400, "", "", "", "", "Schedule"],
  ["A", "First", "W11A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "First", "W12A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "First", "W13A", "Window", 1800, "", "", "", "", "Schedule"],
  ["A", "First", "W14A", "Window", 1600, "", "", "", "", "Schedule"],
  ["A", "First", "W15A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "First", "W16A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "First", "W17A", "Window", 1400, "", "", "", "", "Schedule"],
  ["A", "First", "W18A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "First", "W19A", "Window", 900, "", "", "", "", "Schedule"],
  ["A", "First", "D06A", "Sliding Door", 4200, "", "", "", "", "Schedule"],
  ["A", "First", "D07A", "Sliding Door", 4200, "", "", "", "", "Schedule"],
  ["B", "Ground", "W01B", "Window", 3200, "", "", "", "", "Schedule"],
  ["B", "Ground", "W02B", "Window", 1600, "", "", "", "", "Schedule"],
  ["B", "Ground", "W03B", "Window", 1800, "", "", "", "", "Schedule"],
  ["B", "Ground", "W04B", "Window", 1800, "", "", "", "", "Schedule"],
  ["B", "Ground", "W05B", "Window", 2400, "", "", "", "", "Schedule"],
  ["B", "Ground", "W06B", "Window", 900, "", "", "", "", "Schedule"],
  ["B", "Ground", "W07B", "Window", 3555, "", "", "", "", "Schedule"],
  ["B", "Ground", "W08B", "Window", 1200, "", "", "", "", "Schedule"],
  ["B", "Ground", "W09B", "Window", 1200, "", "", "", "", "Schedule"],
  ["B", "Ground", "D01B", "Sliding Door", 5920, "", "", "", "", "Schedule"],
  ["B", "Ground", "D02B", "Panel Lift Door", 5395, "", "", "", "", "Schedule"],
  ["B", "Ground", "D03B", "Swing Door", 1180, "", "", "", "", "Schedule"],
  ["B", "Ground", "D04B", "Swing Door", 820, "", "", "", "", "Schedule"],
  ["B", "Ground", "D05B", "Sliding Door", 1880, "", "", "", "", "Schedule"],
  ["B", "First", "W18B", "Window", 2400, "", "", "", "", "Schedule"],
  ["B", "First", "W10B", "Window", 900, "", "", "", "", "Schedule"],
  ["B", "First", "W11B", "Window", 900, "", "", "", "", "Schedule"],
  ["B", "First", "W13B", "Window", 900, "", "", "", "", "Schedule"],
  ["B", "First", "W16B", "Window", 900, "", "", "", "", "Schedule"],
  ["B", "First", "W17B", "Window", 900, "", "", "", "", "Schedule"],
  ["B", "First", "W12B", "Window", 1400, "", "", "", "", "Schedule"],
  ["B", "First", "W14B", "Window", 1600, "", "", "", "", "Schedule"],
  ["B", "First", "W15B", "Window", 1800, "", "", "", "", "Schedule"],
  ["B", "First", "D06B", "Sliding Door", 4200, "", "", "", "", "Schedule"],
  ["B", "First", "D07B", "Sliding Door", 4200, "", "", "", "", "Schedule"],
].map(applyOpeningMeasurementOverride);

const floorZones = [];
const engineeringDetails = engineeringOpeningOverrides.map((row) => ({
  drawing: firstPresent(row.sourceDrawing, row.sourceDrawingDetail, row.sourceRef),
  revision: row.revision || "",
  noteRef: row.noteRef || row.openingId || "",
  memberTag: row.openingId || "",
  detailId: row.detailId || row.openingId || "",
  comparisonStatus: engineeringOpeningOverrideIsComplete(row) ? "Matches" : "Not Checked",
  rfiFlag: engineeringOpeningOverrideIsComplete(row) ? "" : "Yes",
}));

function finalCutLengthMm(clearSpanMm) {
  return clearSpanMm === "" || clearSpanMm == null ? "" : clearSpanMm + totalBearingAllowanceMm;
}

function isMissing(value) {
  return value === "" || value == null;
}

function lineStatus({ quantity = 0, missingMeasure = false, engineerTba = false, as1684Block = false } = {}) {
  if (missingMeasure || quantity === "" || quantity == null || Number(quantity) === 0) return "Pending Measure";
  if (engineerTba) return "Engineer TBA";
  if (as1684Block) return "Check AS 1684";
  return "Ready";
}

function rounded(value, precision = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(precision));
}

function openingTrimmerQtyForLevel(level) {
  return openings.filter(([, openingLevel, , , clearSpanMm]) => (
    openingLevel === level
    && clearSpanMm !== ""
    && clearSpanMm != null
  )).length * 2;
}

function summarizeWallTakeoff() {
  const summary = {
    externalLm: 0,
    internalLm: 0,
    bracingLm: 0,
    groundStudQty: 0,
    firstStudQty: 0,
  };

  for (const measurement of takeoffWallImports) {
    const wallType = wallTypeFromTradeComponent(measurement.tradeComponent);
    const lengthM = asNumber(linearMetresFromMeasurement(measurement), 0);
    if (!lengthM) continue;

    if (wallType === "External") summary.externalLm += lengthM;
    if (wallType === "Internal") summary.internalLm += lengthM;
    if (wallType === "Bracing") {
      summary.bracingLm += lengthM;
      continue;
    }

    const spacingMm = wallType === "External" ? project.externalStudSpacingMm : project.internalStudSpacingMm;
    const studQty = Math.ceil((lengthM * 1000) / spacingMm) + 1;
    if (measurement.level === "Ground") summary.groundStudQty += studQty;
    if (measurement.level === "First") summary.firstStudQty += studQty;
  }

  summary.totalLm = summary.externalLm + summary.internalLm;
  summary.groundStudQty += openingTrimmerQtyForLevel("Ground");
  summary.firstStudQty += openingTrimmerQtyForLevel("First");
  return summary;
}

function summarizeFloorTakeoff() {
  const summary = {
    hasRows: takeoffFloorAreaImports.length > 0,
    areaM2: 0,
    joistLm: 0,
    blockingLm: 0,
    deckingSheets: 0,
    completeSpanRows: 0,
  };

  for (const measurement of takeoffFloorAreaImports) {
    const areaM2 = asNumber(squareMetresFromMeasurement(measurement), 0);
    summary.areaM2 += areaM2;
    const lengthMm = asNumber(measurement.lengthMm, areaM2 ? areaM2 * 1000 : "");
    const widthMm = asNumber(measurement.widthMm, areaM2 ? 1000 : "");
    const spanMm = asNumber(measurement.joistSpanMm, "");
    const spacingMm = asNumber(measurement.joistSpacingMm, 450);
    const spanDirection = measurement.joistSpanDirection || "";
    if (
      lengthMm === ""
      || widthMm === ""
      || spanMm === ""
      || spacingMm === ""
      || spanDirection === ""
      || isTbaText(measurement.supportType)
      || isTbaText(measurement.joistMember)
    ) continue;

    const runMm = spanDirection === "Length" ? widthMm : lengthMm;
    const joistQty = Math.ceil(runMm / spacingMm) + 1;
    summary.joistLm += joistQty * spanMm / 1000;
    const blockingRows = spanMm < 3000 ? 0 : (spanMm <= 4200 ? 1 : (spanMm <= 6000 ? 2 : 0));
    summary.blockingLm += blockingRows * runMm / 1000;
    summary.completeSpanRows += 1;
  }

  summary.deckingSheets = summary.areaM2
    ? Math.ceil(summary.areaM2 / project.alphafloorSheetAreaM2 * (1 + project.deckingWastePct / 100))
    : 0;
  summary.hasCompleteSpans = summary.hasRows && summary.completeSpanRows === takeoffFloorAreaImports.length;
  return summary;
}

function generateEngineerRfiRows(openingRows, floorZoneRows, engineeringRows) {
  const rows = [];
  for (const [site, level, id, type, clearSpanMm] of openingRows) {
    if (clearSpanMm === "" || clearSpanMm == null) {
      rows.push(["Missing dimension", id, "", "", "Clear span not supplied", "", "Open"]);
      continue;
    }
    if (openingEngineeringResolved(id)) continue;
    const cutMm = finalCutLengthMm(clearSpanMm);
    const reasons = [];
    if (cutMm > project.stockLengthMm) reasons.push("cut length over stock");
    if (clearSpanMm >= 3200) reasons.push("clear span >= 3200mm");
    if (/garage/i.test(type)) reasons.push("garage door opening");
    if (/sliding/i.test(type) && clearSpanMm >= 3200) reasons.push("large sliding door");
    if (reasons.length) {
      rows.push([
        reasons.includes("cut length over stock") ? "Over stock length" : "Large opening",
        id,
        clearSpanMm,
        cutMm,
        `${reasons.join("; ")}; confirm member size, material, bearing and connections`,
        "",
        "Open",
      ]);
    }
  }

  for (const zone of floorZoneRows) {
    if (zone.joistSpanMm > 6000) {
      rows.push(["Floor span", zone.zoneId || "Floor zone", zone.joistSpanMm, "", "Joist span over 6000mm; engineer confirmation required", "", "Open"]);
    }
  }

  for (const detail of engineeringRows) {
    if (detail.rfiFlag || detail.comparisonStatus === "Conflict") {
      rows.push([
        "Engineering conflict",
        detail.memberTag || detail.detailId || "Engineering detail",
        "",
        "",
        `${detail.drawing || ""} ${detail.revision || ""} ${detail.noteRef || ""}: workbook assumption conflicts with engineering detail`,
        "",
        "Open",
      ]);
    }
  }

  return rows.length ? rows : [["No open generated RFI", "", "", "", "No generated RFI items from current data", "", "Closed"]];
}

function as1684CheckRows() {
  const baseRows = [
    ["AS 1684 part", "Inputs & Assumptions!B26", "Select applicable residential timber-framing part", "AS 1684 part", `=IF('Inputs & Assumptions'!B26="","Missing Input","OK")`, "Confirm selected standard part", "Do not copy AS 1684 tables into this workbook"],
    ["Wind classification", "Inputs & Assumptions!B27", "Required before span/bracing/tie-down checks", "Wind class", `=IF(OR('Inputs & Assumptions'!B27="",'Inputs & Assumptions'!B27="TBA"),"Missing Input","OK")`, "Confirm from engineer/certifier/plans", ""],
    ["Building class", "Inputs & Assumptions!B29", "Class 1/10 applicability", "NCC building class", `=IF(ISNUMBER(SEARCH("TBA",'Inputs & Assumptions'!B29)),"Missing Input","OK")`, "Confirm building class", ""],
    ["Stud spacing", "Wall Measurements!H5:H84", "Stud spacing and wall-height suitability", "Wall measurements", `=IF('Wall Measurements'!R5+'Wall Measurements'!R6=0,"Missing Input","OK")`, "Enter outside-to-outside wall runs", ""],
    ["Stud height", "Inputs & Assumptions!B19", "Wall framing height suitability", "Stud height", `=IF('Inputs & Assumptions'!B19<=0,"Missing Input",IF('Inputs & Assumptions'!B19>3000,"Check AS 1684","OK"))`, "Confirm tall walls against AS 1684/engineer", ""],
    ["Lintels", "Opening Schedule", "Span-table/engineered-member review", "Clear spans and loading", `=IF(COUNTIF('Opening Schedule'!O5:O55,"*Engineer*")+COUNTIF('Opening Schedule'!O5:O55,"*TBA*")>0,"Engineer TBA","Check AS 1684")`, "Check AS 1684 tables or engineer schedule", ""],
    ["Floor joists", "Floor Framing", "Joist span-table review", "Joist zones", `=IF('Floor Framing'!N7=0,"Missing Input",IF(COUNTIF('Floor Framing'!L5:L34,"TBA")>0,"Engineer TBA","Check AS 1684"))`, "Enter joist spans and confirm member schedule", ""],
    ["Blocking", "Floor Framing", "Blocking by joist span", "Joist spans", `=IF('Floor Framing'!N8=0,"OK","OK")`, "Review blocking rows generated from span bands", ""],
    ["Bracing", "Wall Measurements!R8 / Inputs & Assumptions!B30", "Bracing capacity/layout", "Bracing panel data", `=IF(OR('Wall Measurements'!R8=0,ISNUMBER(SEARCH("TBA",'Inputs & Assumptions'!B30))),"Missing Input","Check AS 1684")`, "Enter bracing panel lengths or engineer bracing schedule", ""],
    ["Tie-downs and fixings", "Engineering Details Check", "Wind/uplift/fixing schedule", "Engineer notes", "Engineer TBA", "Confirm M12 bolts, washers, straps, hold-downs and proprietary connectors", ""],
  ];
  return baseRows.map((row, index) => {
    const r = index + 5;
    return [
      ...row,
      "",
      "",
      "",
      "",
      `=IF(E${r}="Not Applicable","Complete",IF(E${r}<>"OK",E${r},IF(AND(H${r}<>"",I${r}<>"",J${r}<>""),"Complete","Audit Incomplete")))`,
    ];
  });
}

{
  const sheet = sheets["Opening Schedule"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:U1", "Opening Schedule", "Clear spans are converted to LVL cut lengths; wall/height inputs drive trimmers and cripple-stud quantities.");
  sheet.getRange("A4:U4").values = [["Site", "Level", "Opening ID", "Wall ID", "Type", "Clear Span mm", "Opening Height mm", "Sill Height mm", "Head Height mm", "Opening Count Source", "Total Bearing Allowance mm", "Final Cut Length mm", "Material", "Stock Fit", "TBA / Engineer Status", "Top Cripple Qty", "Top Cripple Length mm", "Bottom Cripple Qty", "Bottom Cripple Length mm", "Cripple Status", "Notes"]];
  styleHeader(sheet.getRange("A4:U4"));
  const rows = openings.map((row, i) => {
    const r = i + 5;
    const [site, level, id, type, clearSpanMm, wallId, openingHeightMm, sillHeightMm, headHeightMm, source] = row;
    const spacingLookup = `INDEX('Wall Measurements'!$H$5:$H$84,MATCH(D${r},'Wall Measurements'!$C$5:$C$84,0))`;
    return [
      site,
      level,
      id,
      wallId,
      type,
      clearSpanMm,
      openingHeightMm,
      sillHeightMm,
      headHeightMm,
      source,
      `='Inputs & Assumptions'!$B$12`,
      `=IF(F${r}="","",F${r}+K${r})`,
      `='Inputs & Assumptions'!$B$25`,
      `=IF(L${r}="","Missing span",IF(L${r}<='Inputs & Assumptions'!$B$9,"Fits 6.0m","Over 6.0m"))`,
      `=IF(F${r}="","Missing clear span",IF(L${r}>'Inputs & Assumptions'!$B$9,"Special Order / TBA",IF(F${r}>=3200,"Engineer confirm","")))`,
      `=IF(OR(D${r}="",F${r}="",I${r}=""),"",IFERROR(MAX(0,ROUNDUP(F${r}/${spacingLookup},0)-1),""))`,
      `=IF(P${r}="","",MAX(0,'Inputs & Assumptions'!$B$19-I${r}))`,
      `=IF(OR(D${r}="",F${r}="",H${r}=""),"",IF(H${r}<=0,0,IFERROR(MAX(0,ROUNDUP(F${r}/${spacingLookup},0)-1),"")))`,
      `=IF(R${r}="","",IF(R${r}=0,0,H${r}))`,
      `=IF(OR(D${r}="",F${r}="",H${r}="",I${r}=""),"Pending Measure",IF(OR(P${r}="",Q${r}="",R${r}="",S${r}=""),"Pending Measure","OK"))`,
      `=IF(O${r}<>"","Confirm before ordering",IF(T${r}<>"OK","Enter wall/head/sill data for cripple studs",""))`,
    ];
  });
  sheet.getRange(`A5:U${4 + rows.length}`).values = rows;
  sheet.getRange(`A5:J${4 + rows.length}`).format.fill = colors.input;
  sheet.getRange(`K5:U${4 + rows.length}`).format.fill = colors.calc;
  sheet.getRange(`A4:U${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`F5:I${4 + rows.length}`).format.numberFormat = "#,##0";
  sheet.getRange(`K5:S${4 + rows.length}`).format.numberFormat = "#,##0";
  sheet.getRange(`A5:U${4 + rows.length}`).format.wrapText = true;
  sheet.tables.add(`A4:U${4 + rows.length}`, true, "OpeningSchedule");
  sheet.freezePanes.freezeRows(4);
}

// Opening Schedule Check
{
  const sheet = sheets["Opening Schedule Check"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:O1", "Opening Schedule Check", "Review-only comparison of architectural PDF schedule IDs against the workbook Opening Schedule.");
  sheet.getRange("A4:O4").values = [[
    "Source PDF",
    "Page",
    "Site",
    "Opening ID",
    "Workbook Level",
    "Workbook Clear Span mm",
    "PDF Occurrences",
    "Status",
    "Review Status",
    "Action",
    "Notes",
    "Source Ref",
    "PDF Clear Span mm",
    "Reviewed By",
    "Reviewed Date",
  ]];
  styleHeader(sheet.getRange("A4:O4"));
  const importedRows = openingScheduleCrosscheckRows.slice(0, 150).map((row) => [
    row.sourcePdf || "",
    asNumber(row.page, ""),
    row.site || "",
    row.openingId || "",
    row.workbookLevel || "",
    asNumber(row.workbookClearSpanMm, ""),
    asNumber(row.pdfOccurrences, ""),
    row.status || "",
    row.reviewStatus || "",
    row.action || "",
    row.notes || "",
    row.sourceRef || "",
    asNumber(row.pdfClearSpanMm, ""),
    row.reviewedBy || "",
    row.reviewedDate || "",
  ]);
  const rows = [
    ...importedRows,
    ...Array.from({ length: Math.max(0, 150 - importedRows.length) }, () => Array(15).fill(null)),
  ];
  sheet.getRange("A5:O154").values = rows;
  sheet.getRange("A5:H154").format.fill = colors.assumption;
  sheet.getRange("I5:O154").format.fill = colors.input;
  sheet.getRange("B5:B154").format.numberFormat = "#,##0";
  sheet.getRange("F5:G154").format.numberFormat = "#,##0";
  sheet.getRange("M5:M154").format.numberFormat = "#,##0";
  sheet.getRange("A4:O154").format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange("A5:O154").format.wrapText = true;
  sheet.tables.add("A4:O154", true, "OpeningScheduleCheck");
  sheet.freezePanes.freezeRows(4);
}

const { packedRows: lvlRows, specialCuts } = packCuts(openings, project.stockLengthMm, totalBearingAllowanceMm, project.sawKerfMm);

if (project.workbookMode === "full") {
  const sheet = sheets["LVL Cutting Optimizer"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:H1", "LVL Cutting Optimizer", "Current pre-nested 6.0m LVL stock plan. Update opening spans and re-nest if new cut sizes are added.");
  sheet.getRange("A4:F4").values = [["6.0m Stock No.", "Cuts From Length", "Used mm", "Waste mm", "Fit Check", "Notes"]];
  styleHeader(sheet.getRange("A4:F4"));
  const rows = lvlRows;
  const lvlStartRow = 5;
  const lvlEndRow = lvlStartRow + rows.length - 1;
  sheet.getRange(`A5:F${4 + rows.length}`).values = rows;
  sheet.getRange(`A4:F${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`C5:D${4 + rows.length}`).format.numberFormat = "#,##0";
  sheet.tables.add(`A4:F${4 + rows.length}`, true, "LVLOptimizer");
  const s = 28;
  sheet.getRange(`A${s}:D${s}`).values = [["Summary", "Formula", "Result", "Unit"]];
  styleHeader(sheet.getRange(`A${s}:D${s}`));
  sheet.getRange(`A${s + 1}:D${s + 6}`).values = [
    ["Standard 6.0m LVL Stock", "", "", "lengths"],
    ["Stock Ordered LM", "", "", "LM"],
    ["Used Cut LM", "", "", "LM"],
    ["Waste LM", "", "", "LM"],
    ["Special Order >6.0m", "", "", "members"],
    ["Missing Span Rows", "", "", "rows"],
  ];
  sheet.getRange(`B${s + 1}:B${s + 6}`).values = [
    [`=COUNTA(A${lvlStartRow}:A${lvlEndRow})`],
    [`=COUNTA(A${lvlStartRow}:A${lvlEndRow})*'Inputs & Assumptions'!$B$9/1000`],
    [`=SUM(C${lvlStartRow}:C${lvlEndRow})/1000`],
    [`=SUM(D${lvlStartRow}:D${lvlEndRow})/1000`],
    ["=COUNTIF('Opening Schedule'!N5:N55,\"Over 6.0m\")"],
    ["=COUNTIF('Opening Schedule'!N5:N55,\"Missing span\")"],
  ];
  sheet.getRange(`C${s + 1}:C${s + 6}`).formulas = [
    ["=B29"],
    ["=B30"],
    ["=B31"],
    ["=B32"],
    ["=B33"],
    ["=B34"],
  ];
  sheet.getRange(`A${s}:D${s + 6}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`B${s + 2}:C${s + 4}`).format.numberFormat = "#,##0.00";
  sheet.getRange("H4:L4").values = [["Special Order / TBA", "Opening ID", "Clear Span mm", "Cut Length mm", "Status"]];
  styleHeader(sheet.getRange("H4:L4"));
  const special = specialCuts.map((cut) => [cut.status, cut.id, cut.clearSpanMm, cut.lengthMm, cut.note]);
  const specialEndRow = 4 + Math.max(special.length, 1);
  sheet.getRange(`H5:L${specialEndRow}`).values = special.length ? special : [["", "", "", "", ""]];
  sheet.getRange(`H5:L${specialEndRow}`).format.fill = colors.amber;
  sheet.getRange(`H4:L${specialEndRow}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.freezePanes.freezeRows(4);
}

// Bulk Framing Takeoff
if (project.workbookMode === "full") {
  const sheet = sheets["Bulk Framing Takeoff"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:I1", "Bulk Framing Takeoff", "Formula summary from wall, opening, floor, decking and bracing inputs.");
  sheet.getRange("A4:I4").values = [["Framing Component", "Timber Grade/Size", "Calculation Method Used", "Qty", "Unit", "Stock Length", "Waste / Allowance", "Notes", "Source Ref"]];
  styleHeader(sheet.getRange("A4:I4"));
  const rows = [
    ["External Bottom Plates", "Treated F7 / H3", "External wall LM x 1.10", `='Wall Measurements'!R5*(1+'Inputs & Assumptions'!$B$13/100)`, "LM", activeStockProfile.plateStockMm.join(", "), "10%", "Use treated timber for external bottom plates", "Wall Measurements external LM"],
    ["Internal Bottom Plates", "F7 Softwood", "Internal wall LM x 1.10", `='Wall Measurements'!R6*(1+'Inputs & Assumptions'!$B$13/100)`, "LM", activeStockProfile.plateStockMm.join(", "), "10%", "", "Wall Measurements internal LM"],
    ["Top Plates (Double)", "F7 Softwood", "Total wall LM x 2 x 1.10", `=SUM('Wall Measurements'!R5:R6)*2*(1+'Inputs & Assumptions'!$B$13/100)`, "LM", activeStockProfile.plateStockMm.join(", "), "10%", "", "Wall Measurements total LM"],
    ["Ground Floor Base Wall Studs", "F7 Softwood", "Measured GF wall runs / stud spacing + 1", `=SUMIFS('Wall Measurements'!$N$5:$N$84,'Wall Measurements'!$B$5:$B$84,"Ground")`, "Qty", activeStockProfile.studPrecutMm.join(", "), "", "Requires wall LM entries", "Ground wall IDs"],
    ["Ground Floor Junction/Trimmer Studs", "F7 Softwood", "2x GF junctions + 2 trimmers per GF opening", `='Wall Measurements'!P7*2+COUNTIFS('Opening Schedule'!$B$5:$B$55,"Ground",'Opening Schedule'!$F$5:$F$55,">0")*2`, "Qty", activeStockProfile.studPrecutMm.join(", "), "", "Counts ground-floor openings with confirmed clear spans", "GF junctions + Opening Schedule"],
    ["Ground Floor Studs Total", "F7 Softwood", "Base wall studs + junction/trimmer allowance", `=D8+D9`, "Qty", `${groundFloorStudLengthMm}mm precut`, "", `Default GF stud length ${groundFloorStudLengthMm}mm`, "Bulk rows 8-9"],
    ["First Floor Base Wall Studs", "F7 Softwood", "Measured FF wall runs / stud spacing + 1", `=SUMIFS('Wall Measurements'!$N$5:$N$84,'Wall Measurements'!$B$5:$B$84,"First")`, "Qty", activeStockProfile.studPrecutMm.join(", "), "", "Requires wall LM entries", "First floor wall IDs"],
    ["First Floor Junction/Trimmer Studs", "F7 Softwood", "2x FF junctions + 2 trimmers per FF opening", `='Wall Measurements'!Q7*2+COUNTIFS('Opening Schedule'!$B$5:$B$55,"First",'Opening Schedule'!$F$5:$F$55,">0")*2`, "Qty", activeStockProfile.studPrecutMm.join(", "), "", "", "FF junctions + Opening Schedule"],
    ["First Floor Studs Total", "F7 Softwood", "Base wall studs + junction/trimmer allowance", `=D11+D12`, "Qty", "TBA", "", "Stud height to be confirmed for FF if different", "Bulk rows 11-12"],
    ["Noggins", "F7 Softwood", "Total wall LM x noggin rows", `=SUM('Wall Measurements'!R5:R6)*'Inputs & Assumptions'!$B$20`, "LM", activeStockProfile.nogginStockMm.join(", "), "", "Default 2 rows", "Wall Measurements total LM"],
    ["LVL Lintels from 6.0m Stock", "LVL", "Optimizer stock count", `='LVL Cutting Optimizer'!C29`, "Lengths", `${project.stockLengthMm}mm`, `='LVL Cutting Optimizer'!C32`, "Excludes special-order >6.0m and missing-span rows", "Opening Schedule / LVL Optimizer"],
    ["Special Order / TBA Lintels", "LVL / Steel TBA", "Openings over 6000mm or missing clear span", `=COUNTIF('Opening Schedule'!N5:N55,"Over 6.0m")+COUNTIF('Opening Schedule'!N5:N55,"Missing span")`, "Qty", "TBA", "", "Engineer confirmation required", "Opening Schedule TBA rows"],
    ["Floor Joists", "LVL or I-Joist", "Floor Framing sheet calculated joist LM", `='Floor Framing'!N7`, "LM", "TBA", "", "Update floor zones", "Floor Framing zone IDs"],
    ["Floor Blocking", "Match Joist", "Rows from span bands x zone width", `='Floor Framing'!N8`, "LM", "TBA", "", "", "Floor Framing blocking rows"],
    ["Alphafloor Decking", "Alphafloor", "Floor area / sheet area x waste", `='Floor Framing'!N9`, "Sheets", "", "10%", "Update sheet coverage if required", "Floor Framing area"],
    ["Structural Ply Bracing", "Structural Ply", "Bracing panel LM / sheet width x waste", `=IF('Wall Measurements'!R8=0,0,ROUNDUP('Wall Measurements'!R8/1.2*(1+'Inputs & Assumptions'!$B$22/100),0))`, "Sheets", "", "10%", "Approx from bracing panel LM", "Wall Measurements bracing LM"],
    ["Cripple Studs", "F7 Softwood", "Opening Schedule top + bottom cripple quantities", `=SUM('Opening Schedule'!P5:P55,'Opening Schedule'!R5:R55)`, "Qty", activeStockProfile.studPrecutMm.join(", "), "", "Requires Wall ID, head height and sill height for each opening", "Opening Schedule cripple columns"],
  ];
  sheet.getRange(`A5:I${4 + rows.length}`).values = rows;
  sheet.getRange(`A4:I${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`D5:D${4 + rows.length}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`A5:I${4 + rows.length}`).format.wrapText = true;
  sheet.tables.add(`A4:I${4 + rows.length}`, true, "BulkTakeoff");
  sheet.freezePanes.freezeRows(4);
}

// Floor Framing
{
  const sheet = sheets["Floor Framing"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:M1", "Floor Framing", "Enter one row per rectangular joist zone. Blocking follows engineer note T9 span bands.");
  sheet.getRange("A4:L4").values = [["Site", "Floor Zone ID", "Length mm", "Width mm", "Joist Span Direction", "Joist Span mm", "Joist Spacing mm", "Support Type", "Joist Qty", "Joist LM", "Blocking LM", "Blocking Status"]];
  styleHeader(sheet.getRange("A4:L4"));
  const rows = Array.from({ length: 30 }, (_, i) => {
    const r = i + 5;
    const imported = takeoffFloorAreaImports[i];
    if (imported) {
      const areaM2 = squareMetresFromMeasurement(imported);
      const lengthMm = asNumber(imported.lengthMm, "");
      const widthMm = asNumber(imported.widthMm, "");
      const syntheticLengthMm = lengthMm !== "" ? lengthMm : (areaM2 === "" ? "" : areaM2 * 1000);
      const syntheticWidthMm = widthMm !== "" ? widthMm : (areaM2 === "" ? "" : 1000);
      const joistSpacingMm = asNumber(imported.joistSpacingMm, 450);
      const supportNotes = [
        imported.supportType || "",
        imported.joistMember || "",
        `Imported from takeoff staging; confirm joist span/direction/member. ${sourceNoteFromTakeoffMeasurement(imported)}`,
      ].filter(Boolean).join(" | ");
      return [
        imported.site || "",
        imported.zoneId || imported.id || "",
        syntheticLengthMm,
        syntheticWidthMm,
        imported.joistSpanDirection || "",
        asNumber(imported.joistSpanMm, ""),
        joistSpacingMm,
        supportNotes,
        `=IF(OR(C${r}="",D${r}="",F${r}="",G${r}=""),"",ROUNDUP(IF(E${r}="Length",D${r},C${r})/G${r},0)+1)`,
        `=IF(I${r}="","",I${r}*F${r}/1000)`,
        `=IF(OR(F${r}="",I${r}=""),"",IF(F${r}<3000,0,IF(F${r}<=4200,1,IF(F${r}<=6000,2,0)))*IF(E${r}="Length",D${r},C${r})/1000)`,
        `=IF(F${r}="","",IF(F${r}>6000,"TBA",IF(F${r}>=3000,"Blocking required","OK")))`,
      ];
    }
    return ["", "", "", "", "", "", 450, "", `=IF(OR(C${r}="",D${r}="",F${r}="",G${r}=""),"",ROUNDUP(IF(E${r}="Length",D${r},C${r})/G${r},0)+1)`, `=IF(I${r}="","",I${r}*F${r}/1000)`, `=IF(OR(F${r}="",I${r}=""),"",IF(F${r}<3000,0,IF(F${r}<=4200,1,IF(F${r}<=6000,2,0)))*IF(E${r}="Length",D${r},C${r})/1000)`, `=IF(F${r}="","",IF(F${r}>6000,"TBA",IF(F${r}>=3000,"Blocking required","OK")))`];
  });
  sheet.getRange("A5:L34").values = rows;
  sheet.getRange("A5:H34").format.fill = colors.input;
  sheet.getRange("I5:L34").format.fill = colors.calc;
  sheet.getRange("C5:G34").format.numberFormat = "#,##0";
  sheet.getRange("J5:K34").format.numberFormat = "#,##0.00";
  sheet.getRange("A4:L34").format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.tables.add("A4:L34", true, "FloorFramingZones");
  sheet.getRange("M4:O4").values = [["Floor Summary", "Result", "Unit"]];
  styleHeader(sheet.getRange("M4:O4"));
  sheet.getRange("M5:O9").values = [
    ["Upper Floor Area", "", "m2"],
    ["Joist Qty", "", "Qty"],
    ["Joist LM", "", "LM"],
    ["Blocking LM", "", "LM"],
    ["Alphafloor Sheets", "", "Sheets"],
  ];
  sheet.getRange("N5:N9").formulas = [
    ["=SUMPRODUCT(C5:C34,D5:D34)/1000000"],
    ["=SUM(I5:I34)"],
    ["=SUM(J5:J34)"],
    ["=SUM(K5:K34)"],
    ["=ROUNDUP(N5/'Inputs & Assumptions'!$B$23*(1+'Inputs & Assumptions'!$B$21/100),0)"],
  ];
  sheet.getRange("M4:O9").format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange("N5:N9").format.numberFormat = "#,##0.00";
  sheet.freezePanes.freezeRows(4);
}

// Engineering Details Check
{
  const sheet = sheets["Engineering Details Check"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:P1", "Engineering Details Check", "Enter project-specific engineering notes/details. Engineering details override workbook defaults; conflicts should be sent to RFI.");
  sheet.getRange("A4:P4").values = [["Drawing No.", "Revision", "Detail ID", "Note Ref", "Member Tag", "Specified Size/Grade", "Fixing/Tie-Down Note", "Workbook Assumption", "Workbook Assumption Ref", "Engineer Member Ref", "Affected Order Component", "Comparison Status", "Overrides Workbook?", "RFI Flag", "Order Impact", "Notes"]];
  styleHeader(sheet.getRange("A4:P4"));
  const rows = Array.from({ length: 40 }, (_, i) => {
    const r = i + 5;
    return ["", "", "", "", "", "", "", "", "", "", "", "", "", `=IF(OR(L${r}="Conflict",M${r}="Yes"),"Yes","")`, "", ""];
  });
  sheet.getRange("A5:P44").values = rows;
  sheet.getRange("A5:M44").format.fill = colors.input;
  sheet.getRange("O5:P44").format.fill = colors.input;
  sheet.getRange("N5:N44").format.fill = colors.calc;
  sheet.getRange("A4:P44").format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.tables.add("A4:P44", true, "EngineeringDetailsCheck");
  sheet.freezePanes.freezeRows(4);
}

// AS 1684 Check Register
{
  const sheet = sheets["AS 1684 Check Register"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:L1", "AS 1684 Check Register", "Flag-and-reference checks for AS 1684/NCC review. This workbook is not a compliance certificate.");
  sheet.getRange("A4:L4").values = [["Check Area", "Workbook Source", "AS 1684 Reference Point", "Required Project Input", "Status", "Action", "Notes", "Checked By", "Checked Date", "Reference Clause/Table", "Override Source", "Completion Status"]];
  styleHeader(sheet.getRange("A4:L4"));
  const rows = as1684CheckRows();
  sheet.getRange(`A5:L${4 + rows.length}`).values = rows;
  sheet.getRange(`A4:L${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`A5:L${4 + rows.length}`).format.wrapText = true;
  sheet.getRange(`H5:K${4 + rows.length}`).format.fill = colors.input;
  sheet.getRange(`L5:L${4 + rows.length}`).format.fill = colors.calc;
  sheet.getRange(`I5:I${4 + rows.length}`).format.numberFormat = "yyyy-mm-dd";
  sheet.tables.add(`A4:L${4 + rows.length}`, true, "AS1684CheckRegister");
  sheet.freezePanes.freezeRows(4);
}

// Source Manifest
{
  const sheet = sheets["Source Manifest"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:I1", "Source Manifest", "Traceability and freshness checks for PDF schedule and DWG takeoff source pipelines.");
  sheet.getRange("A4:I4").values = [["Source", "Path", "Relative Path", "Size", "Modified UTC", "Manifest SHA256", "Current SHA256", "Status", "Notes"]];
  styleHeader(sheet.getRange("A4:I4"));
  const sourceChecks = [
    ["Opening schedule cross-check", openingScheduleManifestPath, sourcePipelineCheck],
    ["DWG takeoff import", dwgTakeoffManifestPath, dwgSourceCheck],
  ];
  const manifestRows = sourceChecks.flatMap(([label, manifestPath, check]) => {
    if (check.fileChecks.length) {
      return check.fileChecks.map((fileCheck) => [
        `${label}: ${fileCheck.label}`,
        fileCheck.path,
        fileCheck.relativePath,
        fileCheck.size,
        fileCheck.modifiedUtc ? `UTC ${fileCheck.modifiedUtc}` : "",
        fileCheck.manifestSha256 ? String(fileCheck.manifestSha256).slice(0, 12) : "",
        fileCheck.currentSha256 ? String(fileCheck.currentSha256).slice(0, 12) : "",
        fileCheck.status,
        fileCheck.notes,
      ]);
    }
    return [[
      label,
      manifestPath,
      "",
      "",
      "",
      "",
      "",
      check.status,
      check.notes,
    ]];
  });
  const manifestRowCount = 28;
  const paddedManifestRows = [
    ...manifestRows,
    ...Array.from({ length: Math.max(0, manifestRowCount - manifestRows.length) }, () => Array(9).fill(null)),
  ];
  const manifestEndRow = 4 + manifestRowCount;
  sheet.getRange(`A5:I${manifestEndRow}`).values = paddedManifestRows.slice(0, manifestRowCount);
  sheet.getRange(`A4:I${manifestEndRow}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`D5:D${manifestEndRow}`).format.numberFormat = "#,##0";
  sheet.getRange(`A5:I${manifestEndRow}`).format.wrapText = true;

  const manifest = sourcePipelineCheck.manifest || {};
  const dwgManifest = dwgSourceCheck.manifest || {};
  const metaRows = [
    ["Opening Manifest Path", openingScheduleManifestPath],
    ["Opening Generated UTC", manifest.generatedAtUtc ? `UTC ${manifest.generatedAtUtc}` : ""],
    ["Site A Schedule Page", manifest.siteAPage || ""],
    ["Site B Schedule Page", manifest.siteBPage || ""],
    ["Opening Pipeline", manifest.tools?.pipeline || ""],
    ["Opening Extractor", manifest.tools?.extractor || ""],
    ["Cross-check", manifest.tools?.crosscheck || ""],
    ["Workbook Builder", manifest.tools?.workbookBuilder || ""],
    ["Page Discovery Warning", manifest.pageDiscovery?.warning || ""],
    ["DWG Manifest Path", dwgTakeoffManifestPath],
    ["DWG Generated UTC", dwgManifest.generatedAtUtc ? `UTC ${dwgManifest.generatedAtUtc}` : ""],
    ["DWG Pipeline", dwgManifest.tools?.pipeline || ""],
    ["DWG Converter", dwgManifest.tools?.converter || ""],
    ["DWG Extractor", dwgManifest.tools?.extractor || ""],
    ["DWG Unit Warning", dwgManifest.unitWarning || ""],
  ];
  const metaStartRow = manifestEndRow + 3;
  const metaEndRow = metaStartRow + metaRows.length - 1;
  sheet.getRange(`A${metaStartRow}:B${metaEndRow}`).values = metaRows;
  sheet.getRange(`A${metaStartRow}:B${metaStartRow}`).format.fill = colors.assumption;
  sheet.getRange(`A${metaStartRow}:B${metaEndRow}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`A${metaStartRow}:A${metaEndRow}`).format.font = { bold: true };
  sheet.getRange(`A${metaStartRow}:B${metaEndRow}`).format.wrapText = true;
  for (const statusText of ["Hash mismatch", "Missing", "Manifest Missing", "Stale"]) {
    sheet.getRange(`H5:H${manifestEndRow}`).conditionalFormats.add("containsText", {
      text: statusText,
      format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
    });
  }
  sheet.getRange(`H5:H${manifestEndRow}`).conditionalFormats.add("containsText", {
    text: "Current",
    format: { fill: colors.paleGreen, font: { bold: true } },
  });
  sheet.freezePanes.freezeRows(4);
}

// Order Summary
if (project.workbookMode === "full") {
  const sheet = sheets["Order Summary"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:J1", "Order Summary", "Purchase-ready summary. TBA items should be confirmed before sending purchase orders.");
  sheet.getRange("A4:J4").values = [["Component", "Grade/Size", "Order Qty", "Unit", "Stock Length", "Cut/Calc LM", "Waste LM", "Status", "Notes", "Source Ref"]];
  styleHeader(sheet.getRange("A4:J4"));
  const asOpen = `COUNTIFS('AS 1684 Check Register'!$L$5:$L$50,"<>Complete",'AS 1684 Check Register'!$L$5:$L$50,"<>")`;
  const engineeringOpen = `COUNTIF('Engineering Details Check'!$N$5:$N$44,"Yes")`;
  const pdfImportOpen = `MAX(0,COUNTA('PDF Takeoff Import'!$A$5:$A$154)-COUNTIF('PDF Takeoff Import'!$R$5:$R$154,"Reviewed"))`;
  const openingScheduleOpen = `MAX(0,COUNTA('Opening Schedule Check'!$D$5:$D$154)-COUNTIF('Opening Schedule Check'!$I$5:$I$154,"Reviewed"))`;
  const sourcePipelineOpen = `'QA Checks'!$B$19`;
  const reviewOpen = `${pdfImportOpen}+${openingScheduleOpen}+${sourcePipelineOpen}`;
  const readyGate = (readyTest) => `=IF(${readyTest},"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF(${engineeringOpen}>0,"Engineer TBA",IF(${asOpen}>0,"Check AS 1684","Ready"))))`;
  const rows = [
    ["Project Revision Control", "Admin", "", "", "", "", "", `=IF(OR('Inputs & Assumptions'!G5="TBA",'Inputs & Assumptions'!G6="TBA",'Inputs & Assumptions'!G8="TBA",'Inputs & Assumptions'!G9="TBA",'Inputs & Assumptions'!G13="TBA"),"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF('Inputs & Assumptions'!H14="Ready For Order","Ready","Open Items")))`, "Confirm drawing revisions, takeoff imports, opening schedule checks, source manifest, and workbook status before ordering", "Inputs & Assumptions / PDF Takeoff Import / Opening Schedule Check / QA Checks"],
    ["External Bottom Plates", "Treated F7 / H3", `='Bulk Framing Takeoff'!D5`, "LM", "TBA", `='Bulk Framing Takeoff'!D5`, "", readyGate(`'Wall Measurements'!R5=0`), "", "Wall Measurements external LM"],
    ["Internal Bottom Plates", "F7 Softwood", `='Bulk Framing Takeoff'!D6`, "LM", "TBA", `='Bulk Framing Takeoff'!D6`, "", readyGate(`'Wall Measurements'!R6=0`), "", "Wall Measurements internal LM"],
    ["Top Plates (Double)", "F7 Softwood", `='Bulk Framing Takeoff'!D7`, "LM", "TBA", `='Bulk Framing Takeoff'!D7`, "", readyGate(`SUM('Wall Measurements'!R5:R6)=0`), "", "Wall Measurements total LM"],
    ["Ground Floor Studs", "F7 Softwood", `='Bulk Framing Takeoff'!D10`, "Qty", `='Inputs & Assumptions'!B19&"mm precut"`, "", "", readyGate(`SUM('Wall Measurements'!P5:P6)=0`), "", "Ground wall IDs + openings"],
    ["First Floor Studs", "F7 Softwood", `='Bulk Framing Takeoff'!D13`, "Qty", "TBA", "", "", `=IF(SUM('Wall Measurements'!Q5:Q6)=0,"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF(${engineeringOpen}>0,"Engineer TBA","Partial")))`, "Confirm FF stud height", "First floor wall IDs + openings"],
    ["Cripple Studs", "F7 Softwood", `='Bulk Framing Takeoff'!D21`, "Qty", `='Inputs & Assumptions'!B19&"mm max"`, "", "", `=IF(COUNTIF('Opening Schedule'!T5:T55,"Pending Measure")>0,"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF(${engineeringOpen}>0,"Engineer TBA",IF('Bulk Framing Takeoff'!D21>0,"Ready","Pending Measure"))))`, "Requires Wall ID, head height and sill height", "Opening Schedule cripple columns"],
    ["Noggins", "F7 Softwood", `='Bulk Framing Takeoff'!D14`, "LM", "TBA", `='Bulk Framing Takeoff'!D14`, "", readyGate(`SUM('Wall Measurements'!R5:R6)=0`), "", "Wall Measurements total LM"],
    ["LVL Lintels", "LVL", `='LVL Cutting Optimizer'!C29`, "Lengths", `${project.stockLengthMm}mm`, `='LVL Cutting Optimizer'!C31`, `='LVL Cutting Optimizer'!C32`, `=IF(${reviewOpen}>0,"Pending Measure",IF(COUNTIF('Opening Schedule'!O5:O55,"*Engineer*")+${asOpen}+${engineeringOpen}>0,"Check AS 1684","Ready"))`, "All lintels treated as LVL", "Opening Schedule / LVL Optimizer"],
    ["Special Order Lintels", "LVL / Steel TBA", `='Bulk Framing Takeoff'!D16`, "Qty", "TBA", "", "", `=IF('Bulk Framing Takeoff'!D16>0,"Engineer TBA","Ready")`, "Engineer confirmation required", "Opening Schedule TBA rows"],
    ["Floor Joists", "LVL or I-Joist", `='Bulk Framing Takeoff'!D17`, "LM", "TBA", `='Bulk Framing Takeoff'!D17`, "", `=IF('Floor Framing'!N7=0,"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF(COUNTIF('Floor Framing'!L5:L34,"TBA")+${engineeringOpen}>0,"Engineer TBA","Check AS 1684")))`, "", "Floor Framing zone IDs"],
    ["Floor Blocking", "Match Joist", `='Bulk Framing Takeoff'!D18`, "LM", "TBA", `='Bulk Framing Takeoff'!D18`, "", readyGate(`'Floor Framing'!N7=0`), "", "Floor Framing blocking rows"],
    ["Alphafloor Decking", "Alphafloor", `='Bulk Framing Takeoff'!D19`, "Sheets", "", "", "", `=IF('Floor Framing'!N5=0,"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF(${engineeringOpen}>0,"Engineer TBA","Ready")))`, "", "Floor Framing area"],
    ["Structural Ply Bracing", "Structural Ply", `='Bulk Framing Takeoff'!D20`, "Sheets", "", "", "", `=IF('Wall Measurements'!R8=0,"Pending Measure",IF(${reviewOpen}>0,"Pending Measure",IF(${asOpen}>0,"Check AS 1684","Ready")))`, "", "Wall Measurements bracing LM"],
  ];
  sheet.getRange(`A5:J${4 + rows.length}`).values = rows;
  sheet.getRange(`A4:J${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`C5:C${4 + rows.length}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`F5:G${4 + rows.length}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`A5:J${4 + rows.length}`).format.wrapText = true;
  sheet.tables.add(`A4:J${4 + rows.length}`, true, "OrderSummary");
  sheet.freezePanes.freezeRows(4);
}

// Engineer RFI
if (project.workbookMode === "full") {
  const sheet = sheets["Engineer RFI"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:G1", "Engineer RFI", "Large spans and missing dimensions to confirm before final ordering.");
  sheet.getRange("A4:G4").values = [["RFI Item", "Opening ID", "Clear Span mm", "Current Cut Length mm", "Current Assumption", "Engineer Response", "Status"]];
  styleHeader(sheet.getRange("A4:G4"));
  const items = generateEngineerRfiRows(openings, floorZones, engineeringDetails);
  const staticEndRow = 4 + items.length;
  sheet.getRange(`A5:G${staticEndRow}`).values = items;
  const engineeringRfiRows = Array.from({ length: 40 }, (_, i) => {
    const sourceRow = i + 5;
    const targetRow = staticEndRow + i + 1;
    return [
      `=IF('Engineering Details Check'!N${sourceRow}="Yes","Engineering conflict","")`,
      `=IF(A${targetRow}="","",'Engineering Details Check'!E${sourceRow})`,
      "",
      "",
      `=IF(A${targetRow}="","","Detail "&'Engineering Details Check'!C${sourceRow}&" / "&'Engineering Details Check'!D${sourceRow}&": "&'Engineering Details Check'!H${sourceRow}&" vs "&'Engineering Details Check'!F${sourceRow})`,
      "",
      `=IF(A${targetRow}="","","Open")`,
    ];
  });
  const dynamicStartRow = staticEndRow + 1;
  const dynamicEndRow = dynamicStartRow + engineeringRfiRows.length - 1;
  sheet.getRange(`A${dynamicStartRow}:G${dynamicEndRow}`).values = engineeringRfiRows;
  sheet.getRange(`A5:E${dynamicEndRow}`).format.fill = colors.amber;
  sheet.getRange(`F5:G${dynamicEndRow}`).format.fill = colors.input;
  sheet.getRange(`A4:G${dynamicEndRow}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`C5:D${dynamicEndRow}`).format.numberFormat = "#,##0";
  sheet.tables.add(`A4:G${dynamicEndRow}`, true, "EngineerRFI");
  sheet.freezePanes.freezeRows(4);
}

// Supplier export sheets
if (project.workbookMode === "full") {
  {
    const sheet = sheets["Export - LVL"];
    sheet.showGridLines = false;
    setTitle(sheet, "A1:H1", "Export - LVL", "Supplier-facing LVL order/cutting rows. Ready-order CSV excludes unresolved TBA/check items.");
    sheet.getRange("A4:H4").values = [["Component", "Grade/Size", "Stock Length", "Quantity", "Cut / Bundle", "Source Ref", "Line Status", "Notes"]];
    styleHeader(sheet.getRange("A4:H4"));
    const rows = [
      ["LVL Stock Lengths", "LVL", `='Inputs & Assumptions'!B9`, `='LVL Cutting Optimizer'!C29`, "", "LVL Cutting Optimizer", `='Order Summary'!H13`, "Standard stock count from optimizer"],
      ...Array.from({ length: Math.max(lvlRows.length, 1) }, (_, i) => {
        const sourceRow = i + 5;
        const targetRow = i + 6;
        return [
          `=IF('LVL Cutting Optimizer'!A${sourceRow}="","","LVL Cut Bundle")`,
          "LVL",
          `='Inputs & Assumptions'!B9`,
          `=IF(A${targetRow}="","",1)`,
          `='LVL Cutting Optimizer'!B${sourceRow}`,
          `="LVL stock #"&'LVL Cutting Optimizer'!A${sourceRow}`,
          `=IF(A${targetRow}="","",IF('LVL Cutting Optimizer'!E${sourceRow}<>"OK","Engineer TBA",IF(COUNTIFS('AS 1684 Check Register'!$L$5:$L$50,"<>Complete",'AS 1684 Check Register'!$L$5:$L$50,"<>")>0,"Check AS 1684","Ready")))`,
          `='LVL Cutting Optimizer'!F${sourceRow}`,
        ];
      }),
    ];
    sheet.getRange(`A5:H${4 + rows.length}`).values = rows;
    sheet.getRange(`A4:H${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
    sheet.getRange(`C5:D${4 + rows.length}`).format.numberFormat = "#,##0";
    sheet.getRange(`A5:H${4 + rows.length}`).format.wrapText = true;
    sheet.tables.add(`A4:H${4 + rows.length}`, true, "ExportLVL");
    sheet.freezePanes.freezeRows(4);
  }

  {
    const sheet = sheets["Export - Framing Timber"];
    sheet.showGridLines = false;
    setTitle(sheet, "A1:H1", "Export - Framing Timber", "Supplier-facing framing timber rows from Order Summary.");
    sheet.getRange("A4:H4").values = [["Component", "Grade/Size", "Stock Length", "Quantity", "Unit", "Source Ref", "Line Status", "Notes"]];
    styleHeader(sheet.getRange("A4:H4"));
    const orderRows = [6, 7, 8, 9, 10, 11, 12];
    const rows = orderRows.map((sourceRow) => [
      `='Order Summary'!A${sourceRow}`,
      `='Order Summary'!B${sourceRow}`,
      `='Order Summary'!E${sourceRow}`,
      `='Order Summary'!C${sourceRow}`,
      `='Order Summary'!D${sourceRow}`,
      `='Order Summary'!J${sourceRow}`,
      `='Order Summary'!H${sourceRow}`,
      `='Order Summary'!I${sourceRow}`,
    ]);
    sheet.getRange(`A5:H${4 + rows.length}`).values = rows;
    sheet.getRange(`A4:H${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
    sheet.getRange(`D5:D${4 + rows.length}`).format.numberFormat = "#,##0.00";
    sheet.getRange(`A5:H${4 + rows.length}`).format.wrapText = true;
    sheet.tables.add(`A4:H${4 + rows.length}`, true, "ExportFramingTimber");
    sheet.freezePanes.freezeRows(4);
  }

  {
    const sheet = sheets["Export - Floor"];
    sheet.showGridLines = false;
    setTitle(sheet, "A1:H1", "Export - Floor", "Supplier-facing floor framing/decking rows from Order Summary.");
    sheet.getRange("A4:H4").values = [["Component", "Grade/Size", "Stock Length", "Quantity", "Unit", "Source Ref", "Line Status", "Notes"]];
    styleHeader(sheet.getRange("A4:H4"));
    const orderRows = [15, 16, 17];
    const rows = orderRows.map((sourceRow) => [
      `='Order Summary'!A${sourceRow}`,
      `='Order Summary'!B${sourceRow}`,
      `='Order Summary'!E${sourceRow}`,
      `='Order Summary'!C${sourceRow}`,
      `='Order Summary'!D${sourceRow}`,
      `='Order Summary'!J${sourceRow}`,
      `='Order Summary'!H${sourceRow}`,
      `='Order Summary'!I${sourceRow}`,
    ]);
    sheet.getRange(`A5:H${4 + rows.length}`).values = rows;
    sheet.getRange(`A4:H${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
    sheet.getRange(`D5:D${4 + rows.length}`).format.numberFormat = "#,##0.00";
    sheet.getRange(`A5:H${4 + rows.length}`).format.wrapText = true;
    sheet.tables.add(`A4:H${4 + rows.length}`, true, "ExportFloor");
    sheet.freezePanes.freezeRows(4);
  }

  {
    const sheet = sheets["Export - TBA"];
    sheet.showGridLines = false;
    setTitle(sheet, "A1:H1", "Export - TBA", "Consolidated unresolved items excluded from ready-order CSV exports.");
    sheet.getRange("A4:H4").values = [["Item Type", "Source ID", "Clear / Result", "Cut / Qty", "Reason", "Current Status", "Action / Response", "Source Ref"]];
    styleHeader(sheet.getRange("A4:H4"));
    const rows = [];
    for (let i = 0; i < openings.length; i += 1) {
      const sourceRow = i + 5;
      const targetRow = rows.length + 5;
      rows.push([
        `=IF('Opening Schedule'!O${sourceRow}<>"","Opening","")`,
        `=IF(A${targetRow}="","",'Opening Schedule'!C${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule'!F${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule'!L${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule'!O${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule'!N${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule'!U${sourceRow})`,
        `=IF(A${targetRow}="","","Opening Schedule")`,
      ]);
    }
    for (let sourceRow = 5; sourceRow <= 18; sourceRow += 1) {
      const targetRow = rows.length + 5;
      rows.push([
        `=IF(AND('Order Summary'!H${sourceRow}<>"Ready",'Order Summary'!H${sourceRow}<>""),"Order Line","")`,
        `=IF(A${targetRow}="","",'Order Summary'!A${sourceRow})`,
        `=IF(A${targetRow}="","",'Order Summary'!H${sourceRow})`,
        `=IF(A${targetRow}="","",'Order Summary'!C${sourceRow})`,
        `=IF(A${targetRow}="","",'Order Summary'!I${sourceRow})`,
        `=IF(A${targetRow}="","",'Order Summary'!H${sourceRow})`,
        `=IF(A${targetRow}="","","Resolve order-line blocker")`,
        `=IF(A${targetRow}="","",'Order Summary'!J${sourceRow})`,
      ]);
    }
    for (let i = 0; i < as1684CheckRows().length; i += 1) {
      const sourceRow = i + 5;
      const targetRow = rows.length + 5;
      rows.push([
        `=IF(AND('AS 1684 Check Register'!L${sourceRow}<>"Complete",'AS 1684 Check Register'!L${sourceRow}<>""),"AS 1684 Check","")`,
        `=IF(A${targetRow}="","",'AS 1684 Check Register'!A${sourceRow})`,
        `=IF(A${targetRow}="","",'AS 1684 Check Register'!L${sourceRow})`,
        "",
        `=IF(A${targetRow}="","",'AS 1684 Check Register'!C${sourceRow})`,
        `=IF(A${targetRow}="","",'AS 1684 Check Register'!L${sourceRow})`,
        `=IF(A${targetRow}="","",'AS 1684 Check Register'!F${sourceRow})`,
        `=IF(A${targetRow}="","","AS 1684 Check Register")`,
      ]);
    }
    for (let i = 0; i < 40; i += 1) {
      const sourceRow = i + 5;
      const targetRow = rows.length + 5;
      rows.push([
        `=IF('Engineering Details Check'!N${sourceRow}="Yes","Engineering Detail","")`,
        `=IF(A${targetRow}="","",'Engineering Details Check'!E${sourceRow})`,
        `=IF(A${targetRow}="","",'Engineering Details Check'!L${sourceRow})`,
        `=IF(A${targetRow}="","",'Engineering Details Check'!F${sourceRow})`,
        `=IF(A${targetRow}="","",'Engineering Details Check'!H${sourceRow})`,
        `=IF(A${targetRow}="","",'Engineering Details Check'!O${sourceRow})`,
        `=IF(A${targetRow}="","",'Engineering Details Check'!P${sourceRow})`,
        `=IF(A${targetRow}="","","Engineering Details Check")`,
      ]);
    }
    for (let i = 0; i < 30; i += 1) {
      const sourceRow = i + 5;
      const targetRow = rows.length + 5;
      rows.push([
        `=IF('Floor Framing'!L${sourceRow}="TBA","Floor Span","")`,
        `=IF(A${targetRow}="","",'Floor Framing'!B${sourceRow})`,
        `=IF(A${targetRow}="","",'Floor Framing'!F${sourceRow})`,
        "",
        `=IF(A${targetRow}="","","Joist span over 6000mm")`,
        `=IF(A${targetRow}="","","Engineer TBA")`,
        `=IF(A${targetRow}="","","Engineer confirmation required")`,
        `=IF(A${targetRow}="","","Floor Framing")`,
      ]);
    }
    for (let i = 0; i < TAKEOFF_IMPORT_ROW_COUNT; i += 1) {
      const sourceRow = i + 5;
      const targetRow = rows.length + 5;
      rows.push([
        `=IF(AND('PDF Takeoff Import'!A${sourceRow}<>"",'PDF Takeoff Import'!R${sourceRow}<>"Reviewed"),"Takeoff Import","")`,
        `=IF(A${targetRow}="","",'PDF Takeoff Import'!A${sourceRow})`,
        `=IF(A${targetRow}="","",'PDF Takeoff Import'!R${sourceRow})`,
        `=IF(A${targetRow}="","",'PDF Takeoff Import'!K${sourceRow}&" "&'PDF Takeoff Import'!L${sourceRow})`,
        `=IF(A${targetRow}="","","Imported measurement not marked Reviewed")`,
        `=IF(A${targetRow}="","",'PDF Takeoff Import'!R${sourceRow})`,
        `=IF(A${targetRow}="","","Review calibration/source and set status to Reviewed before ordering")`,
        `=IF(A${targetRow}="","",'PDF Takeoff Import'!M${sourceRow}&" | "&'PDF Takeoff Import'!O${sourceRow})`,
      ]);
    }
    for (let i = 0; i < 150; i += 1) {
      const sourceRow = i + 5;
      const targetRow = rows.length + 5;
      rows.push([
        `=IF(AND('Opening Schedule Check'!D${sourceRow}<>"",'Opening Schedule Check'!I${sourceRow}<>"Reviewed"),"Opening Schedule Check","")`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!D${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!H${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!F${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!K${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!I${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!J${sourceRow})`,
        `=IF(A${targetRow}="","",'Opening Schedule Check'!L${sourceRow})`,
      ]);
    }
    {
      const targetRow = rows.length + 5;
      rows.push([
        `=IF('QA Checks'!C19<>"OK","Source / Pipeline Check","")`,
        `=IF(A${targetRow}="","","Opening schedule manifest")`,
        `=IF(A${targetRow}="","",'QA Checks'!B19)`,
        "",
        `=IF(A${targetRow}="","",'QA Checks'!E19)`,
        `=IF(A${targetRow}="","",'QA Checks'!C19)`,
        `=IF(A${targetRow}="","",'QA Checks'!D19)`,
        `=IF(A${targetRow}="","","QA Checks")`,
      ]);
    }
    sheet.getRange(`A5:H${4 + rows.length}`).values = rows;
    sheet.getRange(`A4:H${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
    sheet.getRange(`C5:D${4 + rows.length}`).format.numberFormat = "#,##0";
    sheet.getRange(`A5:H${4 + rows.length}`).format.wrapText = true;
    sheet.tables.add(`A4:H${4 + rows.length}`, true, "ExportTBA");
    sheet.freezePanes.freezeRows(4);
  }
}

// QA Checks
{
  const sheet = sheets["QA Checks"];
  sheet.showGridLines = false;
  setTitle(sheet, "A1:E1", "QA Checks", "High-level checks for assumptions, missing data, stock fit, and readiness before ordering.");
  sheet.getRange("A4:E4").values = [["Check", "Result", "Status", "Action", "Notes"]];
  styleHeader(sheet.getRange("A4:E4"));
  const rows = [
    ["Bearing allowance", `='Inputs & Assumptions'!B12`, `=IF(B5='Inputs & Assumptions'!B11*2,"OK","CHECK")`, "Confirm B11 and B12", "Total bearing should equal bearing each end x 2"],
    ["Ground floor stud length", `='Inputs & Assumptions'!B19`, `=IF(B6>0,"OK","CHECK")`, "Confirm FFL, joist depth, and plates", "Expected default is 2975mm"],
    ["Drawing revision control", `=IF(OR('Inputs & Assumptions'!G5="TBA",'Inputs & Assumptions'!G6="TBA",'Inputs & Assumptions'!G8="TBA",'Inputs & Assumptions'!G9="TBA",'Inputs & Assumptions'!G13="TBA"),1,0)`, `=IF(B7=0,"OK","Missing Input")`, "Enter drawing numbers, revisions, and measurement source", ""],
    ["Workbook status", `='Inputs & Assumptions'!H14`, `=IF(B8="Ready For Order","OK","OPEN ITEMS")`, "Advance only after measurements, AS 1684 checks, and engineering review are resolved", ""],
    ["Missing opening spans", `=COUNTIF('Opening Schedule'!N5:N55,"Missing span")`, `=IF(B9=0,"OK","TBA")`, "Fill any blank opening spans", ""],
    ["Over-stock lintels", `=COUNTIF('Opening Schedule'!N5:N55,"Over 6.0m")`, `=IF(B10=0,"OK","TBA")`, "Engineer/supplier confirmation required", ""],
    ["Floor spans over 6.0m", `=COUNTIF('Floor Framing'!L5:L34,"TBA")`, `=IF(B11=0,"OK","TBA")`, "Engineer confirmation required", ""],
    ["Measured wall LM", `='Wall Measurements'!R5+'Wall Measurements'!R6`, `=IF(B12>0,"OK","INCOMPLETE")`, "Enter outside-to-outside wall runs", ""],
    ["AS 1684 open checks", `=COUNTIFS('AS 1684 Check Register'!E5:E50,"<>OK",'AS 1684 Check Register'!E5:E50,"<>")`, `=IF(B13=0,"OK","Check AS 1684")`, "Resolve check-register rows", "Workbook is not a compliance certificate"],
    ["AS 1684 audit incomplete", `=COUNTIFS('AS 1684 Check Register'!L5:L50,"<>Complete",'AS 1684 Check Register'!L5:L50,"<>")`, `=IF(B14=0,"OK","Check AS 1684")`, "Complete Checked By, Checked Date, and Reference Clause/Table", "Formula OK alone is not enough"],
    ["Engineering conflicts", `=COUNTIF('Engineering Details Check'!N5:N44,"Yes")`, `=IF(B15=0,"OK","Engineer TBA")`, "Send conflicting details to RFI", ""],
    ["Cripple stud inputs", `=COUNTIF('Opening Schedule'!T5:T55,"Pending Measure")`, `=IF(B16=0,"OK","Pending Measure")`, "Enter Wall ID, sill height, and head height for openings", ""],
    ["Takeoff import review status", `=MAX(0,COUNTA('PDF Takeoff Import'!A5:A154)-COUNTIF('PDF Takeoff Import'!R5:R154,"Reviewed"))`, `=IF(B17=0,"OK","Pending Measure")`, "Review imported PDF/DWG measurements before ordering", "Only Reviewed import rows feed calculation sheets"],
    ["Opening schedule cross-check", `=MAX(0,COUNTA('Opening Schedule Check'!D5:D154)-COUNTIF('Opening Schedule Check'!I5:I154,"Reviewed"))`, `=IF(B18=0,"OK","Pending Measure")`, "Resolve PDF schedule/workbook ID differences before ordering", "Review-only; does not change quantities automatically"],
    ["Source / Pipeline Check", sourceFreshnessCheck.issueCount, `=IF(B19=0,"OK","Stale Source")`, sourceFreshnessCheck.action, sourceFreshnessCheck.notes],
    ["Measurement Ready", `=COUNTIF(C12,"OK")+COUNTIF(C17,"OK")`, `=IF(AND(C12="OK",C17="OK"),"READY","OPEN ITEMS")`, "Complete measured wall/floor/bracing inputs and PDF import review", "Measurement readiness is separate from engineering/order readiness"],
    ["Schedule Cross-Check Ready", `=COUNTIF(C18:C19,"OK")`, `=IF(AND(C18="OK",C19="OK"),"READY","OPEN ITEMS")`, "Resolve opening schedule review rows and source freshness", "PDF schedule data remains review-only"],
    ["AS 1684 / Engineering Ready", `=COUNTIF(C13:C15,"OK")`, `=IF(AND(C13="OK",C14="OK",C15="OK"),"READY","OPEN ITEMS")`, "Resolve AS 1684 audit and engineering conflicts", "Workbook is not a compliance certificate"],
    ["Supplier Order Ready", `=COUNTIF(C5:C19,"OK")&"/"&ROWS(C5:C19)&" base OK"`, `=IF(AND(C20="READY",C21="READY",C22="READY",COUNTIF(C5:C19,"OK")=ROWS(C5:C19)),"READY","OPEN ITEMS")`, "Resolve non-ready rows first", "TBA engineered items can still be ordered separately after confirmation"],
  ];
  sheet.getRange(`A5:E${4 + rows.length}`).values = rows;
  sheet.getRange(`A4:E${4 + rows.length}`).format.borders = { preset: "all", style: "thin", color: colors.border };
  sheet.getRange(`B5:B${4 + rows.length}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "OK",
    format: { fill: colors.paleGreen, font: { bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "READY",
    format: { fill: colors.paleGreen, font: { bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "TBA",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "CHECK",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "Check",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "OPEN",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "Pending",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  sheet.getRange(`C5:C${4 + rows.length}`).conditionalFormats.add("containsText", {
    text: "Stale",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  sheet.tables.add(`A4:E${4 + rows.length}`, true, "QAChecks");
  sheet.freezePanes.freezeRows(4);
}

// Cross-sheet formatting and widths
for (const sheet of Object.values(sheets)) {
  autofit(sheet);
  const used = sheet.getUsedRange(true);
  used.format.font = { name: "Aptos" };
}

// Apply warning formats where useful.
sheets["Opening Schedule"].getRange("O5:O55").conditionalFormats.add("containsText", {
  text: "TBA",
  format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
});
sheets["Opening Schedule"].getRange("N5:N55").conditionalFormats.add("containsText", {
  text: "Over",
  format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
});
sheets["Opening Schedule"].getRange("N5:N55").conditionalFormats.add("containsText", {
  text: "Missing",
  format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
});
sheets["Opening Schedule"].getRange("T5:T55").conditionalFormats.add("containsText", {
  text: "Pending",
  format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
});
for (const statusText of ["Needs Review", "TBA", "Pending", "Rejected"]) {
  sheets["PDF Takeoff Import"].getRange("R5:R154").conditionalFormats.add("containsText", {
    text: statusText,
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
}
for (const statusText of ["Missing", "Duplicate", "Dimension", "Needs Review", "Pending"]) {
  sheets["Opening Schedule Check"].getRange("H5:I154").conditionalFormats.add("containsText", {
    text: statusText,
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
}
if (project.workbookMode === "full") {
  sheets["LVL Cutting Optimizer"].getRange("E5:E80").conditionalFormats.add("containsText", {
    text: "DOES NOT FIT",
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
  for (const statusText of ["TBA", "Pending", "Check AS", "Engineer", "Blocked", "Partial", "Open"]) {
    sheets["Order Summary"].getRange("H5:H80").conditionalFormats.add("containsText", {
      text: statusText,
      format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
    });
  }
  for (const exportSheet of ["Export - LVL", "Export - Framing Timber", "Export - Floor"]) {
    for (const statusText of ["TBA", "Pending", "Check", "Engineer", "Partial", "Open"]) {
      sheets[exportSheet].getRange("G5:G200").conditionalFormats.add("containsText", {
        text: statusText,
        format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
      });
    }
  }
}
sheets["Floor Framing"].getRange("L5:L34").conditionalFormats.add("containsText", {
  text: "TBA",
  format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
});
sheets["Engineering Details Check"].getRange("L5:N44").conditionalFormats.add("containsText", {
  text: "Conflict",
  format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
});
for (const statusText of ["Check", "Engineer", "Missing"]) {
  sheets["AS 1684 Check Register"].getRange("E5:E50").conditionalFormats.add("containsText", {
    text: statusText,
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
}
for (const statusText of ["Incomplete", "Check", "Engineer", "Missing"]) {
  sheets["AS 1684 Check Register"].getRange("L5:L50").conditionalFormats.add("containsText", {
    text: statusText,
    format: { fill: colors.amber, font: { color: colors.warning, bold: true } },
  });
}

// Data validation for common editable fields.
sheets["Wall Measurements"].getRange("A5:A84").dataValidation = { rule: { type: "list", values: ["A", "B"] } };
sheets["Wall Measurements"].getRange("B5:B84").dataValidation = { rule: { type: "list", values: ["Ground", "First"] } };
sheets["Wall Measurements"].getRange("D5:D84").dataValidation = { rule: { type: "list", values: ["External", "Internal", "Bracing"] } };
sheets["Wall Measurements"].getRange("F5:F84").dataValidation = { rule: { type: "list", values: ["mm", "m"] } };
sheets["PDF Takeoff Import"].getRange("B5:B154").dataValidation = { rule: { type: "list", values: ["Wall Measurements", "Floor Framing", "Opening Schedule", "Engineering Details Check", "AS 1684 Check Register"] } };
sheets["PDF Takeoff Import"].getRange("D5:D154").dataValidation = { rule: { type: "list", values: ["linear", "area", "count", "engineering_reference", "opening", "note"] } };
sheets["PDF Takeoff Import"].getRange("R5:R154").dataValidation = { rule: { type: "list", values: ["Reviewed", "Needs Review", "Draft", "Rejected", "TBA / Engineer", "TBA"] } };
sheets["Opening Schedule Check"].getRange("I5:I154").dataValidation = { rule: { type: "list", values: ["Reviewed", "Needs Review", "Rejected"] } };
sheets["Opening Schedule"].getRange("A5:A55").dataValidation = { rule: { type: "list", values: ["A", "B"] } };
sheets["Opening Schedule"].getRange("B5:B55").dataValidation = { rule: { type: "list", values: ["Ground", "First"] } };
sheets["Opening Schedule"].getRange("J5:J55").dataValidation = { rule: { type: "list", values: ["Schedule", "Site Measure", "Architectural Plan", "Engineer Detail"] } };
sheets["Inputs & Assumptions"].getRange("H14:H14").dataValidation = { rule: { type: "list", values: ["Draft", "Measured", "Engineer Review", "Ready For Order"] } };
sheets["Floor Framing"].getRange("A5:A34").dataValidation = { rule: { type: "list", values: ["A", "B"] } };
sheets["Floor Framing"].getRange("E5:E34").dataValidation = { rule: { type: "list", values: ["Length", "Width"] } };
sheets["Engineering Details Check"].getRange("K5:K44").dataValidation = { rule: { type: "list", values: ["External Bottom Plates", "Internal Bottom Plates", "Top Plates", "Ground Floor Studs", "First Floor Studs", "Cripple Studs", "LVL Lintels", "Special Order Lintels", "Floor Joists", "Floor Blocking", "Alphafloor Decking", "Structural Ply Bracing"] } };
sheets["Engineering Details Check"].getRange("L5:L44").dataValidation = { rule: { type: "list", values: ["Matches", "Conflict", "Not Checked", "Not Applicable"] } };
sheets["Engineering Details Check"].getRange("M5:M44").dataValidation = { rule: { type: "list", values: ["Yes", "No"] } };
sheets["Engineering Details Check"].getRange("O5:O44").dataValidation = { rule: { type: "list", values: ["No Impact", "Revise Order", "Engineer TBA", "Hold Order"] } };
if (project.workbookMode === "full") {
  sheets["Engineer RFI"].getRange("G5:G200").dataValidation = { rule: { type: "list", values: ["Open", "Answered", "Closed"] } };
}

const csvExportPaths = [];
if (project.workbookMode === "full") {
  const exportDir = path.join(outputDir, "exports");
  await fs.mkdir(exportDir, { recursive: true });
  const readyHeader = ["component", "grade_size", "stock_length", "quantity", "cut_or_bundle", "source_ref", "status", "notes"];
  const tbaHeader = ["item_type", "source_id", "clear_or_result", "cut_or_qty", "reason", "current_status", "action_or_response", "source_ref"];
  const projectRevisionMissing = project.architecturalDrawingNo.includes("TBA") || project.engineeringDrawingNo.includes("TBA");
  const as1684Blocked = project.windClassification === "TBA" || project.buildingClass.includes("TBA") || project.bracingSource.includes("TBA");
  const wallSummary = summarizeWallTakeoff();
  const floorSummary = summarizeFloorTakeoff();
  const wallWasteMultiplier = 1 + project.wallWastePct / 100;
  const externalPlateLm = rounded(wallSummary.externalLm * wallWasteMultiplier);
  const internalPlateLm = rounded(wallSummary.internalLm * wallWasteMultiplier);
  const topPlateLm = rounded(wallSummary.totalLm * 2 * wallWasteMultiplier);
  const nogginLm = rounded(wallSummary.totalLm * project.nogginRows);
  const groundStudStatus = lineStatus({ quantity: wallSummary.groundStudQty, as1684Block: as1684Blocked });
  const firstStudStatus = wallSummary.firstStudQty ? "Engineer TBA" : "Pending Measure";
  const crippleStudStatus = "Engineer TBA";
  const floorJoistStatus = floorSummary.hasRows
    ? (floorSummary.hasCompleteSpans ? lineStatus({ quantity: floorSummary.joistLm, as1684Block: as1684Blocked }) : "Engineer TBA")
    : "Pending Measure";
  const floorBlockingStatus = floorSummary.hasRows
    ? (floorSummary.hasCompleteSpans ? lineStatus({ quantity: floorSummary.blockingLm || 1, as1684Block: as1684Blocked }) : "Engineer TBA")
    : "Pending Measure";
  const floorDeckingStatus = floorSummary.hasRows
    ? lineStatus({ quantity: floorSummary.deckingSheets, as1684Block: as1684Blocked })
    : "Pending Measure";
  const lvlExportItems = [
    ["LVL Stock Lengths", "LVL", `${project.stockLengthMm}mm`, lvlRows.length, "", "LVL Cutting Optimizer", lineStatus({ quantity: lvlRows.length, as1684Block: as1684Blocked }), "Standard stock count from optimizer"],
  ];
  const framingExportItems = [
    ["External Bottom Plates", "Treated F7 / H3", activeStockProfile.plateStockMm.join(" / "), externalPlateLm, "LM", "Wall Measurements external LM", lineStatus({ quantity: externalPlateLm, as1684Block: as1684Blocked }), `Reviewed PDF wall LM ${rounded(wallSummary.externalLm)}m plus ${project.wallWastePct}% waste`],
    ["Internal Bottom Plates", "F7 Softwood", activeStockProfile.plateStockMm.join(" / "), internalPlateLm, "LM", "Wall Measurements internal LM", lineStatus({ quantity: internalPlateLm, as1684Block: as1684Blocked }), `Reviewed PDF wall LM ${rounded(wallSummary.internalLm)}m plus ${project.wallWastePct}% waste`],
    ["Top Plates (Double)", "F7 Softwood", activeStockProfile.plateStockMm.join(" / "), topPlateLm, "LM", "Wall Measurements total LM", lineStatus({ quantity: topPlateLm, as1684Block: as1684Blocked }), `Reviewed PDF wall LM ${rounded(wallSummary.totalLm)}m x double top plates plus ${project.wallWastePct}% waste`],
    ["Ground Floor Studs", "F7 Softwood", `${groundFloorStudLengthMm}mm`, wallSummary.groundStudQty, "Qty", "Ground wall IDs + openings", groundStudStatus, "Base studs from reviewed PDF wall LM plus two trimmers per scheduled ground-floor opening"],
    ["First Floor Studs", "F7 Softwood", "TBA", wallSummary.firstStudQty, "Qty", "First floor wall IDs + openings", firstStudStatus, "Base studs from reviewed PDF wall LM; confirm first-floor stud height/member before ordering"],
    ["Cripple Studs", "F7 Softwood", `${groundFloorStudLengthMm}mm max`, 0, "Qty", "Opening Schedule cripple columns", crippleStudStatus, "RFI: assign openings to wall IDs and confirm sill/head heights before cripple-stud cutting"],
    ["Noggins", "F7 Softwood", activeStockProfile.nogginStockMm.join(" / "), nogginLm, "LM", "Wall Measurements total LM", lineStatus({ quantity: nogginLm, as1684Block: as1684Blocked }), `Reviewed PDF wall LM ${rounded(wallSummary.totalLm)}m x ${project.nogginRows} noggin rows`],
  ];
  const floorExportItems = [
    ["Floor Joists", "LVL or I-Joist", "TBA", rounded(floorSummary.joistLm), "LM", "Floor Framing zone IDs", floorJoistStatus, "Enter reviewed floor zones and confirm J1/J2 member schedule from structural sheet S1.03"],
    ["Floor Blocking", "Match Joist", "TBA", rounded(floorSummary.blockingLm), "LM", "Floor Framing blocking rows", floorBlockingStatus, "Enter reviewed floor zones/spans before blocking quantity is final"],
    ["Alphafloor Decking", "Alphafloor", "", floorSummary.deckingSheets, "Sheets", "Floor Framing area", floorDeckingStatus, "Enter reviewed upper-floor area zones before decking quantity is final"],
  ];
  const readyOnly = (rows) => [readyHeader, ...rows.filter((row) => row[6] === "Ready")];
  const lvlReadyRows = readyOnly(lvlExportItems);
  const framingReadyRows = readyOnly(framingExportItems);
  const floorReadyRows = readyOnly(floorExportItems);

  const tbaRows = [tbaHeader];
  for (const row of [...lvlExportItems, ...framingExportItems, ...floorExportItems]) {
    if (row[6] !== "Ready") {
      const action = row[6] === "Check AS 1684"
        ? "Close AS 1684/admin blocker before supplier-ready export"
        : row[7];
      tbaRows.push(["Order Line", row[0], row[6], row[3], row[7], row[6], action, row[5]]);
    }
  }
  for (const measurement of pendingTakeoffMeasurements) {
    const sourceSystem = String(measurement.sourceSystem || "").toUpperCase();
    tbaRows.push([
      sourceSystem === "DWG" ? "DWG Import" : "PDF Import",
      measurement.id || "",
      measurement.reviewStatus || "Needs Review",
      `${measurement.value ?? ""} ${measurement.unit ?? ""}`.trim(),
      "Imported measurement not marked Reviewed",
      measurement.reviewStatus || "Needs Review",
      "Review calibration/source and set status to Reviewed before ordering",
      sourceNoteFromTakeoffMeasurement(measurement) || "PDF Takeoff Import",
    ]);
  }
  for (const row of unresolvedOpeningScheduleChecks) {
    tbaRows.push([
      "Opening Schedule Check",
      row.openingId || "",
      row.status || "Needs Review",
      row.workbookClearSpanMm || "",
      row.notes || "Opening schedule cross-check unresolved",
      row.reviewStatus || "Needs Review",
      row.action || "Review PDF schedule/workbook mismatch before ordering",
      row.sourceRef || "Opening Schedule Check",
    ]);
  }
  for (const row of unresolvedOpeningMeasurementOverrides) {
    tbaRows.push([
      "Opening Measurement Override",
      row.openingId || "",
      row.reviewStatus || "Needs Review",
      [row.wallId, row.sillHeightMm, row.headHeightMm].filter(Boolean).join(" / "),
      "Opening wall/sill/head row is not marked Reviewed",
      row.reviewStatus || "Needs Review",
      "Review source evidence and set reviewStatus to Reviewed before using for cripple-stud quantities",
      row.sourceRef || "inputs/opening_measurement_overrides.csv",
    ]);
  }
  for (const row of unresolvedEngineeringOpeningOverrides) {
    tbaRows.push([
      "Engineering Opening Override",
      row.openingId || "",
      row.reviewStatus || row.responseStatus || "Needs Review",
      [row.memberType, row.memberSize].filter(Boolean).join(" "),
      "Engineering opening row is incomplete, TBA, open, or not marked Reviewed",
      "Engineer TBA",
      "Confirm member type, size, bearing, connections, source detail, response status and reviewStatus",
      row.sourceRef || row.sourceDrawingDetail || "inputs/engineering_opening_overrides.csv",
    ]);
  }
  if (sourceFreshnessCheck.issueCount > 0) {
    tbaRows.push([
      "Source / Pipeline Check",
      "Source manifests",
      sourceFreshnessCheck.result,
      "",
      sourceFreshnessCheck.notes,
      sourceFreshnessCheck.status,
      sourceFreshnessCheck.action,
      sourceFreshnessCheck.sourceRef,
    ]);
  }
  for (const cut of specialCuts) {
    if (!openingEngineeringResolved(cut.id)) {
      tbaRows.push(["Opening", cut.id, cut.clearSpanMm, cut.lengthMm, cut.note, "Engineer TBA", "Confirm member type, size, bearing and connections", "Opening Schedule"]);
    }
  }
  for (const [site, level, id, type, clearSpanMm] of openings) {
    if (clearSpanMm !== "" && clearSpanMm != null && clearSpanMm >= 3200 && !openingEngineeringResolved(id)) {
      tbaRows.push(["Large opening", id, clearSpanMm, finalCutLengthMm(clearSpanMm), "Clear span >= 3200mm", "Engineer TBA", "Confirm LVL/steel/member schedule", `Opening Schedule ${site} ${level}`]);
    }
  }
  if (project.windClassification === "TBA") {
    tbaRows.push(["AS 1684 Check", "Wind classification", "TBA", "", "Required before span/bracing/tie-down checks", "Missing Input", "Confirm from engineer/certifier/plans", "Inputs & Assumptions"]);
  }
  if (project.buildingClass.includes("TBA")) {
    tbaRows.push(["AS 1684 Check", "Building class", project.buildingClass, "", "Required before AS 1684 applicability check", "Missing Input", "Confirm NCC class", "Inputs & Assumptions"]);
  }
  if (project.bracingSource.includes("TBA")) {
    tbaRows.push(["AS 1684 Check", "Bracing source", project.bracingSource, "", "Required before bracing quantity/order is final", "Missing Input", "Enter bracing plan or engineer notes", "Inputs & Assumptions"]);
  }
  if (project.architecturalDrawingNo.includes("TBA") || project.engineeringDrawingNo.includes("TBA")) {
    tbaRows.push(["Revision control", "Drawing register", "TBA", "", "Drawing issue not locked", "Missing Input", "Enter drawing numbers and revisions", "Inputs & Assumptions"]);
  }

  const csvFiles = [
    ["lvl_order_ready.csv", lvlReadyRows],
    ["framing_timber_ready.csv", framingReadyRows],
    ["floor_ready.csv", floorReadyRows],
    ["tba_items.csv", tbaRows],
  ];
  for (const [fileName, rows] of csvFiles) {
    const filePath = path.join(exportDir, fileName);
    await writeCsv(filePath, rows);
    csvExportPaths.push(filePath);
  }
}

// Compact verification logs.
qaCheck(totalBearingAllowanceMm === project.bearingEachEndMm * 2, "Total bearing allowance does not equal bearing each end x 2.", { fatal: true });
qaCheck(groundFloorStudLengthMm > 0, "Ground floor stud length is not positive.", { fatal: true });
qaCheck(lvlRows.every((row) => row[2] <= project.stockLengthMm), "A standard LVL optimizer row exceeds the active stock length.", { fatal: true });
qaCheck(sheetNames.every((name) => sheets[name]), "One or more required sheets were not created.", { fatal: true });
qaCheck(takeoffMeasurements.length <= TAKEOFF_IMPORT_ROW_COUNT, `Takeoff import contains more than ${TAKEOFF_IMPORT_ROW_COUNT} rows; workbook staging sheet shows the first ${TAKEOFF_IMPORT_ROW_COUNT}.`, { fatal: false });
qaCheck(sourceFreshnessCheck.issueCount === 0, `Source pipeline check is ${sourceFreshnessCheck.status}: ${sourceFreshnessCheck.notes}`, { fatal: false });
const missingSpanCutCount = specialCuts.filter((cut) => cut.note === "Missing clear span").length;
const overStockCutCount = specialCuts.length - missingSpanCutCount;
qaCheck(specialCuts.length === 0, `${specialCuts.length} lintel item(s) need special-order/engineer review (${overStockCutCount} over stock, ${missingSpanCutCount} missing span).`, { fatal: false });
qaCheck(project.workbookMode !== "full" || csvExportPaths.length === 4, "Full mode did not generate all four supplier CSV export files.", { fatal: true });

const takeoff = await workbook.inspect({
  kind: "table",
  range: project.workbookMode === "full" ? "Bulk Framing Takeoff!A4:I21" : "QA Checks!A4:E23",
  include: "values,formulas",
  tableMaxRows: 18,
  tableMaxCols: 9,
  maxChars: 8000,
});
console.log(takeoff.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 3000,
});
console.log(errors.ndjson);
qaCheck(errors.ndjson.includes("Cell search matched 0 entries"), "Workbook formula error scan found one or more error cells.", { fatal: true });

const scriptQa = { kind: "script-qa", mode: project.workbookMode, warnings: qaWarnings, failures: qaFailures };
console.log(JSON.stringify(scriptQa));
if (qaFailures.length) {
  throw new Error(`Workbook build failed QA: ${qaFailures.join("; ")}`);
}

if (!skipRender) {
  for (const name of sheetNames) {
    const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    await fs.writeFile(path.join(outputDir, `${name.replace(/[ &/]/g, "_")}.png`), previewBytes);
  }
}

const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, `Sample_Timber_Framing_Takeoff_Cutting_List_${project.workbookMode}.xlsx`);
await output.save(outputPath);
console.log(`SAVED ${outputPath}`);

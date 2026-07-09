import fs from "node:fs/promises";
import path from "node:path";

const LF_TO_M = 0.3048;
const SF_TO_M2 = 0.09290304;

const allowedStatuses = new Set(["Draft", "Needs Review", "Reviewed", "Rejected", "TBA / Engineer"]);
const allowedTargets = new Set([
  "Wall Measurements",
  "Floor Framing",
  "Opening Schedule",
  "Engineering Details Check",
  "AS 1684 Check Register",
]);
const allowedTypes = new Set(["linear", "area", "count", "engineering_reference", "opening"]);

function usage() {
  return [
    "Usage:",
    "  node scripts/convert_opentakeoff_export.mjs --input <opentakeoff.json|csv> --mapping <mapping.json> --output <import.json> --review-csv <review.csv>",
    "",
    "Example:",
    "  node scripts/convert_opentakeoff_export.mjs --input research/opentakeoff-samples/sample_sample_opentakeoff_report.json --mapping inputs/opentakeoff_mapping.sample.json --output inputs/pdf_takeoff_import.json --review-csv outputs/pdf_takeoff_import_review.csv",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

function csvRowsToConditions(rows) {
  const headerIndex = rows.findIndex((r) => r.includes("Finish") && r.includes("LF") && r.includes("EA"));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((h) => String(h || "").trim());
  const idx = (name) => headers.indexOf(name);
  const conditionRows = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const finish = row[idx("Finish")];
    if (!finish || finish === "TOTAL" || finish === "Finish") break;
    conditionRows.push({
      finish_tag: finish,
      shape_count: numberOrZero(row[idx("Shapes")]),
      multiplier: numberOrZero(row[idx("Multiplier")]),
      waste_pct: numberOrZero(row[idx("Waste %")]),
      floor_sf: numberOrZero(row[idx("Floor SF")]),
      wall_sf: numberOrZero(row[idx("Wall SF")]),
      border_sf: numberOrZero(row[idx("Border SF")]),
      total_sf: numberOrZero(row[idx("Total SF")]),
      lf: numberOrZero(row[idx("LF")]),
      ea: numberOrZero(row[idx("EA")]),
      total_sf_net: numberOrZero(row[idx("Total SF (w/ waste)")]),
      lf_net: numberOrZero(row[idx("LF (w/ waste)")]),
      sy_net: numberOrZero(row[idx("SY (w/ waste)")]),
    });
  }
  return conditionRows;
}

function numberOrZero(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadOpenTakeoff(inputPath) {
  const text = await fs.readFile(inputPath, "utf8");
  if (inputPath.toLowerCase().endsWith(".json")) {
    const json = JSON.parse(text);
    return Array.isArray(json.conditions) ? json.conditions : [];
  }
  if (inputPath.toLowerCase().endsWith(".csv")) {
    return csvRowsToConditions(parseCsv(text));
  }
  throw new Error(`Unsupported OpenTakeoff export extension: ${inputPath}`);
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function conditionValue(condition, mapping) {
  const source = mapping.quantitySource || (
    mapping.measurementType === "linear" ? "lf" :
    mapping.measurementType === "area" ? "total_sf" :
    mapping.measurementType === "count" ? "ea" :
    "total_sf"
  );
  const sourceValue = numberOrZero(condition[source]);
  if (mapping.measurementType === "linear") {
    const valueM = sourceValue * LF_TO_M;
    return {
      sourceValue,
      sourceUnit: "ft",
      value: round(valueM, 3),
      unit: "m",
      valueM: round(valueM, 3),
      valueMm: round(valueM * 1000, 0),
    };
  }
  if (mapping.measurementType === "area") {
    const valueM2 = sourceValue * SF_TO_M2;
    return {
      sourceValue,
      sourceUnit: "sf",
      value: round(valueM2, 3),
      unit: "m2",
      valueM2: round(valueM2, 3),
    };
  }
  if (mapping.measurementType === "count") {
    return {
      sourceValue,
      sourceUnit: "ea",
      value: round(sourceValue, 0),
      unit: "ea",
    };
  }
  return {
    sourceValue,
    sourceUnit: source,
    value: 0,
    unit: "text",
  };
}

function measurementId(index, mapping) {
  const base = [
    mapping.site || "TBA",
    mapping.level || "TBA",
    mapping.wallId || mapping.zoneId || mapping.openingId || mapping.tradeComponent || mapping.conditionName || `row-${index + 1}`,
  ].join("-");
  return base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-");
}

function validateMeasurement(m) {
  const errors = [];
  for (const key of [
    "id",
    "project",
    "sourcePdf",
    "pageNumber",
    "sheetNumber",
    "drawingRevision",
    "calibrationSource",
    "measurementType",
    "tradeComponent",
    "targetWorkbookSheet",
    "site",
    "level",
    "value",
    "unit",
    "reviewStatus",
    "sourceSystem",
  ]) {
    if (m[key] === undefined || m[key] === null || m[key] === "") errors.push(`missing ${key}`);
  }
  if (!allowedStatuses.has(m.reviewStatus)) errors.push(`invalid reviewStatus ${m.reviewStatus}`);
  if (!allowedTargets.has(m.targetWorkbookSheet)) errors.push(`invalid targetWorkbookSheet ${m.targetWorkbookSheet}`);
  if (!allowedTypes.has(m.measurementType)) errors.push(`invalid measurementType ${m.measurementType}`);
  if (!Number.isFinite(Number(m.value))) errors.push("value is not numeric");
  if (!Number.isInteger(Number(m.pageNumber)) || Number(m.pageNumber) < 1) errors.push("pageNumber must be a positive integer");
  return errors;
}

function toMeasurement({ condition, mapping, mapRoot, inputPath, mappingPath, index }) {
  const values = conditionValue(condition, mapping);
  const reviewStatus = mapping.reviewStatus || "Needs Review";
  const measurement = {
    id: mapping.id || measurementId(index, mapping),
    project: mapping.project || mapRoot.project || "Unknown Project",
    sourcePdf: mapping.sourcePdf || mapRoot.sourcePdf || "",
    pageNumber: Number(mapping.pageNumber || 1),
    sheetNumber: mapping.sheetNumber || "TBA",
    drawingRevision: mapping.drawingRevision || mapRoot.drawingRevision || "TBA",
    calibrationSource: mapping.calibrationSource || mapRoot.calibrationSource || "TBA",
    measurementType: mapping.measurementType,
    tradeComponent: mapping.tradeComponent,
    targetWorkbookSheet: mapping.targetWorkbookSheet,
    site: mapping.site || "TBA",
    level: mapping.level || "TBA",
    wallId: mapping.wallId || "",
    zoneId: mapping.zoneId || "",
    openingId: mapping.openingId || "",
    ...values,
    reviewStatus,
    reviewer: mapping.reviewer || mapRoot.reviewer || "",
    reviewedDate: mapping.reviewedDate || mapRoot.reviewedDate || "",
    sourceSystem: "OpenTakeoff",
    conditionName: mapping.conditionName || condition.finish_tag || "",
    confidence: reviewStatus === "Reviewed" ? 1 : 0.5,
    notes: [
      mapping.notes || "",
      `OpenTakeoff source ${path.basename(inputPath)}`,
      `Mapping ${path.basename(mappingPath)}`,
    ].filter(Boolean).join(" | "),
  };
  return measurement;
}

function reviewCsvRows(measurements, validationRows, unmapped) {
  const rows = [[
    "Import ID",
    "Condition",
    "Target Workbook Sheet",
    "Measurement Type",
    "Trade Component",
    "Site",
    "Level",
    "Value",
    "Unit",
    "Review Status",
    "Source PDF",
    "Page",
    "Sheet",
    "Validation",
    "Notes",
  ]];
  for (const measurement of measurements) {
    rows.push([
      measurement.id,
      measurement.conditionName,
      measurement.targetWorkbookSheet,
      measurement.measurementType,
      measurement.tradeComponent,
      measurement.site,
      measurement.level,
      measurement.value,
      measurement.unit,
      measurement.reviewStatus,
      measurement.sourcePdf,
      measurement.pageNumber,
      measurement.sheetNumber,
      validationRows.get(measurement.id)?.join("; ") || "OK",
      measurement.notes,
    ]);
  }
  for (const condition of unmapped) {
    rows.push([
      "",
      condition.finish_tag || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Needs Review",
      "",
      "",
      "",
      "UNMAPPED",
      "Add this condition to the mapping file if it should import to the workbook.",
    ]);
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args.mapping || !args.output || !args["review-csv"]) {
    console.error(usage());
    process.exit(args.help ? 0 : 2);
  }

  const inputPath = path.resolve(args.input);
  const mappingPath = path.resolve(args.mapping);
  const outputPath = path.resolve(args.output);
  const reviewCsvPath = path.resolve(args["review-csv"]);

  const [conditions, mapping] = await Promise.all([
    loadOpenTakeoff(inputPath),
    fs.readFile(mappingPath, "utf8").then(JSON.parse),
  ]);

  const mapByCondition = new Map((mapping.conditions || []).map((entry) => [entry.conditionName, entry]));
  const measurements = [];
  const unmapped = [];
  conditions.forEach((condition, index) => {
    const map = mapByCondition.get(condition.finish_tag);
    if (!map) {
      if (condition.finish_tag && condition.finish_tag !== "TOTAL") unmapped.push(condition);
      return;
    }
    measurements.push(toMeasurement({ condition, mapping: map, mapRoot: mapping, inputPath, mappingPath, index }));
  });

  const validationRows = new Map();
  for (const measurement of measurements) {
    const errors = validateMeasurement(measurement);
    if (errors.length) validationRows.set(measurement.id, errors);
  }

  const importPayload = {
    project: mapping.project || "Unknown Project",
    source: {
      system: "OpenTakeoff",
      importedAt: new Date().toISOString(),
      sourceFile: path.basename(inputPath),
      mappingFile: path.basename(mappingPath),
    },
    measurements,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.mkdir(path.dirname(reviewCsvPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(importPayload, null, 2) + "\n", "utf8");
  await fs.writeFile(
    reviewCsvPath,
    reviewCsvRows(measurements, validationRows, unmapped).map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n",
    "utf8",
  );

  const invalidCount = [...validationRows.values()].filter((errors) => errors.length).length;
  console.log(JSON.stringify({
    input: inputPath,
    mapping: mappingPath,
    output: outputPath,
    reviewCsv: reviewCsvPath,
    conditionCount: conditions.length,
    measurementCount: measurements.length,
    unmappedCount: unmapped.length,
    invalidCount,
  }, null, 2));

  if (!measurements.length) throw new Error("No mapped measurements were produced.");
  if (invalidCount) throw new Error(`${invalidCount} measurement(s) failed validation.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

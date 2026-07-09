import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { fileSignature } from "./lib/source_manifest.mjs";

const defaultWorkbook = "outputs/timber_frame_cutting_list/Sample_Timber_Framing_Takeoff_Cutting_List_full.xlsx";
const defaultExtract = "outputs/pdf_plan_index/opening_schedule_extract.csv";
const defaultOutput = "outputs/opening_schedule_crosscheck.csv";
const defaultReviewOverrides = "inputs/opening_schedule_review_overrides.csv";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
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
  return rows.filter((r) => r.some((value) => String(value).trim() !== ""));
}

function csvToRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

async function readOpeningSchedule(workbookPath) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  const sheet = workbook.worksheets.getItem("Opening Schedule");
  const values = sheet.getRange("A5:F80").values;
  return values
    .filter((row) => row[2])
    .map((row) => ({
      site: String(row[0] ?? "").trim(),
      level: String(row[1] ?? "").trim(),
      openingId: String(row[2] ?? "").trim(),
      type: String(row[4] ?? "").trim(),
      clearSpanMm: row[5] === "" || row[5] == null ? "" : Number(row[5]),
    }));
}

function groupExtract(records) {
  const grouped = new Map();
  for (const record of records) {
    const openingId = String(record.openingId || "").trim();
    if (!openingId) continue;
    const key = `${record.site || openingId.slice(-1)}::${openingId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  return grouped;
}

function sourceRef(records) {
  const first = records[0] || {};
  return [first.sourcePdf, first.page ? `p${first.page}` : ""].filter(Boolean).join(" | ");
}

function asFiniteNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pdfClearSpan(records) {
  const spans = [...new Set(records
    .map((record) => asFiniteNumber(record.extractedClearSpanMm))
    .filter((value) => value != null))];
  return spans.length === 1 ? spans[0] : "";
}

function buildRows(workbookRows, extractRecords) {
  const workbookByKey = new Map(workbookRows.map((row) => [`${row.site}::${row.openingId}`, row]));
  const extractByKey = groupExtract(extractRecords);
  const allKeys = new Set([...workbookByKey.keys(), ...extractByKey.keys()]);
  const rows = [];

  for (const key of [...allKeys].sort()) {
    const workbookRow = workbookByKey.get(key);
    const extracted = extractByKey.get(key) || [];
    const openingId = workbookRow?.openingId || extracted[0]?.openingId || key.split("::")[1];
    const site = workbookRow?.site || extracted[0]?.site || key.split("::")[0];
    const pdfOccurrences = extracted.length;
    const pdfClearSpanMm = pdfClearSpan(extracted);

    let status = "OK";
    let action = "No action required.";
    let notes = "";

    if (!workbookRow) {
      status = "Missing From Workbook";
      action = "Review PDF schedule ID and add to Opening Schedule if applicable.";
      notes = "PDF schedule contains an opening ID not currently listed in the workbook.";
    } else if (!pdfOccurrences) {
      status = "Missing From PDF Schedule";
      action = "Confirm whether workbook opening is shown elsewhere or should stay as a plan-only opening.";
      notes = workbookRow.type?.toLowerCase().includes("garage")
        ? "Garage openings may be plan-derived rather than schedule-derived; confirm manually."
        : "Workbook opening ID was not extracted from the schedule pages.";
    } else if (pdfOccurrences > 1) {
      status = "Duplicate In PDF Schedule";
      action = "Check whether duplicate extracted IDs are real schedule duplicates or repeated text.";
      notes = `Extracted ${pdfOccurrences} occurrences on schedule pages.`;
    } else if (workbookRow.clearSpanMm === "" || !Number.isFinite(Number(workbookRow.clearSpanMm))) {
      status = "Workbook Missing Clear Span";
      action = "Enter or confirm clear span before using lintel quantity for ordering.";
      notes = "Workbook has the opening ID but no clear span.";
    } else if (pdfClearSpanMm !== "" && Number(workbookRow.clearSpanMm) !== Number(pdfClearSpanMm)) {
      status = "Dimension Mismatch";
      action = "Review PDF schedule dimension against workbook clear span before ordering.";
      notes = `PDF extracted clear span ${pdfClearSpanMm}mm differs from workbook clear span ${workbookRow.clearSpanMm}mm.`;
    }

    rows.push({
      sourcePdf: sourceRef(extracted) || "Workbook Opening Schedule",
      page: extracted[0]?.page || "",
      site,
      openingId,
      workbookLevel: workbookRow?.level || "",
      workbookClearSpanMm: workbookRow?.clearSpanMm ?? "",
      pdfOccurrences,
      status,
      reviewStatus: status === "OK" ? "Reviewed" : "Needs Review",
      action,
      notes,
      sourceRef: sourceRef(extracted) || "Opening Schedule",
      pdfClearSpanMm,
      reviewedBy: "",
      reviewedDate: "",
    });
  }

  return rows;
}

async function loadReviewOverrides(filePath) {
  try {
    return csvToRecords(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function applyReviewOverrides(rows, overrides) {
  const byId = new Map(overrides
    .filter((row) => row.openingId)
    .map((row) => [String(row.openingId).trim(), row]));
  return rows.map((row) => {
    const override = byId.get(row.openingId);
    if (!override) return row;
    const next = { ...row };
    if (override.statusOverride) next.status = override.statusOverride;
    if (override.reviewStatus) next.reviewStatus = override.reviewStatus;
    if (override.action) next.action = override.action;
    if (override.notes) next.notes = override.notes;
    if (override.reviewedBy) next.reviewedBy = override.reviewedBy;
    if (override.reviewedDate) next.reviewedDate = override.reviewedDate;
    next.sourceRef = `${next.sourceRef || "Opening Schedule Check"} | Review override`;
    return next;
  });
}

async function writeCsv(outputPath, rows) {
  const headers = [
    "sourcePdf",
    "page",
    "site",
    "openingId",
    "workbookLevel",
    "workbookClearSpanMm",
    "pdfOccurrences",
    "status",
    "reviewStatus",
    "action",
    "notes",
    "sourceRef",
    "pdfClearSpanMm",
    "reviewedBy",
    "reviewedDate",
  ];
  const text = [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n") + "\r\n";
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, text, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const workbookPath = path.resolve(args.workbook || defaultWorkbook);
const extractPath = path.resolve(args.extract || defaultExtract);
const outputPath = path.resolve(args.output || defaultOutput);
const manifestPath = args.manifest ? path.resolve(args.manifest) : "";
const reviewOverridesPath = path.resolve(args["review-overrides"] || defaultReviewOverrides);

const workbookRows = await readOpeningSchedule(workbookPath);
const extractRecords = csvToRecords(await fs.readFile(extractPath, "utf8"));
const reviewOverrides = await loadReviewOverrides(reviewOverridesPath);
const rows = applyReviewOverrides(buildRows(workbookRows, extractRecords), reviewOverrides);
await writeCsv(outputPath, rows);

const summary = {
  workbook: workbookPath,
  extract: extractPath,
  output: outputPath,
  manifest: manifestPath,
  workbookOpeningCount: workbookRows.length,
  extractedRows: extractRecords.length,
  crosscheckRows: rows.length,
  unresolvedRows: rows.filter((row) => row.reviewStatus !== "Reviewed").length,
  reviewOverrides: reviewOverrides.length,
  dimensionMismatchRows: rows.filter((row) => row.status === "Dimension Mismatch").length,
};

if (manifestPath) {
  summary.sourceHashes = {
    workbook: await fileSignature(workbookPath),
    extract: await fileSignature(extractPath),
    output: await fileSignature(outputPath),
  };
}

console.log(JSON.stringify(summary));

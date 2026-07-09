import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
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
  const text = value == null ? "" : String(value);
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
  return rows.filter((candidate) => candidate.some((value) => String(value ?? "").trim() !== ""));
}

async function readCsvRecords(filePath) {
  try {
    const rows = parseCsv(await fs.readFile(filePath, "utf8"));
    if (!rows.length) return [];
    const headers = rows[0].map((header) => String(header || "").trim());
    return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function fileSignature(filePath, workspacePath) {
  try {
    const data = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);
    return {
      path: filePath,
      relativePath: path.relative(workspacePath, filePath),
      size: stat.size,
      modifiedUtc: stat.mtime.toISOString(),
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function groupCounts(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || "";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function readyRowCount(rows) {
  return Math.max(0, rows.length);
}

function taskClass(row) {
  const itemType = row.item_type || "";
  const sourceId = row.source_id || "";
  const status = row.current_status || "";
  const reason = row.reason || "";
  const combined = `${itemType} ${sourceId} ${status} ${reason}`;

  if (/Pending Measure/i.test(status) && /Floor|Alphafloor|Joist|Blocking/i.test(combined)) {
    return {
      rank: 1,
      required_fields: "floor zone area, lengthMm, widthMm, joistSpanDirection, joistSpanMm, joistSpacingMm, supportType, joistMember",
      next_action: "Extract reviewed floor-zone measurements from structural sheet S1.03 and add reviewed Floor Framing import rows.",
      owner_role: "Measurement Agent",
      source_sheet: row.source_ref || "Structural sheet S1.03 / Floor Framing",
    };
  }
  if (/Cripple|sill|head|wall ID/i.test(combined)) {
    return {
      rank: 2,
      required_fields: "openingId, wallId, sillHeightMm, headHeightMm, sourceRef, reviewStatus",
      next_action: "Populate reviewed opening measurement overrides or keep as named RFI/TBA.",
      owner_role: "Measurement Agent",
      source_sheet: row.source_ref || "Opening Schedule",
    };
  }
  if (/AS 1684|Revision control|Check AS 1684|Missing Input|Drawing register|Wind classification|Building class|Bracing source/i.test(combined)) {
    return {
      rank: 3,
      required_fields: "reviewed project assumptions, drawing register, wind classification, building class, bracing source, AS 1684 audit fields",
      next_action: row.action_or_response || "Enter reviewed admin/AS 1684 input or keep blocker open.",
      owner_role: /Revision control/i.test(combined) ? "Lead Integrator" : "Workbook QA Agent",
      source_sheet: row.source_ref || "Inputs & Assumptions / AS 1684 Check Register",
    };
  }
  if (/Engineer TBA|Large opening|Opening|LVL|steel|member/i.test(combined)) {
    return {
      rank: 4,
      required_fields: "openingId, member type, member size, bearing, connections, source drawing/detail, responseStatus, reviewStatus",
      next_action: row.action_or_response || "Confirm engineer-controlled member data before supplier-ready export.",
      owner_role: "Measurement Agent",
      source_sheet: row.source_ref || "Opening Schedule / Engineering Details Check",
    };
  }
  return {
    rank: 4,
    required_fields: "reviewed source evidence and blocker closeout action",
    next_action: row.action_or_response || "Review and close blocker before supplier-ready export.",
    owner_role: "Workbook QA Agent",
    source_sheet: row.source_ref || "",
  };
}

function tbaTask(row, index) {
  const details = taskClass(row);
  return {
    rank: details.rank,
    task_id: `T${String(index + 1).padStart(3, "0")}`,
    blocker_source: `tba_items.csv:${row.item_type || ""}:${row.source_id || ""}`,
    site: "",
    level: "",
    source_sheet: details.source_sheet,
    required_fields: details.required_fields,
    current_status: row.current_status || "",
    next_action: details.next_action,
    owner_role: details.owner_role,
    blocks_supplier_export: "Yes",
  };
}

function reviewTask(row, index) {
  const importId = row["Import ID"] || row.id || "";
  const status = row["Review Status"] || row.reviewStatus || "Needs Review";
  return {
    rank: 1,
    task_id: `R${String(index + 1).padStart(3, "0")}`,
    blocker_source: `pdf_takeoff_import_review.csv:${importId}`,
    site: row.Site || row.site || "",
    level: row.Level || row.level || "",
    source_sheet: row.Sheet || row.sheetNumber || "",
    required_fields: "reviewStatus Reviewed, source PDF/page/sheet, calibration evidence, reviewed value",
    current_status: status,
    next_action: "Review calibration/source evidence and mark as Reviewed, Rejected, or named TBA before supplier-ready export.",
    owner_role: "Measurement Agent",
    blocks_supplier_export: "Yes",
  };
}

function nonBlockingTask(id, blockerSource, sourceSheet, status, action, ownerRole) {
  return {
    rank: id === "DWG" ? 5 : 6,
    task_id: id,
    blocker_source: blockerSource,
    site: "",
    level: "",
    source_sheet: sourceSheet,
    required_fields: "",
    current_status: status,
    next_action: action,
    owner_role: ownerRole,
    blocks_supplier_export: "No",
  };
}

async function writeTaskQueue(filePath, rows) {
  const headers = [
    "task_id",
    "blocker_source",
    "site",
    "level",
    "source_sheet",
    "required_fields",
    "current_status",
    "next_action",
    "owner_role",
    "blocks_supplier_export",
  ];
  const text = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n") + "\r\n";
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

function compareSummaryFile(summary, key, currentSignature, staleReasons) {
  const recorded = summary?.files?.[key];
  if (!recorded || !currentSignature) {
    staleReasons.push(`${key} missing from summary or current filesystem`);
    return;
  }
  if (recorded.sha256 && recorded.sha256 !== currentSignature.sha256) {
    staleReasons.push(`${key} hash differs`);
  }
}

function verifierStatus(result) {
  if (!result) return "Not Run";
  return Array.isArray(result.failures) && result.failures.length ? "Failed" : "Passed";
}

function dwgStatus(workspacePath) {
  const importPath = path.join(workspacePath, "inputs", "dwg_takeoff_import.json");
  const defaultOdaPath = "C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe";
  return {
    importExists: false,
    odaConverterPath: defaultOdaPath,
    odaConverterExists: false,
    status: "DWG/DXF Verification Unavailable",
    message: "DWG/DXF verification unavailable; quantities are based on reviewed PDF/OpenTakeoff measurements.",
    importPath,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspacePath = path.resolve(args["project-workspace"] || process.cwd());
  const outputDir = path.join(workspacePath, "outputs", "implementation_verification");
  const exportDir = path.join(workspacePath, "outputs", "timber_frame_cutting_list", "exports");
  const fullWorkbookPath = path.join(workspacePath, "outputs", "timber_frame_cutting_list", "Sample_Timber_Framing_Takeoff_Cutting_List_full.xlsx");
  const measurementWorkbookPath = path.join(workspacePath, "outputs", "timber_frame_cutting_list", "Sample_Timber_Framing_Takeoff_Cutting_List_measurement.xlsx");
  const tbaPath = path.join(exportDir, "tba_items.csv");
  const taskQueuePath = path.join(outputDir, "measurement_task_queue.csv");
  const summaryPath = path.join(outputDir, "measurement_iteration_summary.json");
  const reportPath = path.join(outputDir, "cutting_list_readiness_report.md");

  const tbaRows = await readCsvRecords(tbaPath);
  const importReviewRows = await readCsvRecords(path.join(workspacePath, "outputs", "pdf_takeoff_import_review.csv"));
  const unresolvedImportReviewRows = importReviewRows.filter((row) => {
    const id = row["Import ID"] || row.id || "";
    const status = row["Review Status"] || row.reviewStatus || "";
    return id && status !== "Reviewed";
  });
  const readyCsvs = {
    lvl_order_ready: await readCsvRecords(path.join(exportDir, "lvl_order_ready.csv")),
    framing_timber_ready: await readCsvRecords(path.join(exportDir, "framing_timber_ready.csv")),
    floor_ready: await readCsvRecords(path.join(exportDir, "floor_ready.csv")),
  };
  const pdfTakeoff = await readJson(path.join(workspacePath, "inputs", "pdf_takeoff_import.json"), { measurements: [] });
  const pdfRows = Array.isArray(pdfTakeoff.measurements) ? pdfTakeoff.measurements : [];
  const reviewedPdfRows = pdfRows.filter((row) => row.reviewStatus === "Reviewed");
  const wallRows = reviewedPdfRows.filter((row) => row.targetWorkbookSheet === "Wall Measurements" && row.measurementType === "linear");
  const externalLm = wallRows.filter((row) => row.tradeComponent === "External Wall").reduce((sum, row) => sum + Number(row.valueM || row.value || 0), 0);
  const internalLm = wallRows.filter((row) => row.tradeComponent === "Internal Wall").reduce((sum, row) => sum + Number(row.valueM || row.value || 0), 0);

  const fullVerifier = await readJson(path.resolve(args["full-verifier"] || path.join(outputDir, "full_verifier.json")), null);
  const measurementVerifier = await readJson(path.resolve(args["measurement-verifier"] || path.join(outputDir, "measurement_verifier.json")), null);
  const pipelineSummaryPath = path.join(workspacePath, "outputs", "pdf_plan_index", "pipeline_run_summary.json");
  const pipelineSummary = await readJson(pipelineSummaryPath, null);
  const currentSignatures = {
    fullWorkbook: await fileSignature(fullWorkbookPath, workspacePath),
    measurementWorkbook: await fileSignature(measurementWorkbookPath, workspacePath),
    crosscheckCsv: await fileSignature(path.join(workspacePath, "outputs", "opening_schedule_crosscheck.csv"), workspacePath),
    manifest: await fileSignature(path.join(workspacePath, "outputs", "pdf_plan_index", "opening_schedule_crosscheck_manifest.json"), workspacePath),
    tbaCsv: await fileSignature(tbaPath, workspacePath),
  };

  const staleReasons = [];
  if (!pipelineSummary) {
    staleReasons.push("pipeline_run_summary.json missing");
  } else {
    compareSummaryFile(pipelineSummary, "fullWorkbook", currentSignatures.fullWorkbook, staleReasons);
    compareSummaryFile(pipelineSummary, "measurementWorkbook", currentSignatures.measurementWorkbook, staleReasons);
    compareSummaryFile(pipelineSummary, "crosscheckCsv", currentSignatures.crosscheckCsv, staleReasons);
    compareSummaryFile(pipelineSummary, "manifest", currentSignatures.manifest, staleReasons);
    compareSummaryFile(pipelineSummary, "tbaCsv", currentSignatures.tbaCsv, staleReasons);
  }

  const dwg = dwgStatus(workspacePath);
  try {
    await fs.access(dwg.importPath);
    dwg.importExists = true;
    dwg.status = "DWG/DXF Import Present";
    dwg.message = "DWG/DXF import exists; review manifest and mismatch report before relying on secondary verification.";
  } catch {
    // Keep unavailable status.
  }
  try {
    await fs.access(dwg.odaConverterPath);
    dwg.odaConverterExists = true;
  } catch {
    // Keep false.
  }

  const diagramManifest = await readJson(path.join(workspacePath, "outputs", "wall_frame_fabrication_sequence", "manifest.json"), null);
  const diagramStatus = diagramManifest?.status || diagramManifest?.drawingStatus || "interim-example";

  const tasks = [
    ...unresolvedImportReviewRows.map(reviewTask),
    ...tbaRows.map(tbaTask),
  ];
  tasks.push(nonBlockingTask("DWG", "DWG/DXF status", "DWG takeoff pipeline", dwg.status, dwg.message, "DWG/DXF Agent"));
  tasks.push(nonBlockingTask("DIAGRAM", "Diagram status", "Wall-frame fabrication sequence", diagramStatus, "Keep diagrams downstream until measurement quantities and TBA status stabilize.", "Diagram QA Agent"));
  tasks.sort((a, b) => a.rank - b.rank || a.task_id.localeCompare(b.task_id));
  await writeTaskQueue(taskQueuePath, tasks);

  const floorPendingTasks = tasks.filter((row) => row.rank === 1 && row.current_status === "Pending Measure");
  const summary = {
    kind: "measurement-iteration-summary",
    generatedAtUtc: new Date().toISOString(),
    workbooks: {
      full: currentSignatures.fullWorkbook,
      measurement: currentSignatures.measurementWorkbook,
    },
    verifiers: {
      full: verifierStatus(fullVerifier),
      measurement: verifierStatus(measurementVerifier),
      fullFailures: fullVerifier?.failures || [],
      measurementFailures: measurementVerifier?.failures || [],
    },
    tba: {
      totalRows: tbaRows.length,
      byStatus: groupCounts(tbaRows, (row) => row.current_status),
      byClass: groupCounts(tbaRows, (row) => `${row.item_type}, ${row.current_status}`),
    },
    readyCsvRows: {
      lvl_order_ready: readyRowCount(readyCsvs.lvl_order_ready),
      framing_timber_ready: readyRowCount(readyCsvs.framing_timber_ready),
      floor_ready: readyRowCount(readyCsvs.floor_ready),
    },
    pdfOpenTakeoff: {
      totalRows: pdfRows.length,
      reviewedRows: reviewedPdfRows.length,
      unresolvedRows: pdfRows.length - reviewedPdfRows.length,
      reviewCsvRows: importReviewRows.length,
      unresolvedReviewCsvRows: unresolvedImportReviewRows.length,
      reviewedWallExternalLm: Number(externalLm.toFixed(3)),
      reviewedWallInternalLm: Number(internalLm.toFixed(3)),
      reviewedWallTotalLm: Number((externalLm + internalLm).toFixed(3)),
    },
    dwg,
    pipelineSummary: {
      path: pipelineSummaryPath,
      status: staleReasons.length ? "Stale" : "Current",
      staleReasons,
      generatedAtUtc: pipelineSummary?.generatedAtUtc || "",
    },
    taskQueue: {
      path: taskQueuePath,
      totalRows: tasks.length,
      blockingRows: tasks.filter((row) => row.blocks_supplier_export === "Yes").length,
      floorPendingMeasureTasks: floorPendingTasks.length,
    },
    diagrams: {
      status: diagramStatus,
      manifest: diagramManifest ? path.join(workspacePath, "outputs", "wall_frame_fabrication_sequence", "manifest.json") : "",
    },
    readinessReport: reportPath,
  };

  const report = [
    "# Cutting List Readiness Report",
    "",
    `Generated: ${summary.generatedAtUtc}`,
    "",
    "## Workbook Verification",
    "",
    `- Full workbook verifier: ${summary.verifiers.full}`,
    `- Measurement workbook verifier: ${summary.verifiers.measurement}`,
    `- Pipeline summary status: ${summary.pipelineSummary.status}${staleReasons.length ? ` (${staleReasons.join("; ")})` : ""}`,
    "",
    "## TBA And Export Status",
    "",
    `- TBA blockers: ${summary.tba.totalRows}`,
    `- Ready LVL CSV rows: ${summary.readyCsvRows.lvl_order_ready}`,
    `- Ready framing timber CSV rows: ${summary.readyCsvRows.framing_timber_ready}`,
    `- Ready floor CSV rows: ${summary.readyCsvRows.floor_ready}`,
    "",
    "TBA breakdown:",
    "",
    ...Object.entries(summary.tba.byClass).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Measurement Status",
    "",
    `- PDF/OpenTakeoff import rows: ${summary.pdfOpenTakeoff.totalRows}`,
    `- Reviewed rows: ${summary.pdfOpenTakeoff.reviewedRows}`,
    `- PDF import review CSV rows: ${summary.pdfOpenTakeoff.reviewCsvRows}`,
    `- Unresolved review CSV rows: ${summary.pdfOpenTakeoff.unresolvedReviewCsvRows}`,
    `- Reviewed wall totals: ${summary.pdfOpenTakeoff.reviewedWallExternalLm} LM external, ${summary.pdfOpenTakeoff.reviewedWallInternalLm} LM internal, ${summary.pdfOpenTakeoff.reviewedWallTotalLm} LM total`,
    `- Top-priority floor Pending Measure tasks: ${summary.taskQueue.floorPendingMeasureTasks}`,
    "",
    "## DWG/DXF Status",
    "",
    `- ${summary.dwg.message}`,
    "",
    "## Diagram Status",
    "",
    `- Diagram status: ${summary.diagrams.status}`,
    "- Diagrams remain downstream/interim until measurements, TBA status, and source manifests stabilize.",
    "",
    "## Next Queue",
    "",
    `- Measurement task queue: ${path.relative(workspacePath, taskQueuePath)}`,
    "",
  ].join("\r\n");

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(reportPath, report, "utf8");
  console.log(JSON.stringify({ summary: summaryPath, taskQueue: taskQueuePath, report: reportPath }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

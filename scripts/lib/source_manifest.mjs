import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function fileSignature(filePath) {
  const resolved = path.resolve(filePath);
  const [buffer, stats] = await Promise.all([
    fs.readFile(resolved),
    fs.stat(resolved),
  ]);
  return {
    path: resolved,
    size: stats.size,
    modifiedUtc: stats.mtime.toISOString(),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function readJsonWithoutBom(filePath) {
  const text = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function blankFileCheck(label, entry = {}) {
  return {
    label,
    path: entry?.path || "",
    relativePath: entry?.relativePath || "",
    size: entry?.size ?? "",
    modifiedUtc: entry?.modifiedUtc || "",
    manifestSha256: entry?.sha256 || "",
    currentSha256: "",
    status: "Missing",
    notes: "",
  };
}

async function validateFileEntries(entries, issues) {
  const fileChecks = [];
  for (const [label, entry] of entries) {
    const check = blankFileCheck(label, entry);
    if (!entry?.path || !entry?.sha256) {
      check.status = "Manifest Missing";
      check.notes = `Manifest missing ${label} path or hash.`;
      issues.push(check.notes);
      fileChecks.push(check);
      continue;
    }
    try {
      const current = await fileSignature(entry.path);
      check.currentSha256 = current.sha256;
      check.status = current.sha256 === String(entry.sha256).toLowerCase() ? "Current" : "Hash mismatch";
      check.notes = check.status === "Current" ? "Manifest hash matches current file." : `${label} hash differs from manifest.`;
      if (check.status !== "Current") issues.push(check.notes);
    } catch (error) {
      check.status = "Missing";
      check.notes = `${label} file cannot be read: ${error.message}`;
      issues.push(check.notes);
    }
    fileChecks.push(check);
  }
  return fileChecks;
}

function sourceCheckResult({ issues, fileChecks, manifest, manifestPath, okResult, okNotes, staleAction }) {
  return {
    issueCount: issues.length,
    status: issues.length ? "Stale Source" : "OK",
    result: issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : okResult,
    action: issues.length ? staleAction : "No action required.",
    notes: issues.length ? issues.join(" ") : okNotes,
    sourceRef: manifestPath,
    issues,
    manifest,
    fileChecks,
  };
}

export async function validateOpeningScheduleManifest(crosscheckPath, manifestPath) {
  const crosscheckExists = await fileExists(crosscheckPath);
  if (!crosscheckExists) {
    return {
      issueCount: 0,
      status: "OK",
      result: "No cross-check CSV",
      action: "Run PDF schedule pipeline when schedule checking is required.",
      notes: "No opening schedule cross-check CSV is present.",
      sourceRef: "Not run",
      issues: [],
      manifest: null,
      fileChecks: [],
    };
  }

  const issues = [];
  const fileChecks = [];
  let manifest = null;
  if (!(await fileExists(manifestPath))) {
    issues.push("Cross-check CSV exists but manifest is missing.");
  } else {
    try {
      manifest = await readJsonWithoutBom(manifestPath);
    } catch (error) {
      issues.push(`Manifest is not valid JSON: ${error.message}`);
    }
  }

  if (manifest) {
    const entries = [
      ["architecturalPdf", manifest.files?.architecturalPdf],
      ["extractCsv", manifest.files?.extractCsv],
      ["workbook", manifest.files?.workbook],
      ["crosscheckCsv", manifest.files?.crosscheckCsv],
    ];
    fileChecks.push(...await validateFileEntries(entries, issues));

    const manifestCrosscheckPath = manifest.files?.crosscheckCsv?.path ? path.resolve(manifest.files.crosscheckCsv.path) : "";
    if (manifestCrosscheckPath && manifestCrosscheckPath !== path.resolve(crosscheckPath)) {
      issues.push("Manifest cross-check CSV path differs from active cross-check path.");
    }
  }

  return sourceCheckResult({
    issues,
    fileChecks,
    manifest,
    manifestPath,
    okResult: "Current",
    okNotes: "Manifest and source hashes match.",
    staleAction: "Run scripts/run_pdf_schedule_pipeline.ps1 before ordering.",
  });
}

export async function validateDwgTakeoffManifest(importPath, manifestPath) {
  const importExists = await fileExists(importPath);
  if (!importExists) {
    return {
      issueCount: 0,
      status: "OK",
      result: "No DWG takeoff import",
      action: "Run DWG takeoff pipeline when CAD-derived measurements are required.",
      notes: "No DWG takeoff import JSON is present.",
      sourceRef: "Not run",
      issues: [],
      manifest: null,
      fileChecks: [],
    };
  }

  const issues = [];
  const fileChecks = [];
  let manifest = null;
  if (!(await fileExists(manifestPath))) {
    issues.push("DWG takeoff import exists but manifest is missing.");
  } else {
    try {
      manifest = await readJsonWithoutBom(manifestPath);
    } catch (error) {
      issues.push(`DWG manifest is not valid JSON: ${error.message}`);
    }
  }

  if (manifest) {
    const files = manifest.files || {};
    const entries = [
      ...(Array.isArray(files.dwgFiles) ? files.dwgFiles.map((entry, index) => [`dwgFiles[${index}]`, entry]) : []),
      ...(Array.isArray(files.dxfFiles) ? files.dxfFiles.map((entry, index) => [`dxfFiles[${index}]`, entry]) : []),
      ["mapping", files.mapping],
      ["reviewOverrides", files.reviewOverrides],
      ["importJson", files.importJson],
      ["reviewCsv", files.reviewCsv],
      ["layerSummary", files.layerSummary],
      ["entityInventory", files.entityInventory],
      ["extractorSummary", files.extractorSummary],
    ].filter(([, entry]) => entry);
    fileChecks.push(...await validateFileEntries(entries, issues));

    const manifestImportPath = files.importJson?.path ? path.resolve(files.importJson.path) : "";
    if (!manifestImportPath) {
      issues.push("DWG manifest is missing importJson path.");
    } else if (manifestImportPath !== path.resolve(importPath)) {
      issues.push("DWG manifest import JSON path differs from active DWG import path.");
    }
  }

  return sourceCheckResult({
    issues,
    fileChecks,
    manifest,
    manifestPath,
    okResult: "Current",
    okNotes: "DWG manifest and source hashes match.",
    staleAction: "Run scripts/run_dwg_takeoff_pipeline.ps1 before ordering.",
  });
}

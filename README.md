# Timber Frame Cutting List Public Showcase

This repository is a sanitized GitHub Pages showcase for a timber-frame takeoff and cutting-list workflow for Australian residential construction.

It explains the workflow, outputs, quality checks, and privacy boundary without publishing real project plans, DWG/PDF source files, generated Excel workbooks, supplier exports, production scripts, or private git history.

## What It Does

The private project supports a site-ready framing workbook workflow:

- staged PDF and DWG takeoff imports;
- wall measurement schedules;
- wall-linked opening schedules;
- LVL lintel cut calculations with bearing allowance;
- stud, plate, noggin, bracing, floor, and sheet-material takeoffs;
- AS 1684 and engineering review registers;
- source manifests for imported plan data;
- supplier CSV exports and unresolved TBA tracking;
- workbook verification before handoff.

This public repo contains only a static showcase page, public documentation, and synthetic diagrams.

## Who It Is For

- residential estimators and carpentry teams;
- builders preparing timber framing orders;
- engineers and consultants reviewing TBA items;
- automation builders interested in auditable Excel workflows.

## Why It Exists

Framing takeoff work benefits from repeatable calculations, source traceability, and clear review status. This showcase demonstrates the public shape of a workflow where imports remain staged until reviewed, workbook outputs expose unresolved blockers, and supplier exports are separated from TBA lines.

## Workflow

1. Capture project assumptions and drawing revision details.
2. Stage PDF/DWG takeoff rows with source references and review status.
3. Link openings to wall IDs and calculate lintel, cripple-stud, and review flags.
4. Generate workbook sheets for quantities, optimizer rows, QA checks, and supplier exports.
5. Validate source manifests, formulas, AS 1684 audit fields, and unresolved TBA items.
6. Hand off a private workbook and exports only after review.

## Privacy Boundary

This public showcase deliberately excludes:

- real site addresses, client details, drawing files, photos, PDFs, DWG/DXF files, ZIP files, and Excel workbooks;
- production builder scripts, generated outputs, preview images, logs, and supplier CSV exports;
- `.env` files, credentials, API keys, service details, and deployment configuration;
- private monorepo history or internal workspace paths.

## Current Status

Public showcase only. The operational implementation and project records remain private.

See:

- [Architecture](docs/architecture.md)
- [Demo Scenario](docs/demo-scenario.md)
- [Security](SECURITY.md)


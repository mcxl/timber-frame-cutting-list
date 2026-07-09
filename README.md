# Cut on Site Wall and Roof Framing Material and Build List Public Showcase

This repository is a sanitized GitHub Pages showcase for a cut-on-site wall and conventional pitched roof framing material and build-list workflow for Australian residential construction.

It explains the workflow, outputs, quality checks, and privacy boundary without publishing real project plans, DWG/PDF source files, generated Excel workbooks, supplier exports, production scripts, or private git history.

## What It Does

The private project supports a site-ready framing workbook workflow:

- staged PDF and DWG takeoff imports;
- wall measurement schedules;
- wall-linked opening schedules;
- individual wall-frame identification, breakdown, and labelling;
- synthetic wall-frame sketches and sequence diagrams;
- construction sequencing for cutting, assembling, standing, plumbing, bracing, and checking wall frames;
- conventional pitched roof framing material schedules;
- rafter, ridge, hip, valley, collar tie, ceiling joist, strut, hanging beam, and roof-batten review items;
- LVL lintel cut calculations with bearing allowance;
- stud, plate, noggin, bracing, floor, and sheet-material takeoffs;
- AS 1684 and engineering review registers;
- source manifests for imported plan data;
- supplier CSV exports and unresolved TBA tracking;
- workbook verification before handoff.

This public repo contains only a static showcase page, public documentation, and synthetic diagrams.

## Who It Is For

- residential estimators and carpentry teams;
- builders preparing wall and roof framing material orders;
- engineers and consultants reviewing TBA items;
- automation builders interested in auditable Excel workflows.

## Why It Exists

Framing takeoff work benefits from repeatable calculations, source traceability, and clear review status. This showcase demonstrates the public shape of a workflow where wall and conventional pitched roof framing inputs remain staged until reviewed, workbook outputs expose unresolved blockers, and supplier exports are separated from TBA lines.

## Workflow

1. Capture project assumptions and drawing revision details.
2. Stage PDF/DWG takeoff rows with source references and review status.
3. Identify each wall frame by level, area, wall ID, wall type, source reference, and review state.
4. Break wall frames down into plates, studs, noggins, lintels, trimmers, jamb studs, sill/support members, bracing panels, hold-downs, and opening-related members.
5. Produce labelled frame sketches and construction-sequence diagrams for individual wall frames.
6. Link openings to wall IDs and calculate lintel, cripple-stud, and review flags.
7. Stage conventional pitched roof details such as spans, pitch, overhangs, ridge/hip/valley members, rafter spacing, battens, tie-downs, and engineer TBA items.
8. Generate workbook sheets for quantities, optimizer rows, QA checks, and supplier exports.
9. Validate source manifests, formulas, AS 1684 audit fields, roof-detail review fields, and unresolved TBA items.
10. Hand off a private workbook and exports only after review.

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
- [Wall Frame Breakdown And Sequencing](docs/wall-frame-breakdown-and-sequencing.md)
- [Security](SECURITY.md)

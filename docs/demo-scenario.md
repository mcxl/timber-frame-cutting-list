# Demo Scenario

This scenario is synthetic. It does not describe a real project, client, site, drawing package, supplier order, or issued workbook.

## Scenario

A fictional estimator is preparing a timber framing takeoff for a sample two-storey residential build in NSW. The estimator wants a draft workbook that shows reviewed measurements, unresolved source checks, LVL lintel cuts, and supplier-ready lines.

## Synthetic Inputs

| Field | Demo Value |
| --- | --- |
| Project | Sample Duplex Framing Package |
| Location | Demo Site, NSW |
| Workbook status | Draft |
| Stock profile | LVL 6000 |
| Bearing allowance | 150 mm each end |
| External stud spacing | 450 mm |
| Internal stud spacing | 600 mm |
| Source review state | Mixed reviewed and needs-review rows |

## Demo Workflow

1. The estimator records project assumptions and drawing revision fields.
2. PDF/DWG imports are staged with source references.
3. Reviewed rows flow into wall, bracing, and floor calculations.
4. Unreviewed rows remain in staging and create order blockers.
5. Opening schedule rows are linked to wall IDs where available.
6. The workbook builder calculates lintels, studs, plates, noggins, sheets, floor items, QA checks, and export lines.
7. Verification flags unresolved TBA items before private handoff.

## Expected Private Outputs

In the private workflow, this kind of run may produce:

- timber framing workbook;
- LVL and framing timber exports;
- floor export;
- TBA export;
- source manifests;
- QA verification result.

Those production files are not included in this public showcase.


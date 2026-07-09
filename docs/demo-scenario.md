# Demo Scenario

This scenario is synthetic. It does not describe a real project, client, site, drawing package, supplier order, or issued workbook.

## Scenario

A fictional estimator is preparing a cut-on-site wall and conventional pitched roof framing material list for a sample two-storey residential build in NSW. The estimator wants a draft workbook that shows reviewed measurements, unresolved source checks, LVL lintel cuts, roof framing TBA items, and supplier-ready lines.

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
| Roof type | Conventional pitched roof |
| Roof framing scope | Common rafters, ridge, hips, valleys, ceiling joists, battens, bracing, tie-down review |
| Source review state | Mixed reviewed and needs-review rows |

## Demo Workflow

1. The estimator records project assumptions and drawing revision fields.
2. PDF/DWG imports are staged with source references.
3. Reviewed rows flow into wall, bracing, and floor calculations.
4. Unreviewed rows remain in staging and create order blockers.
5. Individual wall frames are identified by level, wall ID, wall type, source reference, and review state.
6. Each wall frame is broken down into plates, studs, noggins, lintels, trimmers, jamb studs, sill/support members, bracing panels, hold-downs, and opening-related members.
7. Labelled frame sketches show member groups and opening relationships.
8. A construction sequence shows cut list preparation, plate marking, frame assembly, squaring, sheathing/bracing checks, standing, plumbing, temporary bracing, and QA hold points.
9. Opening schedule rows are linked to wall IDs where available.
10. Conventional pitched roof rows are staged for pitch, span, spacing, ridge/hip/valley member, overhang, tie-down, bracing, and engineer-review status.
11. The workbook builder calculates lintels, studs, plates, noggins, sheets, floor items, roof framing material items, QA checks, and export lines.
12. Verification flags unresolved TBA items before private handoff.

## Expected Private Outputs

In the private workflow, this kind of run may produce:

- wall and roof framing material workbook;
- wall-frame breakdown and label schedule;
- individual wall-frame sketch set;
- wall-frame construction sequence sheet;
- LVL and framing timber exports;
- conventional pitched roof framing material schedule;
- floor export;
- TBA export;
- source manifests;
- QA verification result.

Those production files are not included in this public showcase.

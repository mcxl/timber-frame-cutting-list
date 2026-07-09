# Architecture

This document describes the public architecture of the cut-on-site wall and conventional pitched roof framing material and build-list workflow. The repository now includes sanitized source code, while still omitting site data, source plans, generated workbooks, supplier exports, and internal paths.

## System Boundary

The private workflow treats measurement imports as staged evidence:

- PDF and DWG takeoff data can be normalized into import records;
- import records are not trusted until reviewed;
- each wall frame can be identified, labelled, decomposed into member groups, and sequenced for construction;
- conventional pitched roof details can be staged for review before order quantities are treated as ready;
- source manifests record file hashes, tools, and run metadata;
- workbook sheets calculate quantities and expose blockers;
- supplier exports separate ready lines from TBA lines;
- verification checks formulas, review status, manifests, and output readiness.

## Workflow Diagram

```mermaid
flowchart LR
  A["Project assumptions"] --> B["PDF/DWG staging"]
  B --> C["Human review status"]
  C --> D["Workbook builder"]
  D --> E["Quantity and optimizer sheets"]
  E --> F["QA and manifest checks"]
  F --> G["Private workbook and exports"]
```

## Main Components

| Component | Role | Public Repo Status |
| --- | --- | --- |
| Project assumptions | Captures stock length, bearing allowance, spacing, waste, and drawing revision fields | Sanitized examples included |
| PDF/DWG imports | Stage measured wall, bracing, and floor-area rows with source references | Schemas and converter scripts included |
| Wall-frame breakdown | Identifies each wall frame, labels member groups, and separates plate, stud, lintel, opening, bracing, hold-down, and TBA items | Builder code included |
| Wall-frame sketches | Provides synthetic diagrams for individual wall frames and construction sequence views | Included as showcase diagrams |
| Opening schedule | Links openings to wall IDs and lintel calculations | Extraction and cross-check scripts included |
| Conventional pitched roof schedule | Stages rafters, ridge, hips, valleys, ceiling joists, battens, bracing, tie-downs, and engineer-review items | Builder code included |
| Workbook builder | Generates Excel sheets and formulas | Sanitized source included under `workbook/` |
| Source manifests | Track hashes and source freshness for imports | Helper code included |
| Verification checks | Confirm formulas, review status, manifests, exports, and TBA blockers | Verification code included |
| Supplier exports | Split ready lines and unresolved TBA items | Excluded |

## Output Model

The private workbook can include:

- Inputs and assumptions;
- PDF/DWG takeoff staging;
- wall measurements;
- individual wall-frame breakdown and labelling;
- wall-frame sketch and construction-sequence references;
- opening schedule and opening schedule check;
- conventional pitched roof framing schedule;
- LVL cutting optimizer;
- bulk framing takeoff;
- roof framing material takeoff;
- floor framing;
- engineering details check;
- AS 1684 check register;
- source manifest;
- order summary;
- engineer RFI;
- supplier export tabs;
- QA checks.

## Design Principles

- Reviewed import rows can affect quantities; unreviewed rows remain blockers.
- Each wall frame must retain its source reference, wall ID, label set, review status, and unresolved TBA items.
- Frame sketches are explanatory aids, not certified shop drawings.
- Construction sequencing is a planning aid for cut, assembly, stand, brace, and check steps.
- Lintel cuts include clear span plus total bearing allowance.
- Conventional pitched roof quantities stay review-gated where pitch, bearing, birdsmouth/notching, overhangs, tie-downs, bracing, or engineering details are unresolved.
- Over-stock and missing-span items remain visible as TBA or special order.
- AS 1684 checks require audit completion fields, not formula-only pass states.
- Source manifests must stay fresh when imported data is used.
- Real project records never belong in the public showcase.

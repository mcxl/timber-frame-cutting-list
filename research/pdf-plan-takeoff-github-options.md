# PDF Plan Quantity Takeoff GitHub Research

Date: 2026-07-08

Project context: Sample Duplex timber framing workflow. The target is not a general estimating platform. The target is a practical, auditable workflow that can extract or measure quantities from PDF plans and pass reviewed values into the timber framing takeoff and cutting-list workbook.

## Executive Recommendation

Use a hybrid workflow:

1. Adopt or fork `Kentucky-ai/opentakeoff` as the primary calibrated PDF takeoff layer.
2. Add a normalized export bridge from OpenTakeoff CSV/JSON into the timber workbook input schema.
3. Use `pdfplumber` as the first backend extraction component for text, dimensions, vector lines, and schedule-page discovery.
4. Add OCR only as a fallback for scanned or flattened PDFs, with `PaddleOCR` or `Surya` preferred over non-commercial blueprint-specific repos.
5. Treat AI/object-detection repos as research references or optional future modules, not as the base workflow.

Reason: OpenTakeoff is the only candidate found that is directly aligned with calibrated PDF takeoff, has local browser operation, supports area/linear/count/deduct tools, exports CSV/JSON, and has a clean Apache-2.0 license. Most AI blueprint repos are either non-commercial, immature, narrow to object detection, or too complex to embed.

## Recommended Architecture

```text
PDF plan set
  -> sheet index and metadata extraction
  -> calibrated takeoff UI for reviewed line/area/count measurements
  -> optional text/schedule extraction assist
  -> reviewed quantity schema
  -> timber workbook inputs
  -> takeoff, order summary, cutting optimizer, TBA/RFI register
```

Minimum normalized measurement schema:

```json
{
  "project": "Sample Duplex",
  "drawing_file": "Architectural Plans.pdf",
  "sheet": "A11",
  "page": 11,
  "scale": "1:50",
  "measurement_type": "linear",
  "trade_component": "External Wall",
  "site": "A",
  "level": "Ground",
  "wall_id": "A-GF-W01",
  "value_mm": 12450,
  "source": "calibrated_manual_takeoff",
  "review_status": "reviewed",
  "confidence": 1.0,
  "notes": ""
}
```

## Local PDF Probe: Sample Plan Files

Files found in the workspace:

- `Structural Plans.pdf`
- `sample-architectural-plans.pdf`

Lightweight `pdfplumber` probe results:

| File | Pages | Finding |
|---|---:|---|
| Structural Plans.pdf | 4 | Text extractable; high vector-object count; AS1684 and F7 references found on pages 3 and 4. |
| Architectural Plans...LATEST.pdf | 13 | Text extractable; window/door schedule keywords found mainly on pages 11 and 12. |

Relevant keyword hits:

| File | Strong Relevant Pages |
|---|---|
| Structural Plans.pdf | Pages 3 and 4: `F7`, `AS1684`, `WALL` |
| Architectural Plans...LATEST.pdf | Pages 11 and 12: `WINDOW`, `DOOR`, `SCHEDULE`; pages 7 and 8 also contain window references |

Important finding: default `pdfplumber.extract_tables()` detected graphical tables on architectural pages 11 and 12, but did not extract useful populated cells without tuned cropping/settings. This means schedule extraction should be guided and reviewable. It should not block the first implementation.

## Candidate Repo Matrix

| Repo | Role | License Position | Fit | Recommendation |
|---|---|---|---:|---|
| `Kentucky-ai/opentakeoff` | Calibrated PDF takeoff UI | Apache-2.0 detected and confirmed in README/package | 5/5 | Primary candidate to fork or integrate |
| `jsvine/pdfplumber` | PDF text, object, line, table extraction | MIT | 5/5 | Use as extraction component |
| `PaddlePaddle/PaddleOCR` | OCR and document parsing fallback | Apache-2.0 | 4/5 | Use for scanned/flattened sheets after pilot |
| `VikParuchuri/surya` | OCR/layout/table recognition fallback | Apache-2.0 | 4/5 | Test against PaddleOCR in OCR bake-off |
| `ilirkl/protakeoff-public` | Desktop takeoff/estimating app | README says MIT, but no standard license file detected by GitHub API | 3/5 | Legal/setup review before use |
| `datadrivenconstruction/OpenConstructionERP` | Full construction ERP with PDF/CAD/BIM takeoff | AGPL-3.0-or-later with commercial option | 3/5 | Reference or standalone platform, not embed |
| `goodmorningcoffee/BlueprintParser_OS` | AI blueprint parsing, schedule extraction, auto-QTO ideas | Non-commercial source-available | 2/5 | Architecture reference only unless licensed |
| `jasoncobra3/Floorplan-Dimractor` | Dimension text extraction prototype | No standard license file detected | 2/5 | Reference implementation only |
| `anngrrr/planparser` | Object detection for floor plans | Non-commercial license | 1/5 | Research reference only |
| `sanatladkat/floor-plan-object-detection` | Floor-plan object detection/counting | MIT project, but YOLO dependency licensing still needs review | 2/5 | Optional count-detection experiment |
| `pymupdf/PyMuPDF` | Fast PDF rendering/extraction/OCR/annotation | AGPL-3.0 or commercial license | 3/5 | Use only with license strategy |

## Top Candidate: OpenTakeoff

Repository: https://github.com/Kentucky-ai/opentakeoff

Why it is the best first option:

- Directly targets PDF/image plan takeoff.
- Runs locally in the browser; no upload required.
- Supports PDF, images, and zip plan sets.
- Supports scale detection or manual calibration per sheet.
- Supports area, rectangle, linear, surface-area, count, and deduct tools.
- Exports CSV and JSON.
- Can export marked-up PDF sets.
- Uses React/Vite/pdf.js/pdf-lib with a small codebase.
- Has explicit `typecheck`, `test`, and `build` scripts.
- Has geometry/totals tests.
- Apache-2.0 license is suitable for adaptation.

Gaps to close for timber framing:

- Add a timber-specific condition/template set: external wall LM, internal wall LM, bracing panel LM, floor zone area, joist span zone, opening count/check.
- Add wall IDs and drawing references to each measurement.
- Add export mapping into workbook input tables.
- Add mandatory review status before export.
- Add drawing revision tracking.
- Add AS/NZS 1684 and engineer-detail cross-check references as metadata, not automated compliance decisions.

## Repos Not Recommended As The Base

`BlueprintParser_OS`

- Strong ideas: schedule parsing, OCR, YOLO spatial zones, auto-QTO workflow, LLM context compression.
- Blocker: non-commercial source-available license.
- Practical issue: heavier app stack with database, auth, optional AWS/Textract/SageMaker.
- Use as design reference, not direct dependency.

`planparser`

- Strong ideas: YOLO/Faster R-CNN object detection and CSV output.
- Blocker: explicit non-commercial license.
- Practical issue: image object detection is useful for symbols/counts, not calibrated timber wall lengths.

`OpenConstructionERP`

- Strong ideas: BOQ, PDF/CAD/BIM takeoff, API, regional estimating platform.
- Blocker: AGPL/commercial licensing for embedded/proprietary use.
- Practical issue: too broad for a lightweight workbook-connected workflow.

`ProTakeoff`

- Strong ideas: desktop takeoff/estimating, Excel export, local database.
- Blocker: GitHub API did not detect a standard license file despite README MIT badge.
- Practical issue: setup mentions Convex environment and release links point to a different repo.

## Proposed Prototype Bake-Off

Use the two local sample PDFs as the initial test set.

Phase 1: OpenTakeoff manual/calibrated takeoff

- Load architectural PDF.
- Calibrate at least one known dimension.
- Measure external wall LM, internal wall LM, bracing panel LM, floor zone areas, and opening counts.
- Export CSV/JSON.
- Check whether exported quantities can be transformed into workbook inputs without manual retyping.

Phase 2: pdfplumber extraction assist

- Generate sheet index: page number, likely drawing title, scale text, revision/date where available.
- Find pages containing `WINDOW`, `DOOR`, `SCHEDULE`, `AS1684`, `F7`, `LVL`, `BRACING`, `ALPHAFLOOR`.
- Extract text and object coordinates for likely schedule regions.
- Test guided crop/table settings for architectural pages 11 and 12.
- Output a review CSV for window/door schedule extraction.

Phase 3: OCR fallback

- Rasterize one vector page and one scanned/flattened equivalent if available.
- Test PaddleOCR and Surya on schedule and notes regions.
- Compare output quality, install burden, speed, and table structure.

Phase 4: Optional object-count experiment

- Test object detection only after the manual/export workflow works.
- Restrict targets to repeated symbols and openings.
- Require human review before quantities enter the workbook.

## Integration Plan Into Existing Skill

Add a new workflow skill or extend the timber skill with a PDF intake mode:

```text
pdf-plan-takeoff-intake
  inputs:
    - architectural_pdf
    - structural_pdf
    - calibration_measurements
    - drawing_revision_status
  outputs:
    - sheet_index.csv
    - measurement_review.csv
    - opening_schedule_review.csv
    - engineer_notes_review.csv
    - workbook_import.json
```

Recommended gating rules:

- No workbook-ready export unless each line has a drawing file, page, sheet ID, scale/calibration source, and review status.
- No AS/NZS 1684 item should be marked compliant by automation. The tool should only flag whether the relevant standard/detail check has been entered and reviewed.
- No engineered member should be order-ready unless the engineer detail/source reference is recorded.
- Any automated OCR/object-detection result should default to `Needs Review`.

## Decision

Proceed first with OpenTakeoff plus a workbook export bridge. In parallel, implement a small `pdfplumber` extraction-assist script for page indexing, keyword discovery, and schedule-region extraction. Defer AI object detection until the calibrated/manual workflow is producing auditable quantities.

This gives the highest chance of useful near-term production output while leaving a clean path to add automation later.

## Source URLs

- OpenTakeoff: https://github.com/Kentucky-ai/opentakeoff
- ProTakeoff Public: https://github.com/ilirkl/protakeoff-public
- OpenConstructionERP: https://github.com/datadrivenconstruction/OpenConstructionERP
- BlueprintParser_OS: https://github.com/goodmorningcoffee/BlueprintParser_OS
- Floorplan-Dimractor: https://github.com/jasoncobra3/Floorplan-Dimractor
- planparser: https://github.com/anngrrr/planparser
- floor-plan-object-detection: https://github.com/sanatladkat/floor-plan-object-detection
- pdfplumber: https://github.com/jsvine/pdfplumber
- PyMuPDF: https://github.com/pymupdf/PyMuPDF
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
- Surya: https://github.com/VikParuchuri/surya

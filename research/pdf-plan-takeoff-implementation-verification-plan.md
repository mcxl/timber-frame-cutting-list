# PDF Plan Takeoff Implementation And Verification Plan

Date: 2026-07-08

Purpose: take the GitHub research result into a working prototype that extracts reviewed quantities from PDF plans and feeds the timber framing takeoff/cutting-list workbook.

Primary direction:

- Use `Kentucky-ai/opentakeoff` as the calibrated measurement layer.
- Use `pdfplumber` as the first PDF extraction-assist layer.
- Keep the timber workbook as the quantity/order/cutting-list authority.
- Treat automation as assistive until each measurement is reviewed.

## Target Workflow

```text
Architectural / structural PDF plans
  -> PDF sheet index and keyword scan
  -> calibrated takeoff measurements
  -> reviewed measurement export
  -> workbook import bridge
  -> timber takeoff workbook
  -> QA / AS1684 / engineering / TBA gates
  -> supplier-ready CSVs only for ready lines
```

## Implementation Scope

### Phase 0: Licensing And Repository Gate

Objective: confirm the selected upstream source is safe to prototype from.

Tasks:

- Confirm `Kentucky-ai/opentakeoff` license file and dependency notices.
- Record Apache-2.0 attribution requirements.
- Confirm no AGPL/non-commercial code is copied from rejected candidates.
- Keep BlueprintParser, planparser, OpenConstructionERP, PyMuPDF, and Floorplan-Dimractor as reference-only unless separately licensed.

Deliverables:

- `research/pdf-plan-takeoff-license-notes.md`
- Go/no-go note for OpenTakeoff prototype.

Verification:

- License file exists in upstream repo.
- Package metadata states Apache-2.0.
- No non-commercial or AGPL code is introduced into the local prototype.

Acceptance criteria:

- Prototype may proceed using OpenTakeoff and MIT/Apache-compatible helper libraries only.

### Phase 1: Local OpenTakeoff Prototype

Objective: prove that the sample PDFs can be loaded, calibrated, measured, and exported.

Tasks:

- Clone or vendor OpenTakeoff into a clearly isolated prototype folder.
- Run `npm install`, `npm test`, `npm run typecheck`, and `npm run build`.
- Start the local dev server.
- Load the architectural PDF.
- Calibrate one sheet using a known dimension.
- Perform sample linear, area, and count takeoffs:
  - external wall LM
  - internal wall LM
  - bracing panel LM
  - floor zone area
  - opening count sample
- Export CSV and JSON.
- Save exported samples under `research/opentakeoff-samples/`.

Deliverables:

- Local OpenTakeoff prototype running.
- Sample export files from sample architectural PDF.
- Short notes on UI limitations and any export-schema gaps.

Verification:

- App builds without errors.
- Tests pass.
- sample PDF opens locally.
- Scale calibration can be applied and retained.
- CSV/JSON export files contain measurable line/area/count values.
- Export does not require cloud upload.

Acceptance criteria:

- At least one reviewed measurement of each required class can be exported:
  - linear
  - area
  - count

### Phase 2: Measurement Data Contract

Objective: define the stable handoff format between PDF takeoff and timber workbook.

Tasks:

- Create a normalized measurement schema.
- Define required fields:
  - project
  - source PDF
  - page number
  - sheet/drawing number
  - drawing revision/date
  - scale/calibration source
  - measurement type
  - trade component
  - Site A/B
  - level
  - wall ID or zone ID
  - value
  - unit
  - review status
  - reviewer/date
  - notes
- Define import mappings into workbook tables:
  - `Wall Measurements`
  - `Floor Framing`
  - `Opening Schedule`
  - `Engineering Details Check`
  - `AS 1684 Check Register`
- Add line status rules:
  - `Draft`
  - `Needs Review`
  - `Reviewed`
  - `Rejected`
  - `TBA / Engineer`

Deliverables:

- `schemas/pdf_takeoff_measurement.schema.json`
- `research/workbook-import-field-map.md`
- Example `inputs/pdf_takeoff_import.example.json`

Verification:

- Schema validates sample OpenTakeoff export-transformed records.
- Required workbook fields are either mapped or explicitly marked as not available from PDF takeoff.
- Missing scale, sheet, source PDF, or review status blocks workbook-ready import.

Acceptance criteria:

- A reviewed PDF measurement can be transformed into a workbook-ready record without manual retyping.

### Phase 3: OpenTakeoff Export Bridge

Objective: convert OpenTakeoff CSV/JSON into the normalized timber import schema.

Tasks:

- Inspect OpenTakeoff native export structure.
- Build `scripts/convert_opentakeoff_export.mjs`.
- Map OpenTakeoff measurement types:
  - linear -> wall/bracing/joist run candidates
  - area -> floor/decking/bracing area candidates
  - count -> opening/symbol count candidates
- Add a mapping file for estimator classification:
  - OpenTakeoff condition name
  - target workbook sheet
  - target component
  - default Site/level/wall/zone behavior
- Output:
  - `inputs/pdf_takeoff_import.json`
  - `outputs/pdf_takeoff_import_review.csv`
- Mark all imported records as `Needs Review` unless the source export includes a confirmed review flag.

Deliverables:

- Conversion script.
- Mapping template.
- Review CSV.
- Import JSON.

Verification:

- Script rejects malformed exports with clear errors.
- Script preserves source PDF/page/sheet metadata.
- Script preserves measured value and unit.
- Script does not convert unreviewed items into `Reviewed`.
- Script handles empty exports without crashing.

Acceptance criteria:

- One OpenTakeoff export from the sample PDF produces valid normalized import JSON and review CSV.

### Phase 4: pdfplumber Sheet Index And Extraction Assist

Objective: add automated discovery support without relying on it for final quantities.

Tasks:

- Build `scripts/pdf_plan_index.py`.
- Extract for each PDF:
  - page count
  - page dimensions
  - text character count
  - vector object counts
  - likely sheet title
  - likely drawing number
  - scale text candidates
  - revision/date candidates
  - keyword hits
- Scan for:
  - `WINDOW`
  - `DOOR`
  - `SCHEDULE`
  - `AS1684`
  - `AS 1684`
  - `F7`
  - `LVL`
  - `BRACING`
  - `ALPHAFLOOR`
  - `TIE-DOWN`
- Add optional crop configuration for schedule pages.
- Output:
  - `outputs/pdf_sheet_index.csv`
  - `outputs/pdf_keyword_hits.csv`
  - `outputs/pdf_schedule_text_candidates.csv`

Deliverables:

- Sheet index script.
- CSV outputs for architectural and structural PDFs.
- Notes on pages requiring manual crop tuning.

Verification:

- Script completes on both sample PDFs.
- Architectural pages 11 and 12 are flagged as window/door schedule candidates.
- Structural pages 3 and 4 are flagged for AS1684/F7 references.
- Script does not treat extracted text as verified quantities.
- Scanned/no-text pages are flagged for OCR fallback.

Acceptance criteria:

- Estimator can use generated CSVs to navigate plan pages faster and identify schedule/detail pages.

### Phase 5: Workbook Import Staging

Objective: allow reviewed PDF measurements to populate workbook input sheets while keeping workbook formulas as the authority.

Tasks:

- Extend the timber workbook builder to optionally read `inputs/pdf_takeoff_import.json`.
- Populate or append staged records into:
  - `Wall Measurements`
  - `Floor Framing`
  - `Opening Schedule`
  - `Engineering Details Check`
- Preserve manual-entry capability in the workbook.
- Add source columns where needed:
  - source PDF
  - source page
  - sheet number
  - drawing revision
  - measurement source
  - review status
- Block order readiness unless imported measurements are `Reviewed`.

Deliverables:

- Builder update.
- Workbook preview with imported sample measurements.
- QA checks for import readiness.

Verification:

- Workbook builds with no import file.
- Workbook builds with sample import file.
- Missing review status blocks readiness.
- Reviewed wall measurements roll into plate/stud/noggin calculations.
- Floor-zone area rolls into decking/joist placeholders only where mapped.
- Imported engineering/detail references route through Engineering Details Check and RFI/TBA logic.
- No formulas return `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, or `#N/A`.

Acceptance criteria:

- A reviewed wall measurement from PDF import affects the workbook takeoff calculation and retains its PDF source reference.

### Phase 6: End-To-End Prototype

Objective: prove the whole path from PDF plan to workbook quantity line.

Tasks:

- Use sample architectural PDF.
- Create at least:
  - 2 external wall measurements
  - 2 internal wall measurements
  - 1 floor zone measurement
  - 1 bracing measurement
  - 1 count measurement
- Export from OpenTakeoff.
- Convert to normalized import JSON.
- Build workbook in measurement mode and full mode.
- Review QA/TBA outputs.

Deliverables:

- End-to-end sample workbook.
- Import JSON.
- Review CSV.
- Verification report.

Verification:

- OpenTakeoff export exists.
- Import conversion passes schema validation.
- Workbook build passes verifier.
- Imported measurements are visible in input sheets.
- Source PDF/page/sheet references are visible.
- Order Summary remains blocked until unresolved AS1684/engineering/project checks are complete.
- Supplier-ready CSVs include only ready lines.

Acceptance criteria:

- Demonstrable PDF-to-workbook path exists for reviewed measurement records.

## Verification Matrix

| Area | Check | Pass Condition |
|---|---|---|
| Licensing | OpenTakeoff license | Apache-2.0 confirmed, attribution recorded |
| Licensing | Excluded repos | No non-commercial/AGPL code copied |
| OpenTakeoff | Build | `npm test`, `npm run typecheck`, `npm run build` pass |
| OpenTakeoff | PDF loading | sample architectural PDF opens locally |
| OpenTakeoff | Scale | Known dimension calibration applies correctly |
| Export | CSV/JSON | Contains line/area/count measurements |
| Schema | Validation | Export bridge output validates |
| Review gate | Unreviewed data | Cannot become order-ready |
| pdfplumber | Sheet index | Both sample PDFs scanned successfully |
| pdfplumber | Keyword detection | Schedule and AS1684/F7 pages flagged |
| Workbook | No import | Existing full/measurement builds still pass |
| Workbook | With import | Imported values populate target sheets |
| Workbook | Calculations | Plate/stud/noggin/floor formulas recalculate |
| Workbook | QA | Missing review/engineering/AS1684 details block readiness |
| Workbook | Errors | No Excel formula errors |
| Exports | Supplier CSV | Only ready lines appear in ready CSVs |

## Risks And Controls

| Risk | Control |
|---|---|
| PDF takeoff values entered at wrong scale | Require source sheet, calibration method, and reviewer before import readiness |
| Automated extraction gives false confidence | Default all extracted/imported records to `Needs Review` |
| Schedule tables do not parse cleanly | Use guided crop/review workflow before attempting automation |
| Licensing contamination | Keep non-commercial and AGPL repos as references only |
| Workbook becomes too dependent on external files | Workbook still builds from manual entries; import file is optional staging |
| Source traceability lost | Add source PDF/page/sheet/revision columns to imported workbook rows |
| Engineer/member assumptions bypassed | Engineering Details Check remains the order-readiness gate |
| AS1684 checks misrepresented as compliance | Register records review status only; no automated compliance certificate |

## Go / No-Go Gates

Gate 1: OpenTakeoff feasibility

- Go if sample PDFs load, calibrate, measure, and export.
- No-go if export cannot retain enough metadata for traceable workbook import.

Gate 2: Import bridge feasibility

- Go if exported measurements can be normalized into workbook import JSON.
- No-go if manual retyping remains unavoidable for core fields.

Gate 3: Workbook integration feasibility

- Go if reviewed imported wall measurements recalculate workbook quantities and retain source references.
- No-go if imports create unstable formulas or weaken QA/TBA controls.

Gate 4: Automation expansion

- Go if manual/calibrated workflow is reliable first.
- No-go for AI/OCR automation until review gates and source traceability are working.

## Recommended Execution Order

1. Run OpenTakeoff locally against sample architectural PDF.
2. Export sample measurements.
3. Define and validate the normalized import schema.
4. Build the OpenTakeoff export converter.
5. Build the pdfplumber sheet indexer.
6. Add optional workbook import staging.
7. Run end-to-end PDF-to-workbook verification.
8. Only then evaluate OCR/object detection modules.

## Definition Of Done

The next step is complete when:

- A sample PDF can be measured in a local takeoff UI.
- Exported measurements can be converted into a validated import JSON.
- The timber workbook can consume reviewed measurements.
- Calculated takeoff quantities update from imported PDF measurements.
- Source PDF/page/sheet/revision references remain visible.
- QA gates correctly block unreviewed, missing, AS1684, and engineering-TBA items.
- Full and measurement workbook builds pass verification.

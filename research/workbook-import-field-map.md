# PDF Takeoff To Timber Workbook Field Map

Date: 2026-07-08

## Import Contract

Input file:

- `inputs/pdf_takeoff_import.json`

Schema:

- `schemas/pdf_takeoff_measurement.schema.json`

All imported rows must retain:

- source PDF
- source page
- sheet/drawing number
- drawing revision
- calibration source
- review status

Rows that are not `Reviewed` must remain visible but must not make order lines ready.

## Workbook Targets

### Wall Measurements

Target components:

- `External Wall`
- `Internal Wall`
- `Bracing Panel`

Mapping:

| Import Field | Workbook Use |
|---|---|
| `site` | Site |
| `level` | Level |
| `wallId` | Wall ID |
| `tradeComponent` | Wall Type / source classification |
| `valueM` | Outside-to-outside length in metres |
| `sourcePdf`, `pageNumber`, `sheetNumber`, `drawingRevision`, `reviewStatus` | Notes/source traceability |

Rules:

- `External Wall` maps to wall type `External`.
- `Internal Wall` maps to wall type `Internal`.
- `Bracing Panel` contributes to bracing-panel length but still remains AS1684-review blocked until bracing checks are completed.

### Floor Framing

Target components:

- `Floor Zone`

Mapping:

| Import Field | Workbook Use |
|---|---|
| `site` | Site |
| `zoneId` | Zone ID |
| `valueM2` | Area m2 |
| `lengthMm` | Rectangular zone length in mm |
| `widthMm` | Rectangular zone width in mm |
| `joistSpanDirection` | Direction of joist span, `Length` or `Width` |
| `joistSpanMm` | Reviewed joist span in mm |
| `joistSpacingMm` | Joist spacing in mm; defaults to 450 if blank in builder |
| `supportType` | Support/framing note for the zone |
| `joistMember` | J1/J2/member source from structural drawings |
| `sourcePdf`, `pageNumber`, `sheetNumber`, `drawingRevision`, `reviewStatus` | Notes/source traceability |

Rules:

- Area-only imports can stage a floor zone but do not make floor joists or blocking supplier-ready.
- Reviewed `lengthMm`, `widthMm`, `joistSpanDirection`, `joistSpanMm`, `joistSpacingMm`, `supportType`, and `joistMember` are required to move floor joist/blocking lines out of generic `Pending Measure`.
- Floor rows with area but incomplete span/direction/member data remain visible and route to `Engineer TBA` or `Pending Measure` until reviewed.
- Joist span/direction and member source must come from reviewed structural-sheet evidence or a named RFI/TBA response.

### Opening Schedule

Target components:

- `Opening Count`
- `opening`

Mapping:

| Import Field | Workbook Use |
|---|---|
| `site` | Site |
| `level` | Level |
| `openingId` | Opening ID |
| `value` | Count/reference only unless clear span is provided later |
| `sourcePdf`, `pageNumber`, `sheetNumber`, `drawingRevision`, `reviewStatus` | Notes/source traceability |

Rules:

- Count imports do not create clear spans.
- Lintel calculations still require clear-span schedule or field measurements.

### Engineering Details Check

Target components:

- `engineering_reference`

Rules:

- Engineering imports are references/check prompts only.
- Member type, size, bearing, and connection details must be explicitly entered or confirmed.

## Readiness Rules

- `Reviewed`: may feed workbook calculations.
- `Needs Review`: visible in import staging, blocks readiness.
- `Draft`: visible only, blocks readiness.
- `Rejected`: ignored for calculations, remains in review CSV.
- `TBA / Engineer`: routes to TBA/RFI and blocks readiness.

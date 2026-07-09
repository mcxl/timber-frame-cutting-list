# PDF Plan Takeoff License Notes

Date: 2026-07-08

## OpenTakeoff

- Repository: https://github.com/Kentucky-ai/opentakeoff
- Local prototype path: `prototypes/opentakeoff`
- License file: `prototypes/opentakeoff/LICENSE`
- License confirmed: Apache License 2.0
- Package metadata: `prototypes/opentakeoff/web/package.json`
- Package license field: `Apache-2.0`
- Notice file present: `prototypes/opentakeoff/NOTICE`
- Third-party notices present: `prototypes/opentakeoff/THIRD-PARTY-NOTICES.md`

## Adoption Notes

- The prototype may use OpenTakeoff as the calibrated PDF takeoff layer.
- If OpenTakeoff code is redistributed or materially modified, retain the Apache-2.0 license and required attribution notices.
- Any modified OpenTakeoff files should carry clear modification notices if redistributed.

## Excluded Direct Dependencies

Do not copy code from these repositories into the commercial/workflow prototype unless separately licensed or legal review approves:

- `goodmorningcoffee/BlueprintParser_OS`: non-commercial source-available.
- `anngrrr/planparser`: non-commercial license.
- `datadrivenconstruction/OpenConstructionERP`: AGPL-3.0-or-later / commercial option.
- `pymupdf/PyMuPDF`: AGPL-3.0 or commercial license.
- `jasoncobra3/Floorplan-Dimractor`: no standard license file detected.
- `ilirkl/protakeoff-public`: README claims MIT, but no standard license file was detected by GitHub API during research.

## Go / No-Go

Go for OpenTakeoff prototype work using Apache-2.0 obligations.

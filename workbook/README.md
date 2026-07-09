# Workbook Builder

This folder contains the sanitized workbook-generation code for the cut-on-site wall and conventional pitched roof framing material workflow.

## Files

- `build_timber_frame_workbook.mjs` builds the framing workbook sheets, formulas, review registers, source manifest checks, and export tabs.
- `verify_workbook.mjs` checks expected sheets and workbook readiness outputs.
- `lib/source_manifest.mjs` validates source-file hash manifests for staged PDF/DWG imports.

## Data Boundary

The public repo does not include real plans, DWGs, PDFs, workbook outputs, supplier exports, or private project inputs. The script defaults use sample labels and tolerate missing private import files so the implementation can be reviewed without exposing project records.

The workbook builder imports `@oai/artifact-tool`, which was used in the original local build environment. Treat this folder as public implementation reference unless you have an equivalent workbook runtime available.

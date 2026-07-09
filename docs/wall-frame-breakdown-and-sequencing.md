# Wall Frame Breakdown And Sequencing

This page describes a synthetic public capability pattern. It does not include real project drawings, measurements, shop drawings, installation instructions, or engineer-certified framing details.

## What The Repo Showcases

The public showcase now describes how the private workflow can support individual wall-frame planning by:

- identifying wall frames by level, area, wall ID, wall type, and source reference;
- breaking each frame into member groups;
- labelling plates, studs, noggins, lintels, trimmers, jamb studs, sill/support members, bracing panels, hold-downs, and opening relationships;
- providing synthetic sketches and diagrams for individual wall frames;
- sequencing construction from cut-list preparation through frame stand, brace, and QA checks.

## Wall Frame Identification

Each wall frame can carry a structured label set:

| Field | Example Demo Value |
| --- | --- |
| Wall ID | GF-W07 |
| Level | Ground Floor |
| Wall Type | External loadbearing wall |
| Source Ref | Demo plan sheet and revision |
| Review Status | Reviewed / Needs Review / Engineer TBA |
| Output Status | Ready / Check / TBA |

## Breakdown Model

The frame breakdown separates material and review items into clear buckets:

| Group | Examples |
| --- | --- |
| Plates | bottom plate, top plate, double top plate, lap/join notes |
| Studs | common studs, end studs, jamb studs, trimming studs |
| Openings | lintel, sill/support, cripple studs, opening reference |
| Noggins | row count, spacing assumption, special noggin notes |
| Bracing | bracing panel location, sheet/bracing type, hold point |
| Fixing and tie-down | hold-down note, strap/bracket review, engineer TBA |
| QA blockers | missing source, stale manifest, unreviewed import, unresolved engineering detail |

## Sketch And Diagram Output

The showcase includes a synthetic diagram at `assets/wall-frame-sequence.svg`. In the private workflow, an individual frame sketch can show:

- frame outline and wall ID;
- plates, studs, noggins, lintel, trimmers, opening, and bracing zone;
- source references and review state;
- unresolved TBA callouts;
- sequence notes for fabrication and site checks.

These sketches are planning aids. They are not certified shop drawings.

## Construction Sequence

A safe public sequence for the workflow is:

1. Confirm source drawings, revision, wall ID, and review state.
2. Generate or review the frame member breakdown.
3. Mark plates from the labelled wall-frame schedule.
4. Cut studs, trimmers, lintel-related members, noggins, and plates.
5. Assemble the frame flat, checking opening dimensions and member labels.
6. Square the frame and check bracing/hold-down notes.
7. Stand the frame in sequence with temporary bracing.
8. Plumb, line, brace, and record QA/TBA items before proceeding.

## Privacy Boundary

Only synthetic examples belong in this repo. Real frame sketches, site dimensions, drawing extracts, marked-up plans, exported workbooks, and supplier files remain private.

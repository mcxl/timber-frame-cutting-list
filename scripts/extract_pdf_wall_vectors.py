#!/usr/bin/env python3
"""Extract candidate wall-length rows from architectural PDF vector rectangles.

This script creates review candidates only. It never overwrites
inputs/pdf_takeoff_import.json unless a caller deliberately copies reviewed rows.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

import pdfplumber
from PIL import Image, ImageDraw, ImageFont


DEFAULT_PDF = "sample-architectural-plans.pdf"
MM_PER_PDF_POINT_AT_1_TO_100 = 25.4 / 72 * 100


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract candidate wall vector lengths from the architectural PDF.")
    parser.add_argument("--pdf", default=DEFAULT_PDF, help="Architectural PDF path.")
    parser.add_argument("--pages", default="3,4", help="1-based PDF pages to inspect.")
    parser.add_argument("--output-dir", default="outputs/measurement_review", help="Output directory.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Date suffix for generated files.")
    parser.add_argument("--review-status", default="Needs Review", help="Candidate review status.")
    parser.add_argument("--site-split-y", type=float, default=600.0, help="PDF top-coordinate split between Site A and Site B plan bands.")
    parser.add_argument("--internal-min-mm", type=float, default=100.0)
    parser.add_argument("--internal-max-mm", type=float, default=125.0)
    parser.add_argument("--external-min-mm", type=float, default=160.0)
    parser.add_argument("--external-max-mm", type=float, default=230.0)
    return parser.parse_args()


def page_level(page_number: int) -> str:
    return "Ground" if page_number == 3 else "First"


def sheet_number(page_number: int) -> str:
    return "3 Ground Floor Plan" if page_number == 3 else "4 First Floor Plan"


def level_prefix(level: str) -> str:
    return "GF" if level == "Ground" else "FF"


def classify_wall(thickness_mm: float, args: argparse.Namespace) -> str:
    if args.external_min_mm <= thickness_mm <= args.external_max_mm:
        return "External Wall"
    if args.internal_min_mm <= thickness_mm <= args.internal_max_mm:
        return "Internal Wall"
    return ""


def is_wall_fill(rect: dict[str, object]) -> bool:
    if not rect.get("fill"):
        return False
    color = rect.get("non_stroking_color")
    if isinstance(color, (list, tuple)) and len(color) >= 3:
        rgb = [float(part) for part in color[:3]]
        return all(0.45 <= part <= 0.56 for part in rgb)
    return False


def rect_rows(pdf_path: Path, pages: list[int], args: argparse.Namespace) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_number in pages:
            page = pdf.pages[page_number - 1]
            for rect in page.rects:
                if not is_wall_fill(rect):
                    continue
                width_pt = float(rect.get("width", rect["x1"] - rect["x0"]))
                height_pt = float(rect.get("height", rect["bottom"] - rect["top"]))
                if width_pt <= 0 or height_pt <= 0:
                    continue
                thickness_mm = min(width_pt, height_pt) * MM_PER_PDF_POINT_AT_1_TO_100
                wall_type = classify_wall(thickness_mm, args)
                if not wall_type:
                    continue
                aspect_ratio = max(width_pt, height_pt) / min(width_pt, height_pt)
                if wall_type == "Internal Wall" and aspect_ratio < 4.0:
                    continue
                length_m = max(width_pt, height_pt) * MM_PER_PDF_POINT_AT_1_TO_100 / 1000
                if length_m < 0.25:
                    continue
                site = "A" if float(rect["top"]) < args.site_split_y else "B"
                rows.append(
                    {
                        "page": page_number,
                        "site": site,
                        "level": page_level(page_number),
                        "wall_type": wall_type,
                        "length_m": length_m,
                        "thickness_mm": thickness_mm,
                        "x0": float(rect["x0"]),
                        "top": float(rect["top"]),
                        "x1": float(rect["x1"]),
                        "bottom": float(rect["bottom"]),
                        "width_pt": width_pt,
                        "height_pt": height_pt,
                    }
                )
    return rows


def write_extraction_csv(path: Path, rows: list[dict[str, object]]) -> None:
    headers = ["page", "site", "level", "wall_type", "length_m", "thickness_mm", "x0", "top", "x1", "bottom", "width_pt", "height_pt"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def aggregate(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[tuple[int, str, str, str], float] = defaultdict(float)
    for row in rows:
        grouped[(int(row["page"]), str(row["site"]), str(row["level"]), str(row["wall_type"]))] += float(row["length_m"])

    output: list[dict[str, object]] = []
    for (page, site, level, wall_type), length in sorted(grouped.items()):
        output.append({"page": page, "site": site, "level": level, "wall_type": wall_type, "length_m": round(length, 3)})
    return output


def candidate_measurement(row: dict[str, object], pdf_name: str, extraction_csv: Path, review_status: str, run_date: str) -> dict[str, object]:
    site = str(row["site"])
    level = str(row["level"])
    prefix = level_prefix(level)
    trade = str(row["wall_type"])
    wall_code = "EXT" if trade == "External Wall" else "INT"
    measurement_id = f"{site}-{level}-{site}-{prefix}-{wall_code}-PDF-VECTOR-CANDIDATE"
    length_m = float(row["length_m"])
    return {
        "id": measurement_id,
        "project": "Sample Duplex",
        "sourcePdf": pdf_name,
        "pageNumber": int(row["page"]),
        "sheetNumber": sheet_number(int(row["page"])),
        "drawingRevision": "Construction Certificate A / March 2026 PDF set",
        "calibrationSource": "PDF vector wall rectangles at 1:100; 1 PDF point = 35.2778mm real length; candidate output requires visual review before active import.",
        "measurementType": "linear",
        "tradeComponent": trade,
        "targetWorkbookSheet": "Wall Measurements",
        "site": site,
        "level": level,
        "wallId": f"{site}-{prefix}-{wall_code}-PDF-VECTOR-CANDIDATE",
        "zoneId": "",
        "openingId": "",
        "sourceValue": length_m,
        "sourceUnit": "m",
        "value": length_m,
        "unit": "m",
        "valueM": length_m,
        "valueMm": round(length_m * 1000),
        "reviewStatus": review_status,
        "reviewer": "",
        "reviewedDate": "",
        "sourceSystem": "PDF Vector Takeoff",
        "conditionName": f"Site {site} {level} {trade} LM",
        "confidence": 0.9,
        "notes": f"Candidate from filled wall rectangles. Evidence CSV: {extraction_csv.as_posix()}.",
    }


def write_candidate_import(path: Path, pdf_path: Path, extraction_csv: Path, overlay_paths: list[Path], aggregate_rows: list[dict[str, object]], review_status: str, run_date: str) -> None:
    payload = {
        "project": "Sample Duplex",
        "source": {
            "system": "PDF Vector Takeoff",
            "importedAt": f"{run_date}T00:00:00.000Z",
            "sourceFile": pdf_path.name,
            "mappingFile": extraction_csv.as_posix(),
            "qaEvidence": [overlay.as_posix() for overlay in overlay_paths],
        },
        "measurements": [
            candidate_measurement(row, pdf_path.name, extraction_csv, review_status, run_date)
            for row in aggregate_rows
        ],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_review_csv(path: Path, aggregate_rows: list[dict[str, object]], pdf_path: Path, extraction_csv: Path, review_status: str, run_date: str) -> None:
    headers = ["Import ID", "Condition", "Target Workbook Sheet", "Measurement Type", "Trade Component", "Site", "Level", "Value", "Unit", "Review Status", "Source PDF", "Page", "Sheet", "Validation", "Notes"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        for row in aggregate_rows:
            measurement = candidate_measurement(row, pdf_path.name, extraction_csv, review_status, run_date)
            writer.writerow([
                measurement["id"],
                measurement["conditionName"],
                measurement["targetWorkbookSheet"],
                measurement["measurementType"],
                measurement["tradeComponent"],
                measurement["site"],
                measurement["level"],
                measurement["value"],
                measurement["unit"],
                measurement["reviewStatus"],
                measurement["sourcePdf"],
                measurement["pageNumber"],
                measurement["sheetNumber"],
                "OK",
                measurement["notes"],
            ])


def draw_overlay(path: Path, page_number: int, page_width: float, page_height: float, rows: list[dict[str, object]]) -> None:
    scale = 2
    image = Image.new("RGB", (int(page_width * scale), int(page_height * scale)), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    draw.text((20, 20), f"Page {page_number} wall vector candidates", fill=(20, 20, 20), font=font)
    colors = {
        ("A", "External Wall"): (200, 40, 40),
        ("A", "Internal Wall"): (240, 150, 40),
        ("B", "External Wall"): (35, 90, 190),
        ("B", "Internal Wall"): (40, 140, 80),
    }
    for row in rows:
        color = colors.get((str(row["site"]), str(row["wall_type"])), (80, 80, 80))
        xy = [float(row["x0"]) * scale, float(row["top"]) * scale, float(row["x1"]) * scale, float(row["bottom"]) * scale]
        draw.rectangle(xy, outline=color, width=3)
    image.save(path)


def write_overlays(output_dir: Path, pdf_path: Path, pages: list[int], rows: list[dict[str, object]], run_date: str) -> list[Path]:
    overlay_paths: list[Path] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_number in pages:
            page = pdf.pages[page_number - 1]
            page_rows = [row for row in rows if int(row["page"]) == page_number]
            overlay_path = output_dir / f"page_{page_number}_wall_vector_overlay_candidate_{run_date}.png"
            draw_overlay(overlay_path, page_number, page.width, page.height, page_rows)
            overlay_paths.append(overlay_path)
    return overlay_paths


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pages = [int(part.strip()) for part in args.pages.split(",") if part.strip()]

    rows = rect_rows(pdf_path, pages, args)
    aggregate_rows = aggregate(rows)
    extraction_csv = output_dir / f"pdf_wall_rectangles_extraction_candidate_{args.date}.csv"
    candidate_import = output_dir / f"pdf_wall_vectors_candidate_import_{args.date}.json"
    review_csv = output_dir / f"pdf_wall_vectors_candidate_review_{args.date}.csv"

    write_extraction_csv(extraction_csv, rows)
    overlay_paths = write_overlays(output_dir, pdf_path, pages, rows, args.date)
    write_candidate_import(candidate_import, pdf_path, extraction_csv, overlay_paths, aggregate_rows, args.review_status, args.date)
    write_review_csv(review_csv, aggregate_rows, pdf_path, extraction_csv, args.review_status, args.date)

    print(
        json.dumps(
            {
                "extractionCsv": str(extraction_csv),
                "candidateImport": str(candidate_import),
                "reviewCsv": str(review_csv),
                "overlayPngs": [str(path) for path in overlay_paths],
                "candidateRows": len(aggregate_rows),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

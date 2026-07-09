#!/usr/bin/env python3
"""Extract opening IDs from architectural PDF schedule pages.

This script intentionally extracts identifiers only. It does not infer sizes or
write quantities into the workbook.
"""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from pathlib import Path

import pdfplumber


DEFAULT_ARCHITECTURAL_PDF = (
    "sample-architectural-plans.pdf"
)
OPENING_RE = re.compile(r"\b([WD]\d{2}[AB])\b", re.IGNORECASE)
DIMENSION_RE = re.compile(r"\b(\d{3,5})\s*[xX×]\s*(\d{3,5})\b")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract opening IDs from PDF schedule pages.")
    parser.add_argument("--pdf", default=DEFAULT_ARCHITECTURAL_PDF, help="Architectural PDF path.")
    parser.add_argument("--site-a-page", type=int, default=11, help="1-based Site A schedule page.")
    parser.add_argument("--site-b-page", type=int, default=12, help="1-based Site B schedule page.")
    parser.add_argument(
        "--output",
        default="outputs/pdf_plan_index/opening_schedule_extract.csv",
        help="CSV output path.",
    )
    return parser.parse_args()


def extract_text(pdf_path: Path, page_number: int) -> str:
    with pdfplumber.open(str(pdf_path)) as pdf:
        if page_number < 1 or page_number > len(pdf.pages):
            raise ValueError(f"Page {page_number} is outside {pdf_path} page range 1-{len(pdf.pages)}")
        return pdf.pages[page_number - 1].extract_text(x_tolerance=2, y_tolerance=3) or ""


def extract_rows(pdf_path: Path, page_number: int, site: str) -> list[dict[str, str]]:
    text = extract_text(pdf_path, page_number)
    rows: list[dict[str, str]] = []
    for line in text.splitlines():
        normalized_line = re.sub(r"\s+", " ", line.strip())
        dimension_matches = DIMENSION_RE.findall(normalized_line)
        extracted_clear_span = ""
        dimension_note = ""
        if len(dimension_matches) == 1:
            width = int(dimension_matches[0][0])
            if 200 <= width <= 10000:
                extracted_clear_span = str(width)
                dimension_note = " Candidate clear span extracted from same text line."
        for match in OPENING_RE.finditer(normalized_line):
            opening_id = match.group(1).upper()
            site_match = opening_id.endswith(site)
            rows.append(
                {
                    "sourcePdf": pdf_path.name,
                    "page": str(page_number),
                    "site": site if site_match else opening_id[-1],
                    "openingId": opening_id,
                    "rawMatch": match.group(0),
                    "rawLine": normalized_line,
                    "extractedClearSpanMm": extracted_clear_span,
                    "confidence": "0.95" if site_match else "0.75",
                    "reviewStatus": "Needs Review",
                    "notes": f"Text-extracted from architectural opening schedule page.{dimension_note}",
                }
            )

    return rows


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rows = [
        *extract_rows(pdf_path, args.site_a_page, "A"),
        *extract_rows(pdf_path, args.site_b_page, "B"),
    ]

    counts = Counter((row["site"], row["openingId"]) for row in rows)
    for row in rows:
        count = counts[(row["site"], row["openingId"])]
        if count > 1:
            row["notes"] = f"{row['notes']} Duplicate candidate count on extracted pages: {count}."

    headers = [
        "sourcePdf",
        "page",
        "site",
        "openingId",
        "rawMatch",
        "rawLine",
        "extractedClearSpanMm",
        "confidence",
        "reviewStatus",
        "notes",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)

    print(
        {
            "pdf": str(pdf_path),
            "output": str(output_path),
            "rows": len(rows),
            "uniqueOpenings": len(counts),
            "siteAPage": args.site_a_page,
            "siteBPage": args.site_b_page,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

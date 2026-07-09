#!/usr/bin/env python
"""Create lightweight PDF plan indexes for takeoff review.

The script intentionally does not calculate final quantities. It helps an
estimator find likely sheets, schedules, scale notes, and engineering references.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    import pdfplumber
except Exception as exc:  # pragma: no cover - runtime environment guard
    raise SystemExit(f"pdfplumber is required for pdf_plan_index.py: {exc}") from exc


KEYWORDS = [
    "WINDOW",
    "DOOR",
    "SCHEDULE",
    "AS1684",
    "AS 1684",
    "F7",
    "LVL",
    "BRACING",
    "ALPHAFLOOR",
    "TIE-DOWN",
]

DRAWING_NO_RE = re.compile(r"\b(?:A|S|DA|CC|SK|SE|ST)[-\s]?\d{1,3}[A-Z]?\b", re.I)
SCALE_RE = re.compile(r"\b(?:1\s*:\s*\d{1,4}|SCALE\s*[:\-]?\s*(?:1\s*:\s*\d{1,4}|NTS))\b", re.I)
REVISION_RE = re.compile(r"\b(?:REV(?:ISION)?\.?\s*[A-Z0-9]+|04[_/\-. ]06[_/\-. ]2026|20\d{2}[-_/]\d{1,2}[-_/]\d{1,2})\b", re.I)


@dataclass
class PageIndex:
    pdf: str
    page: int
    width: float
    height: float
    text_chars: int
    line_count: int
    rect_count: int
    curve_count: int
    image_count: int
    likely_drawing_number: str
    scale_candidates: str
    revision_candidates: str
    keyword_score: int
    likely_role: str


def compact_join(values: list[str], limit: int = 6) -> str:
    seen: list[str] = []
    for value in values:
        normalized = re.sub(r"\s+", " ", value.strip())
        if normalized and normalized not in seen:
            seen.append(normalized)
    return " | ".join(seen[:limit])


def classify_page(keyword_counts: dict[str, int]) -> str:
    if keyword_counts.get("WINDOW", 0) or keyword_counts.get("DOOR", 0) or keyword_counts.get("SCHEDULE", 0):
        if keyword_counts.get("SCHEDULE", 0):
            return "Opening/Schedule candidate"
        return "Architectural opening candidate"
    if keyword_counts.get("AS1684", 0) or keyword_counts.get("AS 1684", 0) or keyword_counts.get("F7", 0):
        return "Engineering/AS1684 note candidate"
    if keyword_counts.get("BRACING", 0) or keyword_counts.get("LVL", 0) or keyword_counts.get("TIE-DOWN", 0):
        return "Structural detail candidate"
    if sum(keyword_counts.values()):
        return "Keyword candidate"
    return ""


def keyword_counts(text: str) -> dict[str, int]:
    upper = text.upper()
    return {keyword: upper.count(keyword) for keyword in KEYWORDS}


def relevant_lines(text: str) -> list[str]:
    lines: list[str] = []
    for line in text.splitlines():
        upper = line.upper()
        if any(keyword in upper for keyword in KEYWORDS) or re.search(r"\b[WD]\d{2}[A-Z]\b", upper):
            lines.append(re.sub(r"\s+", " ", line.strip())[:240])
    return lines


def index_pdf(pdf_path: Path) -> tuple[list[PageIndex], list[dict[str, object]], list[dict[str, object]]]:
    page_rows: list[PageIndex] = []
    keyword_rows: list[dict[str, object]] = []
    schedule_rows: list[dict[str, object]] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            objects = page.objects
            counts = keyword_counts(text)
            role = classify_page(counts)
            drawings = DRAWING_NO_RE.findall(text)
            scales = SCALE_RE.findall(text)
            revisions = REVISION_RE.findall(text)
            page_rows.append(
                PageIndex(
                    pdf=pdf_path.name,
                    page=page_number,
                    width=round(float(page.width), 2),
                    height=round(float(page.height), 2),
                    text_chars=len(text),
                    line_count=len(objects.get("line", [])),
                    rect_count=len(objects.get("rect", [])),
                    curve_count=len(objects.get("curve", [])),
                    image_count=len(objects.get("image", [])),
                    likely_drawing_number=compact_join(drawings),
                    scale_candidates=compact_join(scales),
                    revision_candidates=compact_join(revisions),
                    keyword_score=sum(counts.values()),
                    likely_role=role,
                )
            )
            for keyword, count in counts.items():
                if count:
                    keyword_rows.append(
                        {
                            "PDF": pdf_path.name,
                            "Page": page_number,
                            "Keyword": keyword,
                            "Count": count,
                            "Likely Role": role,
                        }
                    )
            if role in {"Opening/Schedule candidate", "Architectural opening candidate", "Engineering/AS1684 note candidate"}:
                lines = relevant_lines(text)
                schedule_rows.append(
                    {
                        "PDF": pdf_path.name,
                        "Page": page_number,
                        "Likely Role": role,
                        "Likely Drawing Number": compact_join(drawings),
                        "Scale Candidates": compact_join(scales),
                        "Candidate Text": " || ".join(lines[:30]),
                        "Needs OCR": "Yes" if len(text.strip()) < 50 else "No",
                        "Notes": "Review/crop manually before using extracted schedule data.",
                    }
                )
            elif len(text.strip()) < 50:
                schedule_rows.append(
                    {
                        "PDF": pdf_path.name,
                        "Page": page_number,
                        "Likely Role": "Low/no text",
                        "Likely Drawing Number": compact_join(drawings),
                        "Scale Candidates": compact_join(scales),
                        "Candidate Text": "",
                        "Needs OCR": "Yes",
                        "Notes": "Low text volume; use OCR fallback if this sheet is relevant.",
                    }
                )

    return page_rows, keyword_rows, schedule_rows


def write_csv(path: Path, rows: list[object], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.__dict__ if hasattr(row, "__dict__") else row)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Index PDF plan sheets and likely takeoff/schedule pages.")
    parser.add_argument("--pdf", action="append", required=True, help="PDF file to index. Repeat for multiple PDFs.")
    parser.add_argument("--output-dir", default="outputs/pdf_plan_index", help="Output directory for CSVs.")
    args = parser.parse_args(argv)

    all_pages: list[PageIndex] = []
    all_keywords: list[dict[str, object]] = []
    all_schedules: list[dict[str, object]] = []

    for pdf in args.pdf:
        pdf_path = Path(pdf)
        if not pdf_path.exists():
            raise FileNotFoundError(pdf)
        pages, keywords, schedules = index_pdf(pdf_path)
        all_pages.extend(pages)
        all_keywords.extend(keywords)
        all_schedules.extend(schedules)

    output_dir = Path(args.output_dir)
    write_csv(
        output_dir / "pdf_sheet_index.csv",
        all_pages,
        [
            "pdf",
            "page",
            "width",
            "height",
            "text_chars",
            "line_count",
            "rect_count",
            "curve_count",
            "image_count",
            "likely_drawing_number",
            "scale_candidates",
            "revision_candidates",
            "keyword_score",
            "likely_role",
        ],
    )
    write_csv(output_dir / "pdf_keyword_hits.csv", all_keywords, ["PDF", "Page", "Keyword", "Count", "Likely Role"])
    write_csv(
        output_dir / "pdf_schedule_text_candidates.csv",
        all_schedules,
        ["PDF", "Page", "Likely Role", "Likely Drawing Number", "Scale Candidates", "Candidate Text", "Needs OCR", "Notes"],
    )
    print(
        {
            "pdf_count": len(args.pdf),
            "page_count": len(all_pages),
            "keyword_rows": len(all_keywords),
            "candidate_rows": len(all_schedules),
            "output_dir": str(output_dir),
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

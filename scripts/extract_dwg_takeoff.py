import argparse
import csv
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


INSUNITS_TO_MM = {
    1: 25.4,       # inches
    2: 304.8,      # feet
    4: 1.0,        # millimetres
    5: 10.0,       # centimetres
    6: 1000.0,     # metres
    14: 1000.0,    # decimetres
}


def parse_args():
    parser = argparse.ArgumentParser(description="Extract review-first timber takeoff candidates from converted DWG/DXF files.")
    parser.add_argument("--dxf-dir", required=True)
    parser.add_argument("--dwg-dir", default="")
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--review-overrides", default="")
    parser.add_argument("--project", default="")
    parser.add_argument("--output-dir", default="outputs/dwg_takeoff")
    parser.add_argument("--import-json", default="inputs/dwg_takeoff_import.json")
    parser.add_argument("--layer-summary-csv", default="")
    parser.add_argument("--entity-inventory-csv", default="")
    parser.add_argument("--review-csv", default="")
    parser.add_argument("--summary-json", default="")
    parser.add_argument("--inventory-only", action="store_true")
    return parser.parse_args()


def csv_escape_rows(path, headers, rows):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default


def load_review_overrides(path):
    if not path or not Path(path).exists():
        return {}
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        overrides = {}
        for row in reader:
            key = row.get("importId") or row.get("Import ID") or row.get("id") or row.get("ID")
            if key:
                overrides[str(key).strip()] = row
        return overrides


def clean_id(value):
    text = re.sub(r"[^A-Za-z0-9_-]+", "-", str(value or "").strip())
    return re.sub(r"-+", "-", text).strip("-") or "ROW"


def distance(a, b):
    return math.hypot(float(b[0]) - float(a[0]), float(b[1]) - float(a[1]))


def polygon_area(points):
    if len(points) < 3:
        return 0.0
    area = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area += float(point[0]) * float(next_point[1]) - float(next_point[0]) * float(point[1])
    return abs(area) / 2.0


def polyline_length(points, closed):
    if len(points) < 2:
        return 0.0
    total = sum(distance(points[index], points[index + 1]) for index in range(len(points) - 1))
    if closed:
        total += distance(points[-1], points[0])
    return total


def entity_text(entity):
    dxftype = entity.dxftype()
    if dxftype == "TEXT":
        return getattr(entity.dxf, "text", "")
    if dxftype == "MTEXT":
        try:
            return entity.plain_text()
        except Exception:
            return getattr(entity, "text", "")
    return ""


def insert_attributes(entity):
    try:
        return "; ".join(f"{attrib.dxf.tag}={attrib.dxf.text}" for attrib in entity.attribs)
    except Exception:
        return ""


def entity_measurement(entity, unit_scale_mm):
    dxftype = entity.dxftype()
    try:
        if dxftype == "LINE":
            length = distance(entity.dxf.start, entity.dxf.end) * unit_scale_mm
            return length, "", ""
        if dxftype == "LWPOLYLINE":
            points = [(point[0], point[1]) for point in entity.get_points("xy")]
            closed = bool(entity.closed)
            length = polyline_length(points, closed) * unit_scale_mm
            area = polygon_area(points) * (unit_scale_mm / 1000.0) ** 2 if closed else ""
            return length, area, "bulge arcs treated as straight chords" if any(abs(point[2]) > 1e-9 for point in entity.get_points("xyb")) else ""
        if dxftype == "POLYLINE":
            points = [(vertex.dxf.location.x, vertex.dxf.location.y) for vertex in entity.vertices]
            closed = bool(entity.is_closed)
            length = polyline_length(points, closed) * unit_scale_mm
            area = polygon_area(points) * (unit_scale_mm / 1000.0) ** 2 if closed else ""
            return length, area, ""
        if dxftype == "DIMENSION":
            measurement = entity.get_measurement()
            return float(measurement) * unit_scale_mm, "", ""
    except Exception as error:
        return "", "", f"measurement error: {error}"
    return "", "", ""


def infer_unit_scale(doc, mapping):
    override = mapping.get("unitScaleToMm")
    if override not in ("", None):
        return float(override), "Mapping override", 0.7, ""
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    if insunits in INSUNITS_TO_MM:
        return INSUNITS_TO_MM[insunits], f"$INSUNITS={insunits}", 0.65, ""
    return 1.0, f"$INSUNITS={insunits or 'unitless'}", 0.3, "DWG/DXF units are missing or ambiguous; measurements require estimator confirmation."


def rule_matches(rule, inventory):
    entity_types = [str(value).upper() for value in rule.get("entityTypes", [])]
    if entity_types and inventory["entityType"].upper() not in entity_types:
        return False
    layer = inventory["layer"]
    if rule.get("layer") and layer != rule["layer"]:
        return False
    if rule.get("layerContains") and rule["layerContains"].lower() not in layer.lower():
        return False
    if rule.get("layerRegex") and not re.search(rule["layerRegex"], layer, re.IGNORECASE):
        return False
    min_length = rule.get("minLengthMm")
    max_length = rule.get("maxLengthMm")
    length = inventory.get("lengthMm")
    if min_length not in ("", None) and length not in ("", None) and float(length) < float(min_length):
        return False
    if max_length not in ("", None) and length not in ("", None) and float(length) > float(max_length):
        return False
    return True


def map_inventory_row(inventory, rules):
    for rule in rules:
        if rule_matches(rule, inventory):
            return rule
    return None


def measurement_from_inventory(inventory, rule, mapping, override, index):
    measurement_type = rule.get("measurementType", "linear")
    if measurement_type == "linear" and inventory.get("lengthMm") in ("", None):
        return None
    if measurement_type == "area" and inventory.get("areaM2") in ("", None):
        return None

    base_id = rule.get("idPrefix") or f"DWG-{clean_id(Path(inventory['sourceDwg']).stem)}"
    import_id = clean_id(f"{base_id}-{inventory['layout']}-{inventory['handle'] or index + 1}")
    source_value = inventory.get("lengthMm") if measurement_type == "linear" else inventory.get("areaM2") if measurement_type == "area" else 1
    value = round(float(source_value) / 1000.0, 3) if measurement_type == "linear" else round(float(source_value), 3) if measurement_type == "area" else 1
    unit = "m" if measurement_type == "linear" else "m2" if measurement_type == "area" else "ea"
    confidence = min(float(rule.get("confidence", 0.6)), float(inventory.get("unitConfidence") or 0.6))
    notes = [
        rule.get("notes", ""),
        inventory.get("unitWarning", ""),
        inventory.get("measurementNote", ""),
        f"DWG layer {inventory['layer']} entity {inventory['entityType']} handle {inventory['handle']}",
    ]
    measurement = {
        "id": import_id,
        "project": rule.get("project") or mapping.get("project") or "",
        "sourceSystem": "DWG",
        "sourceDwg": inventory["sourceDwg"],
        "sourcePdf": inventory["sourceDwg"],
        "sourceLayout": inventory["layout"],
        "sourceLayer": inventory["layer"],
        "sourceEntityType": inventory["entityType"],
        "sourceEntityHandle": inventory["handle"],
        "pageNumber": int(rule.get("pageNumber") or 1),
        "sheetNumber": rule.get("sheetNumber") or inventory["layout"] or "Model",
        "drawingRevision": rule.get("drawingRevision") or mapping.get("drawingRevision") or "TBA",
        "calibrationSource": rule.get("calibrationSource") or inventory["unitSource"],
        "measurementType": measurement_type,
        "tradeComponent": rule.get("tradeComponent") or "DWG Candidate",
        "targetWorkbookSheet": rule.get("targetWorkbookSheet") or "Wall Measurements",
        "site": rule.get("site") or "TBA",
        "level": rule.get("level") or "TBA",
        "wallId": rule.get("wallId") or "",
        "zoneId": rule.get("zoneId") or "",
        "openingId": rule.get("openingId") or "",
        "sourceValue": round(float(source_value), 3),
        "sourceUnit": "mm" if measurement_type == "linear" else unit,
        "value": value,
        "unit": unit,
        "reviewStatus": rule.get("reviewStatus") or "Needs Review",
        "reviewer": rule.get("reviewer") or "",
        "reviewedDate": rule.get("reviewedDate") or "",
        "conditionName": rule.get("conditionName") or rule.get("tradeComponent") or "DWG Candidate",
        "confidence": round(confidence, 3),
        "notes": " | ".join(str(part) for part in notes if part),
    }
    if measurement_type == "linear":
        measurement["valueM"] = value
        measurement["valueMm"] = round(float(source_value), 0)
    if measurement_type == "area":
        measurement["valueM2"] = value

    if override:
        measurement["reviewStatus"] = override.get("reviewStatus") or override.get("Review Status") or measurement["reviewStatus"]
        measurement["reviewer"] = override.get("reviewer") or override.get("Reviewer") or measurement["reviewer"]
        measurement["reviewedDate"] = override.get("reviewedDate") or override.get("Reviewed Date") or measurement["reviewedDate"]
        extra_notes = override.get("notes") or override.get("Notes") or ""
        if extra_notes:
            measurement["notes"] = f"{measurement['notes']} | Review override: {extra_notes}"
    return measurement


def collect_spaces(doc):
    spaces = [("Model", doc.modelspace())]
    for layout in doc.layouts:
        if layout.name != "Model":
            spaces.append((layout.name, layout))
    return spaces


def main():
    args = parse_args()
    try:
        import ezdxf
    except ModuleNotFoundError:
        print("Missing Python package 'ezdxf'. Use a Python environment with ezdxf installed and pass it via -PythonExe.", file=sys.stderr)
        return 2

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    layer_summary_csv = args.layer_summary_csv or str(output_dir / "dwg_layer_summary.csv")
    entity_inventory_csv = args.entity_inventory_csv or str(output_dir / "dwg_entity_inventory.csv")
    review_csv = args.review_csv or str(output_dir / "dwg_takeoff_review.csv")
    summary_json = args.summary_json or str(output_dir / "dwg_takeoff_extractor_summary.json")
    mapping = load_json(args.mapping, {})
    if args.project and not mapping.get("project"):
        mapping["project"] = args.project
    rules = mapping.get("rules") or mapping.get("mappings") or []
    overrides = load_review_overrides(args.review_overrides)
    dwg_lookup = {path.stem.lower(): path.name for path in Path(args.dwg_dir).glob("*.dwg")} if args.dwg_dir else {}

    inventory_rows = []
    measurements = []
    layer_stats = {}
    unit_warnings = []
    dxf_paths = sorted(Path(args.dxf_dir).glob("*.dxf"))
    if not dxf_paths:
        raise FileNotFoundError(f"No DXF files found in {args.dxf_dir}")

    for dxf_path in dxf_paths:
        doc = ezdxf.readfile(dxf_path)
        unit_scale_mm, unit_source, unit_confidence, unit_warning = infer_unit_scale(doc, mapping)
        if unit_warning:
            unit_warnings.append(f"{dxf_path.name}: {unit_warning}")
        source_dwg = dwg_lookup.get(dxf_path.stem.lower(), f"{dxf_path.stem}.dwg")
        for layout_name, space in collect_spaces(doc):
            for entity in space:
                layer = getattr(entity.dxf, "layer", "")
                length_mm, area_m2, measurement_note = entity_measurement(entity, unit_scale_mm)
                inventory = {
                    "sourceDxf": dxf_path.name,
                    "sourceDwg": source_dwg,
                    "layout": layout_name,
                    "layer": layer,
                    "entityType": entity.dxftype(),
                    "handle": getattr(entity.dxf, "handle", ""),
                    "blockName": getattr(entity.dxf, "name", "") if entity.dxftype() == "INSERT" else "",
                    "text": entity_text(entity),
                    "attributes": insert_attributes(entity) if entity.dxftype() == "INSERT" else "",
                    "lengthMm": round(length_mm, 3) if length_mm != "" else "",
                    "areaM2": round(area_m2, 3) if area_m2 != "" else "",
                    "unitSource": unit_source,
                    "unitScaleMm": unit_scale_mm,
                    "unitConfidence": unit_confidence,
                    "unitWarning": unit_warning,
                    "measurementNote": measurement_note,
                }
                inventory_rows.append(inventory)
                key = (source_dwg, layout_name, layer)
                if key not in layer_stats:
                    layer_stats[key] = {"entityCount": 0, "linearMm": 0.0, "areaM2": 0.0}
                layer_stats[key]["entityCount"] += 1
                if isinstance(inventory["lengthMm"], (int, float)):
                    layer_stats[key]["linearMm"] += float(inventory["lengthMm"])
                if isinstance(inventory["areaM2"], (int, float)):
                    layer_stats[key]["areaM2"] += float(inventory["areaM2"])

                rule = map_inventory_row(inventory, rules)
                if rule and not args.inventory_only:
                    base_id = rule.get("idPrefix") or f"DWG-{clean_id(Path(inventory['sourceDwg']).stem)}"
                    candidate_id = clean_id(f"{base_id}-{inventory['layout']}-{inventory['handle'] or len(measurements) + 1}")
                    measurement = measurement_from_inventory(inventory, rule, mapping, overrides.get(candidate_id), len(measurements))
                    if measurement:
                        measurements.append(measurement)

    layer_rows = [
        {
            "sourceDwg": key[0],
            "layout": key[1],
            "layer": key[2],
            "entityCount": value["entityCount"],
            "linearM": round(value["linearMm"] / 1000.0, 3),
            "areaM2": round(value["areaM2"], 3),
        }
        for key, value in sorted(layer_stats.items())
    ]
    csv_escape_rows(layer_summary_csv, ["sourceDwg", "layout", "layer", "entityCount", "linearM", "areaM2"], layer_rows)
    csv_escape_rows(entity_inventory_csv, [
        "sourceDxf", "sourceDwg", "layout", "layer", "entityType", "handle", "blockName", "text", "attributes",
        "lengthMm", "areaM2", "unitSource", "unitScaleMm", "unitConfidence", "unitWarning", "measurementNote",
    ], inventory_rows)
    csv_escape_rows(review_csv, [
        "importId", "conditionName", "targetWorkbookSheet", "measurementType", "tradeComponent", "site", "level",
        "value", "unit", "reviewStatus", "sourceDwg", "layout", "layer", "entityHandle", "confidence", "notes",
    ], [
        {
            "importId": row["id"],
            "conditionName": row.get("conditionName", ""),
            "targetWorkbookSheet": row.get("targetWorkbookSheet", ""),
            "measurementType": row.get("measurementType", ""),
            "tradeComponent": row.get("tradeComponent", ""),
            "site": row.get("site", ""),
            "level": row.get("level", ""),
            "value": row.get("value", ""),
            "unit": row.get("unit", ""),
            "reviewStatus": row.get("reviewStatus", ""),
            "sourceDwg": row.get("sourceDwg", ""),
            "layout": row.get("sourceLayout", ""),
            "layer": row.get("sourceLayer", ""),
            "entityHandle": row.get("sourceEntityHandle", ""),
            "confidence": row.get("confidence", ""),
            "notes": row.get("notes", ""),
        }
        for row in measurements
    ])

    if not args.inventory_only:
        import_path = Path(args.import_json)
        import_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "project": mapping.get("project") or args.project or "",
            "source": {
                "system": "DWG",
                "importedAt": datetime.now(timezone.utc).isoformat(),
                "sourceDir": str(Path(args.dwg_dir).resolve()) if args.dwg_dir else "",
                "mappingFile": Path(args.mapping).name,
            },
            "measurements": measurements,
        }
        import_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    summary = {
        "kind": "dwg-takeoff-extractor-summary",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "dxfFileCount": len(dxf_paths),
        "entityCount": len(inventory_rows),
        "layerCount": len(layer_rows),
        "measurementCount": len(measurements),
        "reviewOverrideCount": len(overrides),
        "unitWarnings": unit_warnings,
        "inventoryOnly": args.inventory_only,
        "outputs": {
            "layerSummaryCsv": str(Path(layer_summary_csv).resolve()),
            "entityInventoryCsv": str(Path(entity_inventory_csv).resolve()),
            "reviewCsv": str(Path(review_csv).resolve()),
            "importJson": "" if args.inventory_only else str(Path(args.import_json).resolve()),
        },
    }
    Path(summary_json).parent.mkdir(parents=True, exist_ok=True)
    Path(summary_json).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

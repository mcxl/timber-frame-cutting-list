import fs from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("outputs", "wall_frame_fabrication_sequence");
const svgDir = path.join(outputDir, "svg");
await fs.mkdir(svgDir, { recursive: true });

const page = { w: 1600, h: 1100 };

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(x, y, value, cls = "label", extra = "") {
  return `<text x="${x}" y="${y}" class="${cls}" ${extra}>${esc(value)}</text>`;
}

function mtext(x, y, lines, cls = "note", lineHeight = 22) {
  return lines.map((line, index) => text(x, y + index * lineHeight, line, cls)).join("\n");
}

function line(x1, y1, x2, y2, cls = "line", extra = "") {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" ${extra}/>`;
}

function rect(x, y, w, h, cls = "line", extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}" ${extra}/>`;
}

function circle(cx, cy, r, cls = "line", extra = "") {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" class="${cls}" ${extra}/>`;
}

function pathEl(d, cls = "line", extra = "") {
  return `<path d="${d}" class="${cls}" ${extra}/>`;
}

function dimH(x1, x2, y, label, above = true) {
  const ty = above ? y - 10 : y + 24;
  return `
    ${line(x1, y, x2, y, "dim", 'marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"')}
    ${line(x1, y - 20, x1, y + 20, "dim")}
    ${line(x2, y - 20, x2, y + 20, "dim")}
    ${text((x1 + x2) / 2, ty, label, "dimText", 'text-anchor="middle"')}
  `;
}

function dimV(x, y1, y2, label, right = true) {
  const tx = right ? x + 12 : x - 12;
  const anchor = right ? "start" : "end";
  return `
    ${line(x, y1, x, y2, "dim", 'marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"')}
    ${line(x - 18, y1, x + 18, y1, "dim")}
    ${line(x - 18, y2, x + 18, y2, "dim")}
    <text x="${tx}" y="${(y1 + y2) / 2}" class="dimText" text-anchor="${anchor}" transform="rotate(-90 ${tx} ${(y1 + y2) / 2})">${esc(label)}</text>
  `;
}

function studs(x, yTop, yBottom, start, end, spacing, cls = "stud") {
  const items = [];
  for (let xPos = start; xPos <= end + 0.1; xPos += spacing) {
    items.push(rect(x + xPos - 3, yTop, 6, yBottom - yTop, cls));
  }
  return items.join("\n");
}

function titleBlock(sheetNo, title, subtitle) {
  return `
    ${rect(40, 36, 1520, 76, "titleBox")}
    ${text(64, 78, title, "title")}
    ${text(64, 101, subtitle, "subtitle")}
    ${text(1396, 76, sheetNo, "sheetNo")}
    ${text(1396, 101, "Wall-frame workflow", "titleMeta")}
    ${rect(40, 1010, 1520, 54, "titleBox")}
    ${text(64, 1042, "Notes: Example workflow drawing only. Final fabrication drawings must be reconciled to reviewed DWG/DXF geometry, engineering tie-down schedule, AS 1684 checks and approved plans.", "footer")}
  `;
}

function sheetSvg(sheetNo, title, subtitle, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${page.w}" height="${page.h}" viewBox="0 0 ${page.w} ${page.h}">
  <defs>
    <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 Z" fill="#111827"/>
    </marker>
    <marker id="dimArrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#374151" stroke-width="1.4"/>
    </marker>
    <pattern id="braceHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="10" stroke="#166534" stroke-width="2"/>
    </pattern>
    <style>
      svg { background: #ffffff; }
      text { font-family: Arial, Helvetica, sans-serif; fill: #111827; }
      .title { font-size: 28px; font-weight: 700; letter-spacing: 0; }
      .subtitle { font-size: 15px; fill: #374151; }
      .sheetNo { font-size: 28px; font-weight: 700; text-anchor: start; }
      .titleMeta { font-size: 13px; fill: #4b5563; }
      .footer { font-size: 13px; fill: #374151; }
      .label { font-size: 15px; font-weight: 700; }
      .labelSmall { font-size: 12px; font-weight: 700; }
      .note { font-size: 13px; fill: #374151; }
      .noteSmall { font-size: 11px; fill: #4b5563; }
      .dimText { font-size: 12px; fill: #374151; font-weight: 700; }
      .line { fill: none; stroke: #111827; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .thin { fill: none; stroke: #4b5563; stroke-width: 1.2; vector-effect: non-scaling-stroke; }
      .dashed { fill: none; stroke: #4b5563; stroke-width: 1.5; stroke-dasharray: 8 6; vector-effect: non-scaling-stroke; }
      .wall { fill: none; stroke: #111827; stroke-width: 16; stroke-linecap: square; vector-effect: non-scaling-stroke; }
      .internalWall { fill: none; stroke: #374151; stroke-width: 10; stroke-linecap: square; vector-effect: non-scaling-stroke; }
      .opening { fill: #dbeafe; stroke: #2563eb; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .openingGap { fill: none; stroke: #ffffff; stroke-width: 20; stroke-linecap: square; vector-effect: non-scaling-stroke; }
      .brace { fill: url(#braceHatch); stroke: #166534; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .hold { fill: #fee2e2; stroke: #dc2626; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .stud { fill: #e5e7eb; stroke: #111827; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
      .plate { fill: #d1d5db; stroke: #111827; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
      .nogging { fill: #f3f4f6; stroke: #4b5563; stroke-width: 1.2; vector-effect: non-scaling-stroke; }
      .panelFill { fill: #f8fafc; stroke: #111827; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .packPanel { fill: #f3f4f6; stroke: #111827; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .seq { fill: #eef2ff; stroke: #4f46e5; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .titleBox { fill: #f8fafc; stroke: #cbd5e1; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
      .tableHead { fill: #111827; stroke: #111827; stroke-width: 1; }
      .tableHeadText { font-size: 12px; fill: #ffffff; font-weight: 700; }
      .tableText { font-size: 11px; fill: #111827; }
      .tag { fill: #fef3c7; stroke: #92400e; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
      .slab { fill: #f8fafc; stroke: #94a3b8; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .legendBox { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
      .dim { fill: none; stroke: #374151; stroke-width: 1.3; vector-effect: non-scaling-stroke; }
    </style>
  </defs>
  ${titleBlock(sheetNo, title, subtitle)}
  ${body}
</svg>`;
}

function sheet01() {
  const walls = `
    ${rect(150, 155, 1000, 660, "slab")}
    ${line(170, 175, 1130, 175, "wall")}
    ${line(1130, 175, 1130, 795, "wall")}
    ${line(1130, 795, 170, 795, "wall")}
    ${line(170, 795, 170, 175, "wall")}
    ${line(520, 175, 520, 795, "internalWall")}
    ${line(170, 420, 1130, 420, "internalWall")}
    ${line(820, 420, 820, 795, "internalWall")}
    ${line(350, 175, 470, 175, "openingGap")}
    ${rect(350, 156, 120, 38, "opening")}
    ${text(362, 150, "W01", "labelSmall")}
    ${line(1130, 345, 1130, 465, "openingGap")}
    ${rect(1111, 345, 38, 120, "opening")}
    ${text(1160, 405, "D01", "labelSmall")}
    ${line(600, 795, 720, 795, "openingGap")}
    ${rect(600, 776, 120, 38, "opening")}
    ${text(660, 804, "D02", "labelSmall", 'text-anchor="middle"')}
    ${line(520, 270, 520, 350, "openingGap")}
    ${rect(501, 270, 38, 80, "opening")}
    ${text(542, 318, "D03", "labelSmall")}
  `;
  const labels = [
    text(590, 138, "GF-W01", "label", 'text-anchor="middle"'),
    text(1184, 490, "GF-W02", "label", 'transform="rotate(90 1184 490)" text-anchor="middle"'),
    text(650, 868, "GF-W03", "label", 'text-anchor="middle"'),
    text(118, 490, "GF-W04", "label", 'transform="rotate(-90 118 490)" text-anchor="middle"'),
    text(548, 310, "GF-W05", "label", 'transform="rotate(90 548 310)" text-anchor="middle"'),
    text(650, 397, "GF-W06", "label", 'text-anchor="middle"'),
    text(848, 610, "GF-W07", "label", 'transform="rotate(90 848 610)" text-anchor="middle"'),
  ].join("\n");
  const junctions = [
    [170, 175, "J01"], [1130, 175, "J02"], [1130, 795, "J03"], [170, 795, "J04"],
    [520, 420, "J05"], [820, 420, "J06"], [520, 795, "J07"], [820, 795, "J08"],
  ].map(([x, y, id]) => `${circle(x, y, 15, "tag")}${text(x, y + 5, id, "labelSmall", 'text-anchor="middle"')}`).join("\n");
  const orientation = `
    ${line(240, 250, 355, 250, "thin", 'marker-end="url(#arrow)"')}
    ${text(238, 238, "outside face", "noteSmall")}
    ${line(355, 310, 240, 310, "thin", 'marker-end="url(#arrow)"')}
    ${text(260, 332, "inside face", "noteSmall")}
    ${line(980, 700, 900, 700, "thin", 'marker-end="url(#arrow)"')}
    ${text(910, 690, "orientation", "noteSmall")}
  `;
  const legend = `
    ${rect(1210, 160, 300, 250, "legendBox")}
    ${text(1230, 194, "Legend", "label")}
    ${line(1232, 226, 1322, 226, "wall")}${text(1350, 232, "External wall frame", "note")}
    ${line(1232, 268, 1322, 268, "internalWall")}${text(1350, 274, "Internal wall frame", "note")}
    ${rect(1232, 295, 70, 24, "opening")}${text(1350, 313, "Door/window opening", "note")}
    ${circle(1265, 348, 13, "tag")}${text(1350, 354, "Junction ID", "note")}
    ${line(1232, 382, 1302, 382, "thin", 'marker-end="url(#arrow)"')}${text(1350, 388, "Orientation arrow", "note")}
    ${rect(1210, 450, 300, 172, "legendBox")}
    ${text(1230, 482, "Manufacturer use", "label")}
    ${mtext(1230, 512, [
      "1. Assign wall IDs from plan.",
      "2. Confirm inside/outside face.",
      "3. Mark junction IDs for site setout.",
      "4. Link openings to wall IDs before shop drawings.",
    ])}
  `;
  return sheetSvg("A01", "Overall floor / wall layout", "Slab or floor platform plan with wall IDs, openings, junctions and orientation", walls + labels + junctions + orientation + legend);
}

function sheet02() {
  const x0 = 140;
  const y0 = 300;
  const width = 1180;
  const height = 300;
  const panelW = [354, 472, 354];
  let x = x0;
  const panels = panelW.map((w, idx) => {
    const id = `GF-W01-P${idx + 1}`;
    const g = `${rect(x, y0, w, height, "panelFill")}${text(x + w / 2, y0 - 18, id, "label", 'text-anchor="middle"')}${line(x, y0 - 40, x, y0 + height + 40, "dashed")}`;
    x += w;
    return g;
  }).join("\n");
  const endBoundary = line(x0 + width, y0 - 40, x0 + width, y0 + height + 40, "dashed");
  const plates = `
    ${rect(x0, y0, width, 18, "plate")}
    ${rect(x0, y0 + 282, width, 18, "plate")}
    ${rect(x0, y0 + 24, width, 18, "plate")}
    ${text(x0 + width + 24, y0 + 17, "top plate", "note")}
    ${text(x0 + width + 24, y0 + 303, "bottom plate", "note")}
  `;
  const studSet = studs(x0, y0 + 18, y0 + 282, 0, width, 44.25);
  const opening = `
    ${rect(x0 + 505, y0 + 92, 180, 145, "opening")}
    ${rect(x0 + 492, y0 + 75, 206, 24, "plate")}
    ${rect(x0 + 492, y0 + 235, 206, 18, "plate")}
    ${rect(x0 + 480, y0 + 75, 10, 207, "stud")}
    ${rect(x0 + 700, y0 + 75, 10, 207, "stud")}
    ${text(x0 + 595, y0 + 126, "window opening", "labelSmall", 'text-anchor="middle"')}
    ${text(x0 + 595, y0 + 91, "lintel", "labelSmall", 'text-anchor="middle"')}
    ${text(x0 + 595, y0 + 264, "sill trimmer", "labelSmall", 'text-anchor="middle"')}
  `;
  const noggings = `
    ${rect(x0, y0 + 125, width, 14, "nogging")}
    ${rect(x0, y0 + 208, width, 14, "nogging")}
    ${text(x0 + width + 24, y0 + 137, "nogging row", "note")}
    ${text(x0 + width + 24, y0 + 220, "nogging row", "note")}
  `;
  const brace = `
    ${rect(x0 + 920, y0 + 44, 210, 210, "brace")}
    ${pathEl(`M${x0 + 930} ${y0 + 245} L${x0 + 1120} ${y0 + 55}`, "line")}
    ${text(x0 + 1025, y0 + 154, "bracing", "labelSmall", 'text-anchor="middle"')}
  `;
  const holds = [x0 + 10, x0 + 352, x0 + 826, x0 + 1170].map((hx, i) => `
    ${rect(hx - 10, y0 + 302, 20, 34, "hold")}
    ${text(hx, y0 + 354, `HD0${i + 1}`, "labelSmall", 'text-anchor="middle"')}
  `).join("\n");
  const dims = `
    ${dimH(x0, x0 + width, y0 + height + 80, "GF-W01 overall 12000 outside-to-outside")}
    ${dimH(x0, x0 + panelW[0], y0 + height + 42, "P1 3600")}
    ${dimH(x0 + panelW[0], x0 + panelW[0] + panelW[1], y0 + height + 42, "P2 4800")}
    ${dimH(x0 + panelW[0] + panelW[1], x0 + width, y0 + height + 42, "P3 3600")}
  `;
  const notes = `
    ${rect(120, 150, 1340, 96, "legendBox")}
    ${mtext(145, 184, [
      "Panel breakdown splits long wall GF-W01 into transportable factory panels. Panel joints are set at reviewed locations and checked against openings, hold-downs and bracing layout.",
      "Australian terminology shown: bottom plate, top plate, common studs, jamb studs, lintel, sill trimmer, noggings, bracing panel and hold-down brackets."
    ], "note", 24)}
  `;
  return sheetSvg("A02", "Wall panel breakdown", "Panels, joints, plate/stud framing, openings, bracing and hold-down locations", notes + panels + endBoundary + studSet + noggings + plates + opening + brace + holds + dims);
}

function sampleWallElevation(x0, y0, scale = 1, options = {}) {
  const length = 720 * scale;
  const height = 405 * scale;
  const openX = x0 + 265 * scale;
  const openY = y0 + 135 * scale;
  const openW = 270 * scale;
  const openH = 180 * scale;
  const s = scale;
  return `
    ${rect(x0, y0, length, height, "panelFill")}
    ${rect(x0, y0, length, 18 * s, "plate")}
    ${rect(x0, y0 + 22 * s, length, 14 * s, "plate")}
    ${rect(x0, y0 + height - 18 * s, length, 18 * s, "plate")}
    ${studs(x0, y0 + 36 * s, y0 + height - 18 * s, 0, length, 67.5 * s)}
    ${rect(openX - 18 * s, openY - 25 * s, 18 * s, openH + 25 * s + 72 * s, "stud")}
    ${rect(openX - 38 * s, openY - 25 * s, 18 * s, openH + 25 * s + 72 * s, "stud")}
    ${rect(openX + openW, openY - 25 * s, 18 * s, openH + 25 * s + 72 * s, "stud")}
    ${rect(openX + openW + 20 * s, openY - 25 * s, 18 * s, openH + 25 * s + 72 * s, "stud")}
    ${rect(openX - 38 * s, openY - 48 * s, openW + 76 * s, 28 * s, "plate")}
    ${rect(openX, openY + openH, openW, 20 * s, "plate")}
    ${rect(openX, openY, openW, openH, "opening")}
    ${rect(x0, y0 + 180 * s, length, 12 * s, "nogging")}
    ${rect(x0, y0 + 306 * s, length, 12 * s, "nogging")}
    ${rect(x0 + 44 * s, y0 + 60 * s, 145 * s, 286 * s, "brace")}
    ${rect(x0 + 12 * s, y0 + height + 7 * s, 24 * s, 36 * s, "hold")}
    ${rect(x0 + length - 36 * s, y0 + height + 7 * s, 24 * s, 36 * s, "hold")}
    ${options.labels === false ? "" : `
      ${text(x0 + length / 2, y0 - 20 * s, "GF-W01-P2 sample wall elevation", "label", 'text-anchor="middle"')}
      ${text(openX + openW / 2, openY + openH / 2, "W01", "labelSmall", 'text-anchor="middle"')}
      ${text(x0 + 115 * s, y0 + 118 * s, "brace panel", "labelSmall", 'text-anchor="middle"')}
      ${text(openX + openW / 2, openY - 31 * s, "2/190x45 LVL15 lintel", "labelSmall", 'text-anchor="middle"')}
      ${text(openX + openW + 52 * s, openY + openH + 22 * s, "sill trimmer", "labelSmall")}
    `}
  `;
}

function sheet03() {
  const x0 = 150;
  const y0 = 230;
  const elevation = sampleWallElevation(x0, y0, 1);
  const dims = `
    ${dimH(x0, x0 + 720, y0 + 485, "overall length 4800")}
    ${dimV(x0 + 790, y0, y0 + 405, "wall height 2700")}
    ${dimH(x0 + 265, x0 + 535, y0 + 350, "opening 1800")}
    ${dimV(x0 + 615, y0 + 135, y0 + 315, "opening height 1200")}
    ${dimV(x0 + 76, y0 + 315, y0 + 405, "sill 900", false)}
  `;
  const notes = `
    ${rect(1010, 220, 430, 430, "legendBox")}
    ${text(1036, 255, "Shop drawing notes", "label")}
    ${mtext(1036, 288, [
      "Wall ID: GF-W01",
      "Panel ID: GF-W01-P2",
      "Level: Ground floor",
      "Overall length: 4800 mm",
      "Frame height: 2700 mm",
      "Stud spacing: 450 mm c/c",
      "Stud/plate section: 90x45 MGP10 H2",
      "Nogging rows: 1200 and 2100 nominal",
      "Opening: W01, 1800w x 1200h",
      "Lintel: 2/190x45 LVL15, engineer confirm",
      "Bracing: structural ply panel, fix per bracing schedule",
      "Tie-down: HD01 each end, M12 anchor/strap per engineer"
    ], "note", 25)}
    ${rect(1010, 690, 430, 155, "legendBox")}
    ${mtext(1036, 724, [
      "Dimension rule:",
      "Setout is outside-to-outside from left datum.",
      "Inside/outside face must match layout arrow.",
      "Final dimensions require reviewed DWG/DXF geometry."
    ], "note", 24)}
  `;
  return sheetSvg("A03", "Individual wall elevation sheet", "Sample manufacturer shop drawing style wall elevation with dimensions and notes", elevation + dims + notes);
}

function table(x, y, columns, rows, widths, rowH = 34) {
  const totalW = widths.reduce((sum, value) => sum + value, 0);
  let out = `${rect(x, y, totalW, rowH, "tableHead")}`;
  let cx = x;
  columns.forEach((col, i) => {
    out += text(cx + 8, y + 22, col, "tableHeadText");
    out += line(cx, y, cx, y + rowH * (rows.length + 1), "thin");
    cx += widths[i];
  });
  out += line(x + totalW, y, x + totalW, y + rowH * (rows.length + 1), "thin");
  rows.forEach((row, r) => {
    const ry = y + rowH * (r + 1);
    out += rect(x, ry, totalW, rowH, r % 2 ? "slab" : "legendBox");
    let tx = x;
    row.forEach((cell, i) => {
      out += text(tx + 8, ry + 22, cell, "tableText");
      tx += widths[i];
    });
  });
  return out;
}

function sheet04() {
  const elevation = sampleWallElevation(90, 225, 0.72, { labels: true });
  const dims = `${dimH(90, 90 + 518.4, 225 + 360, "4800")}${dimV(650, 225, 225 + 291.6, "2700")}`;
  const rows = [
    ["Top plate", "2", "90x45", "4800", "MGP10 H2", "GF-W01", "P2", "Double top plate"],
    ["Bottom plate", "1", "90x45", "4800", "MGP10 H2", "GF-W01", "P2", "Anchor setout from slab plan"],
    ["Common studs", "8", "90x45", "2700", "MGP10 H2", "GF-W01", "P2", "450 mm c/c"],
    ["Jamb studs", "4", "90x45", "2700", "MGP10 H2", "GF-W01", "P2", "Double jamb each side W01"],
    ["Lintel", "1", "2/190x45", "2100", "LVL15", "GF-W01", "P2", "Engineer confirm"],
    ["Sill trimmer", "1", "90x45", "1800", "MGP10 H2", "GF-W01", "P2", "Below W01"],
    ["Noggings", "14", "90x45", "varies", "MGP10 H2", "GF-W01", "P2", "Cut between studs"],
    ["Brace sheet", "1", "structural ply", "900x2400", "F11 ply", "GF-W01", "P2", "Fix per bracing schedule"],
    ["Hold-down", "2", "HD bracket", "each", "engineer", "GF-W01", "P2", "M12 anchor/strap per details"],
    ["Blocks", "4", "90x45", "fit", "MGP10 H2", "GF-W01", "P2", "Connector blocking"],
  ];
  const cutList = `
    ${text(790, 206, "Factory cut-list / assembly breakdown", "label")}
    ${table(790, 230, ["Member type", "Qty", "Section", "Length", "Grade", "Wall", "Panel", "Notes"], rows, [145, 45, 85, 75, 90, 70, 65, 185], 38)}
  `;
  const workflow = `
    ${rect(80, 635, 620, 245, "legendBox")}
    ${text(110, 670, "Assembly sequence at bench", "label")}
    ${mtext(110, 704, [
      "1. Lay bottom and top plates, mark stud/opening setout.",
      "2. Fit common studs, jamb studs, lintel and sill trimmer.",
      "3. Fit noggings, bracing sheet and connector blocking.",
      "4. Check overall length, height, diagonals and label panel.",
      "5. Stack in installation order after QA check."
    ], "note", 27)}
  `;
  return sheetSvg("A04", "Factory cut-list and assembly breakdown", "Member schedule beside sample wall elevation for manufacturer use", elevation + dims + cutList + workflow);
}

function qr(x, y, cell = 10) {
  const grid = [
    "1110111011",
    "1000100010",
    "1011110111",
    "0010010100",
    "1110101110",
    "0101110001",
    "1100101011",
    "0011100100",
    "1010011110",
    "1111010011",
  ];
  return grid.map((row, r) => [...row].map((value, c) => value === "1" ? rect(x + c * cell, y + r * cell, cell, cell, "line", 'fill="#111827" stroke="none"') : "").join("")).join("\n");
}

function sheet05() {
  const stack = `
    ${rect(260, 700, 850, 24, "plate")}
    ${rect(250, 725, 220, 28, "plate")}
    ${rect(900, 725, 220, 28, "plate")}
    ${[0, 1, 2, 3, 4].map((i) => `
      <g transform="translate(${210 + i * 18} ${250 + i * 42})">
        ${pathEl("M0 280 L760 220 L1040 300 L270 360 Z", "packPanel")}
        ${pathEl("M0 280 L270 360 L270 420 L0 340 Z", "panelFill")}
        ${pathEl("M270 360 L1040 300 L1040 360 L270 420 Z", "panelFill")}
        ${rect(62, 292, 180, 70, "tag")}
        ${text(78, 315, ["GF-W01-P1", "GF-W01-P2", "GF-W01-P3", "GF-W05-P1", "GF-W06-P1"][i], "labelSmall")}
        ${text(78, 336, `Level: Ground | Seq ${i + 1}`, "noteSmall")}
        ${text(78, 356, i < 3 ? "Outside face up" : "Inside face up", "noteSmall")}
      </g>
    `).join("\n")}
    ${line(245, 338, 1200, 670, "thin")}
    ${line(275, 780, 1230, 705, "thin")}
  `;
  const label = `
    ${rect(1155, 240, 300, 360, "legendBox")}
    ${text(1184, 276, "Pack label", "label")}
    ${rect(1184, 300, 220, 250, "tag")}
    ${text(1202, 330, "PACK A - GROUND FLOOR", "labelSmall")}
    ${text(1202, 356, "Install sequence: 1 to 8", "note")}
    ${text(1202, 382, "Orientation: outside face up", "note")}
    ${text(1202, 408, "Includes layout sheet A01", "note")}
    ${qr(1204, 430, 9)}
    ${text(1302, 505, "QR-style link", "noteSmall")}
    ${text(1202, 535, "Scan/check before unload", "noteSmall")}
  `;
  const notes = `
    ${rect(120, 150, 980, 82, "legendBox")}
    ${mtext(145, 184, [
      "Panels are stacked and strapped by installation order. Each panel has a durable label with wall ID, panel ID, level, face orientation and sequence.",
      "A laminated plan/layout sheet travels with the pack so site crew can sort panels before standing frames."
    ], "note", 24)}
    ${rect(120, 830, 1340, 105, "legendBox")}
    ${text(145, 865, "Packing checks", "label")}
    ${mtext(145, 894, [
      "Check pack list against cut-list, verify labels are visible from unloading side, protect bracing face, and keep hold-down hardware bagged/tagged by panel."
    ], "note", 24)}
  `;
  return sheetSvg("A05", "Labelling and packing for delivery", "Panel labels, pack sequence, orientation and laminated layout reference", notes + stack + label);
}

function seqBox(x, y, num, title, body) {
  return `
    ${rect(x, y, 320, 105, "seq")}
    ${circle(x + 30, y + 32, 20, "tag")}
    ${text(x + 30, y + 39, num, "labelSmall", 'text-anchor="middle"')}
    ${text(x + 62, y + 30, title, "labelSmall")}
    ${mtext(x + 62, y + 55, body, "noteSmall", 18)}
  `;
}

function sheet06() {
  const boxes = [
    [85, 170, "1", "Check slab/floor dimensions", ["Confirm setout, rebates,", "anchor zones and tolerances."]],
    [465, 170, "2", "Mark wall lines", ["Snap chalk lines from", "approved floor layout."]],
    [845, 170, "3", "Mark wall IDs", ["Write GF-W IDs and", "junction IDs on slab."]],
    [1225, 170, "4", "Sort panels", ["Unload by pack order", "and face orientation."]],
    [85, 760, "5", "Stand external corners", ["Start with corner panels", "GF-W01/GF-W04."]],
    [465, 760, "6", "Plumb, brace and fix", ["Temporary brace, check", "diagonal and fix plates."]],
    [845, 760, "7", "Install internal walls", ["Stand remaining panels", "from junction setout."]],
    [1225, 760, "8", "Tie-down/bracing checks", ["Complete anchors, straps", "and bracing inspection."]],
  ].map((args) => seqBox(...args)).join("\n");
  const arrows = `
    ${line(405, 222, 465, 222, "thin", 'marker-end="url(#arrow)"')}
    ${line(785, 222, 845, 222, "thin", 'marker-end="url(#arrow)"')}
    ${line(1165, 222, 1225, 222, "thin", 'marker-end="url(#arrow)"')}
    ${pathEl("M1385 275 C1440 425 1440 615 1385 760", "thin", 'marker-end="url(#arrow)"')}
    ${line(1225, 812, 1165, 812, "thin", 'marker-end="url(#arrow)"')}
    ${line(845, 812, 785, 812, "thin", 'marker-end="url(#arrow)"')}
    ${line(465, 812, 405, 812, "thin", 'marker-end="url(#arrow)"')}
  `;
  const plan = `
    ${rect(360, 345, 860, 300, "slab")}
    ${line(382, 365, 1198, 365, "wall")}
    ${line(1198, 365, 1198, 625, "wall")}
    ${line(1198, 625, 382, 625, "wall")}
    ${line(382, 625, 382, 365, "wall")}
    ${line(680, 365, 680, 625, "internalWall")}
    ${line(382, 492, 1198, 492, "internalWall")}
    ${circle(382, 365, 14, "tag")}${text(382, 370, "J01", "labelSmall", 'text-anchor="middle"')}
    ${circle(1198, 365, 14, "tag")}${text(1198, 370, "J02", "labelSmall", 'text-anchor="middle"')}
    ${text(790, 334, "Site frame standing sequence plan", "label", 'text-anchor="middle"')}
    ${text(790, 390, "External corner panels first", "note", 'text-anchor="middle"')}
    ${line(500, 705, 500, 650, "thin", 'marker-end="url(#arrow)"')}
    ${text(430, 730, "temporary brace and plumb check", "noteSmall")}
  `;
  const checks = `
    ${rect(300, 660, 980, 75, "legendBox")}
    ${mtext(326, 692, [
      "Site crew uses the laminated layout sheet, panel labels and wall IDs marked on the slab/floor. Final fixing follows engineering tie-down and bracing schedules."
    ], "note", 23)}
  `;
  return sheetSvg("A06", "Site installation sequence", "Numbered workflow from slab setout through tie-down and bracing checks", boxes + arrows + plan + checks);
}

const sheets = [
  ["A01-overall-floor-wall-layout.svg", sheet01()],
  ["A02-wall-panel-breakdown.svg", sheet02()],
  ["A03-individual-wall-elevation.svg", sheet03()],
  ["A04-factory-cut-list-assembly.svg", sheet04()],
  ["A05-labelling-packing.svg", sheet05()],
  ["A06-site-installation-sequence.svg", sheet06()],
];

for (const [fileName, svg] of sheets) {
  await fs.writeFile(path.join(svgDir, fileName), svg, "utf8");
}

const index = `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Australian Wall Frame Fabrication and Installation Sequence</title>
  <style>
    :root { color-scheme: light; --ink: #111827; --muted: #4b5563; --line: #cbd5e1; --paper: #ffffff; --bg: #e5e7eb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Arial, Helvetica, sans-serif; }
    header { position: sticky; top: 0; z-index: 2; background: #f8fafc; border-bottom: 1px solid var(--line); padding: 14px 24px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    .meta { margin-top: 4px; color: var(--muted); font-size: 13px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    nav a { color: var(--ink); border: 1px solid var(--line); background: white; padding: 6px 9px; border-radius: 4px; text-decoration: none; font-size: 12px; }
    main { max-width: 1460px; margin: 0 auto; padding: 24px; }
    .sheet { margin: 0 0 28px; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 2px 10px rgba(15, 23, 42, 0.12); }
    .sheet h2 { margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 16px; }
    .sheet img { width: 100%; display: block; background: white; }
    .download { padding: 0 16px 14px; }
    .download a { color: #1d4ed8; font-size: 12px; }
    @media print {
      header, .download { display: none; }
      body { background: white; }
      main { padding: 0; max-width: none; }
      .sheet { break-after: page; margin: 0; border: none; box-shadow: none; }
      .sheet h2 { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Australian Residential Wall-Frame Fabrication and Installation Drawing Sequence</h1>
    <div class="meta">Interim technical workflow drawing set. Example data only. Use reviewed DWG/DXF geometry and approved engineering for final shop drawings.</div>
    <nav>
      ${sheets.map(([fileName], index) => `<a href="#sheet-${index + 1}">${fileName.slice(0, 3)}</a>`).join("\n      ")}
    </nav>
  </header>
  <main>
    ${sheets.map(([fileName], index) => `
    <section class="sheet" id="sheet-${index + 1}">
      <h2>${fileName.replace(".svg", "").replace(/-/g, " ")}</h2>
      <img src="svg/${fileName}" alt="${fileName.replace(".svg", "")}">
      <div class="download"><a href="svg/${fileName}">Open standalone SVG</a></div>
    </section>`).join("\n")}
  </main>
</body>
</html>`;

await fs.writeFile(path.join(outputDir, "index.html"), index, "utf8");

const manifest = {
  kind: "wall-frame-fabrication-sequence",
  generatedAtUtc: new Date().toISOString(),
  status: "interim-example",
  note: "Example explanatory drawing set. Not project-certified shop drawings.",
  outputs: {
    indexHtml: path.join(outputDir, "index.html"),
    svgDir,
    sheets: sheets.map(([fileName]) => path.join(svgDir, fileName)),
  },
};
await fs.writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(JSON.stringify(manifest, null, 2));

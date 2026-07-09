import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "outputs", "wall_frame_sequence");
const TMP_DIR = path.join(ROOT, "tmp", "pdfs", "wall_frame_sequence");
const HTML_PATH = path.join(OUT_DIR, "wall_frame_fabrication_installation_sequence.html");
const PDF_PATH = path.join(OUT_DIR, "wall_frame_fabrication_installation_sequence.pdf");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const W = 1600;
const H = 1131;
const DRAWING_DATE = "09 Jul 2026";

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attrs(obj = {}) {
  return Object.entries(obj)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ");
}

function g(content, options = {}) {
  return `<g ${attrs(options)}>${content}</g>`;
}

function line(x1, y1, x2, y2, options = {}) {
  return `<line ${attrs({ x1, y1, x2, y2, ...options })}/>`;
}

function rect(x, y, width, height, options = {}) {
  return `<rect ${attrs({ x, y, width, height, ...options })}/>`;
}

function circle(cx, cy, r, options = {}) {
  return `<circle ${attrs({ cx, cy, r, ...options })}/>`;
}

function polygon(points, options = {}) {
  return `<polygon points="${points.map(([x, y]) => `${x},${y}`).join(" ")}" ${attrs(options)}/>`;
}

function pathEl(d, options = {}) {
  return `<path ${attrs({ d, ...options })}/>`;
}

function text(x, y, value, size = 16, options = {}) {
  return `<text ${attrs({ x, y, "font-size": size, ...options })}>${esc(value)}</text>`;
}

function label(x, y, value, options = {}) {
  return text(x, y, value, options.size ?? 16, {
    fill: options.fill ?? "#102a43",
    "font-weight": options.weight ?? 700,
    "text-anchor": options.anchor,
    transform: options.transform,
  });
}

function note(x, y, value, size = 13, options = {}) {
  return text(x, y, value, size, {
    fill: options.fill ?? "#3f4a54",
    "font-weight": options.weight,
    "text-anchor": options.anchor,
  });
}

function dimLine(x1, y1, x2, y2, labelText, labelX, labelY, options = {}) {
  return [
    line(x1, y1, x2, y2, {
      stroke: options.stroke ?? "#333",
      "stroke-width": options.width ?? 1.3,
      "marker-start": "url(#dimArrow)",
      "marker-end": "url(#dimArrow)",
    }),
    text(labelX, labelY, labelText, options.size ?? 13, {
      fill: "#1f2933",
      "font-weight": 700,
      "text-anchor": options.anchor ?? "middle",
    }),
  ].join("");
}

function titleBlock(sheetNo, sheetTitle, scale = "NTS") {
  const y = 1012;
  return [
    rect(42, 42, 1516, 1046, { fill: "none", stroke: "#111", "stroke-width": 2 }),
    line(42, y, 1558, y, { stroke: "#111", "stroke-width": 1.4 }),
    rect(42, y, 742, 76, { fill: "#f7f8fa", stroke: "#111", "stroke-width": 1 }),
    rect(784, y, 252, 76, { fill: "#fff", stroke: "#111", "stroke-width": 1 }),
    rect(1036, y, 172, 76, { fill: "#fff", stroke: "#111", "stroke-width": 1 }),
    rect(1208, y, 174, 76, { fill: "#fff", stroke: "#111", "stroke-width": 1 }),
    rect(1382, y, 176, 76, { fill: "#fff", stroke: "#111", "stroke-width": 1 }),
    text(62, y + 20, "RESIDENTIAL WALL FRAME WORKFLOW - AUSTRALIA", 14, {
      fill: "#111",
      "font-weight": 700,
    }),
    text(62, y + 43, sheetTitle, 18, { fill: "#111", "font-weight": 700 }),
    note(62, y + 65, "Illustrative workflow - verify against approved plans, NCC, AS 1684 and engineering.", 10),
    note(804, y + 23, "Drawing set", 12),
    text(804, y + 51, "Prefabricated wall frames", 16, { fill: "#111", "font-weight": 700 }),
    note(1054, y + 23, "Scale", 12),
    text(1054, y + 51, scale, 18, { fill: "#111", "font-weight": 700 }),
    note(1226, y + 23, "Date", 12),
    text(1226, y + 51, DRAWING_DATE, 17, { fill: "#111", "font-weight": 700 }),
    note(1400, y + 23, "Sheet", 12),
    text(1400, y + 54, sheetNo, 26, { fill: "#111", "font-weight": 800 }),
  ].join("");
}

function defs() {
  return `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#333"/>
      </marker>
      <marker id="dimArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="strokeWidth">
        <path d="M0,4 L8,0 L8,8 z" fill="#333"/>
      </marker>
      <pattern id="braceHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="#4f8b65" stroke-width="2"/>
      </pattern>
      <pattern id="concreteHatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="14" stroke="#d1d5db" stroke-width="1"/>
      </pattern>
    </defs>`;
}

function page(sheetNo, title, subtitle, body, scale = "NTS") {
  return `
    <section class="sheet" aria-label="${esc(`${sheetNo} ${title}`)}">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">
        ${defs()}
        ${titleBlock(sheetNo, title, scale)}
        ${text(62, 82, title, 26, { fill: "#111", "font-weight": 800 })}
        ${text(62, 110, subtitle, 14, { fill: "#53606b" })}
        ${body}
      </svg>
    </section>`;
}

function legend(x, y) {
  const items = [
    ["Wall frame / plate", "#222", ""],
    ["Wall ID label", "#155e9f", ""],
    ["Opening", "#d97706", ""],
    ["Bracing panel", "#4f8b65", "url(#braceHatch)"],
    ["Hold-down", "#b42318", ""],
    ["Panel boundary", "#6b7280", ""],
  ];
  const rows = items.map(([name, stroke, fill], index) => {
    const yy = y + 38 + index * 32;
    const symbol = fill
      ? rect(x + 18, yy - 15, 36, 20, { fill, stroke, "stroke-width": 1.3 })
      : line(x + 18, yy - 6, x + 54, yy - 6, {
          stroke,
          "stroke-width": name.includes("boundary") ? 2 : 6,
          "stroke-dasharray": name.includes("boundary") ? "7 5" : undefined,
        });
    const hd = name === "Hold-down" ? circle(x + 36, yy - 6, 8, { fill: "#fff", stroke, "stroke-width": 3 }) : "";
    return `${symbol}${hd}${note(x + 70, yy - 1, name, 13)}`;
  }).join("");
  return [
    rect(x, y, 344, 250, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(x + 16, y + 24, "Legend", 17, { fill: "#111", "font-weight": 800 }),
    rows,
  ].join("");
}

function sheet1() {
  const ox = 178;
  const oy = 178;
  const s = 0.074;
  const px = (mm) => ox + mm * s;
  const py = (mm) => oy + mm * s;

  function wall(x1, y1, x2, y2, id, lx, ly, angle = 0) {
    return [
      line(px(x1), py(y1), px(x2), py(y2), { stroke: "#222", "stroke-width": 17, "stroke-linecap": "square" }),
      line(px(x1), py(y1), px(x2), py(y2), { stroke: "#111", "stroke-width": 1.4 }),
      label(px(lx), py(ly), id, { size: 15, anchor: "middle", transform: angle ? `rotate(${angle} ${px(lx)} ${py(ly)})` : undefined }),
    ].join("");
  }

  function internal(x1, y1, x2, y2, id, lx, ly, angle = 0) {
    return [
      line(px(x1), py(y1), px(x2), py(y2), { stroke: "#404850", "stroke-width": 10, "stroke-linecap": "square" }),
      label(px(lx), py(ly), id, { size: 14, anchor: "middle", transform: angle ? `rotate(${angle} ${px(lx)} ${py(ly)})` : undefined }),
    ].join("");
  }

  function openingHorizontal(x1, x2, y, tag, type = "W") {
    const fill = type === "D" ? "#fef3c7" : "#e8f2ff";
    const stroke = type === "D" ? "#d97706" : "#2563a8";
    return [
      rect(px(x1), py(y) - 13, (x2 - x1) * s, 26, { fill: "#fff", stroke: "#fff", "stroke-width": 2 }),
      rect(px(x1), py(y) - 10, (x2 - x1) * s, 20, { fill, stroke, "stroke-width": 1.5 }),
      text((px(x1) + px(x2)) / 2, py(y) - 18, tag, 12, { fill: stroke, "font-weight": 700, "text-anchor": "middle" }),
    ].join("");
  }

  function openingVertical(x, y1, y2, tag, type = "W") {
    const fill = type === "D" ? "#fef3c7" : "#e8f2ff";
    const stroke = type === "D" ? "#d97706" : "#2563a8";
    return [
      rect(px(x) - 13, py(y1), 26, (y2 - y1) * s, { fill: "#fff", stroke: "#fff", "stroke-width": 2 }),
      rect(px(x) - 10, py(y1), 20, (y2 - y1) * s, { fill, stroke, "stroke-width": 1.5 }),
      text(px(x) + 28, (py(y1) + py(y2)) / 2 + 4, tag, 12, { fill: stroke, "font-weight": 700 }),
    ].join("");
  }

  function junction(id, x, y, dx = 0, dy = 0) {
    return [
      circle(px(x) + dx, py(y) + dy, 15, { fill: "#fff", stroke: "#111", "stroke-width": 1.5 }),
      text(px(x) + dx, py(y) + dy + 5, id, 11, { fill: "#111", "font-weight": 800, "text-anchor": "middle" }),
    ].join("");
  }

  const rooms = [
    rect(px(0), py(0), 12600 * s, 8400 * s, { fill: "url(#concreteHatch)", stroke: "#9ca3af", "stroke-width": 1 }),
    rect(px(550), py(500), 3650 * s, 2800 * s, { fill: "#fff", stroke: "#c4cbd3", "stroke-width": 1 }),
    text(px(2350), py(1880), "BED 1", 15, { fill: "#6b7280", "text-anchor": "middle" }),
    rect(px(4400), py(500), 3000 * s, 2800 * s, { fill: "#fff", stroke: "#c4cbd3", "stroke-width": 1 }),
    text(px(5900), py(1880), "BED 2", 15, { fill: "#6b7280", "text-anchor": "middle" }),
    rect(px(8100), py(500), 3900 * s, 5000 * s, { fill: "#fff", stroke: "#c4cbd3", "stroke-width": 1 }),
    text(px(10050), py(2860), "LIVING", 15, { fill: "#6b7280", "text-anchor": "middle" }),
    rect(px(550), py(3800), 3250 * s, 4100 * s, { fill: "#fff", stroke: "#c4cbd3", "stroke-width": 1 }),
    text(px(2150), py(5850), "GARAGE", 15, { fill: "#6b7280", "text-anchor": "middle" }),
    rect(px(4300), py(3800), 3000 * s, 4100 * s, { fill: "#fff", stroke: "#c4cbd3", "stroke-width": 1 }),
    text(px(5800), py(5850), "KITCHEN", 15, { fill: "#6b7280", "text-anchor": "middle" }),
    rect(px(8100), py(5900), 3900 * s, 2000 * s, { fill: "#fff", stroke: "#c4cbd3", "stroke-width": 1 }),
    text(px(10050), py(6900), "DINING", 15, { fill: "#6b7280", "text-anchor": "middle" }),
  ].join("");

  const walls = [
    wall(0, 0, 12600, 0, "GF-W01", 6300, -310),
    wall(12600, 0, 12600, 8400, "GF-W02", 13020, 4200, 90),
    wall(12600, 8400, 0, 8400, "GF-W03", 6300, 8810),
    wall(0, 8400, 0, 0, "GF-W04", -420, 4200, 270),
    internal(0, 3600, 7600, 3600, "GF-W05", 3800, 3420),
    internal(7600, 0, 7600, 8400, "GF-W06", 7930, 4200, 90),
    internal(7600, 5600, 12600, 5600, "GF-W07", 10100, 5430),
    internal(4200, 3600, 4200, 8400, "GF-W08", 4520, 6000, 90),
    internal(2600, 3600, 2600, 8400, "GF-W09", 2920, 6000, 90),
    internal(4200, 3600, 7600, 3600, "GF-W10", 5900, 3800),
    internal(4200, 6100, 7600, 6100, "GF-W11", 5900, 5960),
    internal(9900, 5600, 9900, 8400, "GF-W12", 10220, 7000, 90),
  ].join("");

  const openings = [
    openingHorizontal(3050, 4860, 0, "W01", "W"),
    openingHorizontal(7480, 8300, 0, "D01", "D"),
    openingVertical(12600, 2850, 4300, "W02", "W"),
    openingHorizontal(8800, 10910, 8400, "SD01", "D"),
    openingVertical(0, 5650, 7900, "GD01", "D"),
    openingHorizontal(5100, 5900, 3600, "D02", "D"),
    openingVertical(7600, 6600, 7400, "D03", "D"),
    openingHorizontal(4750, 5550, 6100, "D04", "D"),
  ].join("");

  const junctions = [
    junction("J01", 0, 0, -24, -24),
    junction("J02", 12600, 0, 24, -24),
    junction("J03", 12600, 8400, 24, 24),
    junction("J04", 0, 8400, -24, 24),
    junction("J05", 7600, 0, 0, -28),
    junction("J06", 7600, 3600, 0, 0),
    junction("J07", 7600, 5600, 0, 0),
    junction("J08", 4200, 3600, 0, 0),
    junction("J09", 2600, 3600, 0, 0),
    junction("J10", 4200, 6100, 0, 0),
    junction("J11", 9900, 5600, 0, 0),
    junction("J12", 9900, 8400, 0, 24),
  ].join("");

  const orientation = [
    line(px(1300), py(-500), px(3200), py(-500), { stroke: "#333", "stroke-width": 2, "marker-end": "url(#arrow)" }),
    text(px(1320), py(-660), "OUTSIDE FACE", 13, { fill: "#333", "font-weight": 700 }),
    line(px(11480), py(950), px(11480), py(2450), { stroke: "#333", "stroke-width": 2, "marker-end": "url(#arrow)" }),
    text(px(11640), py(1760), "INSIDE FACE", 13, { fill: "#333", "font-weight": 700, transform: `rotate(90 ${px(11640)} ${py(1760)})` }),
    line(1218, 150, 1218, 92, { stroke: "#111", "stroke-width": 2.2, "marker-end": "url(#arrow)" }),
    text(1194, 178, "N", 24, { fill: "#111", "font-weight": 800 }),
  ].join("");

  const workflow = [
    rect(1118, 490, 360, 304, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(1138, 518, "Identification rules", 17, { fill: "#111", "font-weight": 800 }),
    note(1138, 552, "Level prefix: GF = ground floor", 13),
    note(1138, 578, "Wall ID: GF-W01, GF-W02 ...", 13),
    note(1138, 604, "Panel ID: GF-W01-P1, P2 ...", 13),
    note(1138, 630, "Junction ID: J01, J02 ...", 13),
    note(1138, 656, "Labels carry inside/outside face", 13),
    note(1138, 682, "Install sequence follows external", 13),
    note(1138, 708, "corner panels, then internal walls", 13),
    rect(1138, 738, 300, 32, { fill: "#eef6ff", stroke: "#155e9f", "stroke-width": 1 }),
    text(1152, 759, "Example: GF-W01-P2 / OUTSIDE FACE", 13, { fill: "#155e9f", "font-weight": 800 }),
  ].join("");

  return page(
    "A001",
    "Overall Floor / Wall Layout",
    "Slab or floor platform plan with wall IDs, junction IDs, openings and orientation references.",
    [
      rooms,
      walls,
      openings,
      junctions,
      orientation,
      legend(1118, 205),
      workflow,
      dimLine(px(0), py(9000), px(12600), py(9000), "12 600 overall slab", (px(0) + px(12600)) / 2, py(9300), { size: 13 }),
      dimLine(px(-700), py(0), px(-700), py(8400), "8 400 overall slab", px(-1110), (py(0) + py(8400)) / 2, { size: 13, anchor: "middle" }),
      note(172, 926, "Plan is schematic. Confirm wall dimensions against approved architectural set-out before release to production.", 13),
    ].join("")
  );
}

function sheet2() {
  function panelStrip(x, y, width, title, segments, openings, bracing, holdDowns, totalMm) {
    const scale = width / totalMm;
    const p = (mm) => x + mm * scale;
    const top = y;
    const bottom = y + 138;
    const rows = [
      text(x, y - 34, title, 19, { fill: "#111", "font-weight": 800 }),
      rect(x, top, width, 22, { fill: "#f7f8fa", stroke: "#111", "stroke-width": 1.3 }),
      rect(x, bottom - 22, width, 22, { fill: "#f7f8fa", stroke: "#111", "stroke-width": 1.3 }),
      line(x, top, x, bottom, { stroke: "#111", "stroke-width": 2 }),
      line(x + width, top, x + width, bottom, { stroke: "#111", "stroke-width": 2 }),
    ];
    for (let mm = 0; mm <= totalMm; mm += 450) {
      const xx = p(mm);
      rows.push(line(xx, top + 22, xx, bottom - 22, { stroke: "#3f4a54", "stroke-width": mm % 900 === 0 ? 1.4 : 1 }));
    }
    segments.reduce((start, seg) => {
      const end = start + seg.length;
      const bx = p(end);
      if (end < totalMm) {
        rows.push(line(bx, y - 18, bx, bottom + 40, { stroke: "#6b7280", "stroke-width": 2, "stroke-dasharray": "8 6" }));
        rows.push(text(bx, bottom + 66, "panel join", 11, { fill: "#6b7280", "text-anchor": "middle" }));
      }
      rows.push(text((p(start) + p(end)) / 2, y - 10, seg.id, 15, { fill: "#155e9f", "font-weight": 800, "text-anchor": "middle" }));
      rows.push(dimLine(p(start), bottom + 24, p(end), bottom + 24, `${seg.length} mm`, (p(start) + p(end)) / 2, bottom + 42, { size: 11 }));
      return end;
    }, 0);
    openings.forEach((op) => {
      rows.push(rect(p(op.start), top + 26, (op.width) * scale, 86, {
        fill: op.type === "door" ? "#fef3c7" : "#e8f2ff",
        stroke: op.type === "door" ? "#d97706" : "#2563a8",
        "stroke-width": 1.5,
      }));
      rows.push(text(p(op.start + op.width / 2), top + 75, op.id, 13, {
        fill: op.type === "door" ? "#92400e" : "#155e9f",
        "font-weight": 800,
        "text-anchor": "middle",
      }));
      rows.push(text(p(op.start + op.width / 2), top + 96, op.note, 11, {
        fill: "#3f4a54",
        "text-anchor": "middle",
      }));
    });
    bracing.forEach((b) => {
      rows.push(rect(p(b.start), top + 26, b.width * scale, 86, { fill: "url(#braceHatch)", stroke: "#4f8b65", "stroke-width": 1.8 }));
      rows.push(text(p(b.start + b.width / 2), top + 75, b.id, 12, { fill: "#1f6f43", "font-weight": 800, "text-anchor": "middle" }));
    });
    holdDowns.forEach((mm) => {
      rows.push(circle(p(mm), bottom + 5, 9, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }));
      rows.push(text(p(mm), bottom - 8, "HD", 9, { fill: "#b42318", "font-weight": 800, "text-anchor": "middle" }));
    });
    return rows.join("");
  }

  const north = panelStrip(
    92,
    182,
    1120,
    "GF-W01 external wall - panelised for manufacture and delivery",
    [
      { id: "GF-W01-P1", length: 3600 },
      { id: "GF-W01-P2", length: 4200 },
      { id: "GF-W01-P3", length: 4800 },
    ],
    [
      { id: "W01", start: 3050, width: 1810, note: "window opening", type: "window" },
      { id: "D01", start: 7480, width: 820, note: "entry door", type: "door" },
    ],
    [
      { id: "BR1 900", start: 300, width: 900 },
      { id: "BR2 1200", start: 10400, width: 1200 },
    ],
    [0, 3600, 7800, 12600],
    12600
  );

  const internal = panelStrip(
    92,
    525,
    790,
    "GF-W05 internal wall - panel split at doorway and service zone",
    [
      { id: "GF-W05-P1", length: 3600 },
      { id: "GF-W05-P2", length: 4000 },
    ],
    [
      { id: "D02", start: 5100, width: 820, note: "internal door", type: "door" },
    ],
    [],
    [0, 3600, 7600],
    7600
  );

  const joinDetail = [
    text(1005, 505, "Typical panel join", 18, { fill: "#111", "font-weight": 800 }),
    rect(1005, 532, 330, 170, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    rect(1040, 558, 112, 18, { fill: "#f7f8fa", stroke: "#111" }),
    rect(1168, 558, 112, 18, { fill: "#f7f8fa", stroke: "#111" }),
    rect(1040, 652, 112, 18, { fill: "#f7f8fa", stroke: "#111" }),
    rect(1168, 652, 112, 18, { fill: "#f7f8fa", stroke: "#111" }),
    line(1152, 550, 1152, 682, { stroke: "#6b7280", "stroke-width": 2, "stroke-dasharray": "7 5" }),
    line(1168, 550, 1168, 682, { stroke: "#6b7280", "stroke-width": 2, "stroke-dasharray": "7 5" }),
    rect(1139, 576, 14, 76, { fill: "#fff", stroke: "#111" }),
    rect(1168, 576, 14, 76, { fill: "#fff", stroke: "#111" }),
    circle(1152, 692, 8, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }),
    text(1024, 732, "Boundary marks align in factory and on slab.", 13, { fill: "#3f4a54" }),
    text(1024, 756, "Top plate splice and tie-down per engineer.", 13, { fill: "#3f4a54" }),
  ].join("");

  const schedule = [
    rect(92, 790, 1320, 155, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(112, 818, "Panel schedule extract", 17, { fill: "#111", "font-weight": 800 }),
    ...tableRows(112, 842, [190, 180, 120, 160, 180, 370], 25, [
      ["Wall ID", "Panel ID", "Length", "Face", "Install seq.", "Notes"],
      ["GF-W01", "GF-W01-P1", "3600", "outside", "01", "External corner starter panel. HD both ends."],
      ["GF-W01", "GF-W01-P2", "4200", "outside", "02", "Window W01. Bracing panel BR1."],
      ["GF-W01", "GF-W01-P3", "4800", "outside", "03", "Entry door D01. Bracing panel BR2."],
    ], { header: true }),
  ].join("");

  return page(
    "A002",
    "Wall Panel Breakdown",
    "Long walls broken into transportable panels with panel boundaries, member intent and joining logic.",
    [
      north,
      internal,
      joinDetail,
      schedule,
      note(1250, 188, "Factory tags show panel ID, wall ID,", 13),
      note(1250, 212, "face orientation and install sequence.", 13),
      note(1250, 250, "Studs shown indicatively at 450 centres.", 13),
      note(1250, 274, "Confirm centres to engineering and lining", 13),
      note(1250, 298, "requirements before manufacture.", 13),
    ].join("")
  );
}

function tableRows(x, y, widths, rowHeight, rows, options = {}) {
  const output = [];
  rows.forEach((row, rowIndex) => {
    let xx = x;
    const isHeader = options.header && rowIndex === 0;
    row.forEach((cell, columnIndex) => {
      output.push(rect(xx, y + rowIndex * rowHeight, widths[columnIndex], rowHeight, {
        fill: isHeader ? "#eef2f6" : rowIndex % 2 === 0 ? "#fff" : "#fafafa",
        stroke: "#aeb7c2",
        "stroke-width": 0.9,
      }));
      output.push(text(xx + 8, y + rowIndex * rowHeight + rowHeight * 0.68, cell, options.size ?? 12, {
        fill: isHeader ? "#111" : "#2f3a45",
        "font-weight": isHeader ? 800 : 500,
      }));
      xx += widths[columnIndex];
    });
  });
  return output;
}

function wallElevation(x, y, width, height, includeDetails = true) {
  const wallMm = 4200;
  const wallHt = 2700;
  const sx = width / wallMm;
  const sy = height / wallHt;
  const px = (mm) => x + mm * sx;
  const py = (mm) => y + height - mm * sy;
  const output = [
    rect(x, y, width, height, { fill: "#fff", stroke: "#111", "stroke-width": 2 }),
    rect(x, py(90), width, 90 * sy, { fill: "#f7f8fa", stroke: "#111", "stroke-width": 1.3 }),
    rect(x, y, width, 90 * sy, { fill: "#f7f8fa", stroke: "#111", "stroke-width": 1.3 }),
  ];
  const studs = [0, 450, 900, 1350, 1400, 3210, 3300, 3750, 4200];
  for (let mm = 0; mm <= wallMm; mm += 450) {
    if (!studs.includes(mm)) studs.push(mm);
  }
  studs.sort((a, b) => a - b).forEach((mm) => {
    output.push(rect(px(mm) - 4, y + 34, 8, height - 68, { fill: "#fff", stroke: "#3f4a54", "stroke-width": 1 }));
  });
  const opX = 1400;
  const opW = 1810;
  const sill = 900;
  const head = 2110;
  output.push(rect(px(opX), py(head), opW * sx, (head - sill) * sy, { fill: "#e8f2ff", stroke: "#2563a8", "stroke-width": 2 }));
  output.push(text(px(opX + opW / 2), py((head + sill) / 2) + 5, "W01 1810 x 1210", 16, {
    fill: "#155e9f",
    "font-weight": 800,
    "text-anchor": "middle",
  }));
  output.push(rect(px(opX) - 12, py(head), 12, (head - 90) * sy, { fill: "#fff", stroke: "#111", "stroke-width": 1.2 }));
  output.push(rect(px(opX + opW), py(head), 12, (head - 90) * sy, { fill: "#fff", stroke: "#111", "stroke-width": 1.2 }));
  output.push(rect(px(opX) - 20, py(head + 180), opW * sx + 40, 180 * sy, { fill: "#fff7ed", stroke: "#d97706", "stroke-width": 1.7 }));
  output.push(text(px(opX + opW / 2), py(head + 90) + 5, "LINTEL 2/140x45 LVL15", 13, {
    fill: "#92400e",
    "font-weight": 800,
    "text-anchor": "middle",
  }));
  output.push(rect(px(opX), py(sill), opW * sx, 70 * sy, { fill: "#fff", stroke: "#111", "stroke-width": 1.2 }));
  output.push(text(px(opX + opW / 2), py(sill + 25), "sill trimmer", 11, {
    fill: "#3f4a54",
    "text-anchor": "middle",
  }));
  [1350, 1800].forEach((level) => {
    for (let start = 0; start < wallMm; start += 900) {
      const end = Math.min(start + 450, wallMm);
      if (!(start > 1050 && start < 3300 && level > sill && level < head)) {
        output.push(rect(px(start + 55), py(level + 35), (end - start - 110) * sx, 70 * sy, {
          fill: "#f8fafc",
          stroke: "#64748b",
          "stroke-width": 0.9,
        }));
      }
    }
    output.push(text(x - 28, py(level) + 4, `${level}`, 10, { fill: "#64748b", "text-anchor": "end" }));
  });
  output.push(rect(px(160), py(2500), 900 * sx, 2410 * sy, { fill: "url(#braceHatch)", stroke: "#4f8b65", "stroke-width": 2 }));
  output.push(text(px(610), py(1500), "BR1", 17, { fill: "#1f6f43", "font-weight": 800, "text-anchor": "middle" }));
  output.push(text(px(610), py(1420), "900 bracing panel", 12, { fill: "#1f6f43", "text-anchor": "middle" }));
  [0, 1060, 4200].forEach((mm) => {
    output.push(circle(px(mm), y + height + 15, 10, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }));
    output.push(text(px(mm), y + height + 36, "HD", 10, { fill: "#b42318", "font-weight": 800, "text-anchor": "middle" }));
  });
  if (includeDetails) {
    output.push(dimLine(x, y + height + 58, x + width, y + height + 58, "4200 overall panel length", x + width / 2, y + height + 78, { size: 13 }));
    output.push(line(x - 42, y, x - 42, y + height, {
      stroke: "#333",
      "stroke-width": 1.3,
      "marker-start": "url(#dimArrow)",
      "marker-end": "url(#dimArrow)",
    }));
    output.push(text(x - 58, y + height / 2, "2700 wall height", 13, {
      fill: "#1f2933",
      "font-weight": 700,
      "text-anchor": "middle",
      transform: `rotate(-90 ${x - 58} ${y + height / 2})`,
    }));
    output.push(dimLine(px(opX), y + height + 96, px(opX + opW), y + height + 96, "1810 opening", px(opX + opW / 2), y + height + 116, { size: 12 }));
    output.push(dimLine(px(0), y - 28, px(450), y - 28, "450 stud ctrs", px(225), y - 42, { size: 12 }));
    output.push(text(px(opX + opW) + 18, py(head) - 6, "head 2110", 11, { fill: "#3f4a54" }));
    output.push(text(px(opX + opW) + 18, py(sill) + 12, "sill 900", 11, { fill: "#3f4a54" }));
  }
  return output.join("");
}

function sheet3() {
  const rows = [
    ["Member type", "Qty", "Section", "Length", "Grade", "Wall / Panel", "Notes"],
    ["Top plate", "1", "90x45", "4200", "MGP10", "GF-W01 / P2", "continuous panel top plate"],
    ["Bottom plate", "1", "90x45", "4200", "MGP10", "GF-W01 / P2", "mark opening and HD positions"],
    ["Common studs", "7", "90x45", "2610", "MGP10", "GF-W01 / P2", "450 ctrs where unobstructed"],
    ["Jamb studs", "4", "90x45", "2110", "MGP10", "GF-W01 / P2", "double jambs to W01"],
    ["Lintel", "2", "140x45", "2110", "LVL15", "GF-W01 / P2", "1810 clear span plus bearing"],
    ["Sill trimmer", "1", "90x45", "1810", "MGP10", "GF-W01 / P2", "window sill at 900"],
    ["Noggings", "12", "90x45", "varies", "MGP10", "GF-W01 / P2", "rows at 1350 and 1800"],
    ["Blocks", "4", "90x45", "450", "MGP10", "GF-W01 / P2", "brace and connector backing"],
  ];
  const table = [
    text(1030, 160, "Factory cut-list beside elevation", 18, { fill: "#111", "font-weight": 800 }),
    ...tableRows(1030, 181, [82, 30, 60, 52, 52, 74, 155], 34, rows, { header: true, size: 8.8 }),
  ].join("");

  const notes = [
    rect(1030, 540, 500, 235, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(1050, 568, "Shop drawing notes", 17, { fill: "#111", "font-weight": 800 }),
    note(1050, 600, "1. Wall ID: GF-W01. Panel ID: GF-W01-P2.", 13),
    note(1050, 626, "2. Overall length 4200. Frame height 2700.", 13),
    note(1050, 652, "3. Stud spacing 450 mm centres unless noted.", 13),
    note(1050, 678, "4. BR1 900 bracing panel to outside face.", 13),
    note(1050, 704, "5. Hold-downs at panel ends and bracing edge.", 13),
    note(1050, 730, "6. Connector and tie-down fixings by engineer.", 13),
    note(1050, 756, "7. Check opening tag W01 against window schedule.", 13),
  ].join("");

  const header = [
    rect(82, 140, 930, 68, { fill: "#f7f8fa", stroke: "#111", "stroke-width": 1.2 }),
    text(104, 166, "WALL ELEVATION SHOP DRAWING", 17, { fill: "#111", "font-weight": 800 }),
    text(104, 194, "Wall ID GF-W01 | Panel ID GF-W01-P2 | Level GF | External wall | Outside face shown", 16, {
      fill: "#155e9f",
      "font-weight": 800,
    }),
  ].join("");

  return page(
    "A003",
    "Individual Wall Elevation Sheet",
    "Sample manufacturer's shop drawing elevation with dimensions, member callouts and panel-specific notes.",
    [
      header,
      wallElevation(132, 250, 875, 562),
      table,
      notes,
      note(134, 966, "Orientation: outside face shown. Stand panel with label readable from external side before tying into adjoining panels.", 13),
    ].join("")
  );
}

function sheet4() {
  const rows = [
    ["Member type", "Qty", "Section size", "Length", "Grade", "Wall ID", "Panel ID", "Notes"],
    ["Top plate", "1", "90x45", "4200", "MGP10", "GF-W01", "GF-W01-P2", "cut square, mark panel joins"],
    ["Bottom plate", "1", "90x45", "4200", "MGP10", "GF-W01", "GF-W01-P2", "mark studs, openings, hold-downs"],
    ["Common studs", "7", "90x45", "2610", "MGP10", "GF-W01", "GF-W01-P2", "studs to 450 ctr set-out"],
    ["Jamb studs", "4", "90x45", "2110", "MGP10", "GF-W01", "GF-W01-P2", "double jambs to window W01"],
    ["Lintel", "2", "140x45", "2110", "LVL15", "GF-W01", "GF-W01-P2", "1810 clear span plus 150 bearing each end"],
    ["Sill trimmer", "1", "90x45", "1810", "MGP10", "GF-W01", "GF-W01-P2", "underside to window schedule"],
    ["Cripple studs", "6", "90x45", "varies", "MGP10", "GF-W01", "GF-W01-P2", "above lintel and below sill"],
    ["Noggings", "12", "90x45", "varies", "MGP10", "GF-W01", "GF-W01-P2", "two rows, staggered where required"],
    ["Blocks", "4", "90x45", "450", "MGP10", "GF-W01", "GF-W01-P2", "brace sheet edge and connector backing"],
    ["Bracing sheet", "1", "900 wide", "2400", "ply", "GF-W01", "GF-W01-P2", "structural bracing sheet BR1 to outside face"],
    ["Hold-down kit", "3", "engineered", "as sched.", "galv.", "GF-W01", "GF-W01-P2", "HD at each nominated point"],
  ];

  function flowBox(x, y, n, title, body) {
    return [
      rect(x, y, 330, 78, { fill: "#fff", stroke: "#9ca3af", "stroke-width": 1.2 }),
      circle(x + 26, y + 28, 15, { fill: "#111" }),
      text(x + 26, y + 34, n, 13, { fill: "#fff", "font-weight": 800, "text-anchor": "middle" }),
      text(x + 52, y + 26, title, 14, { fill: "#111", "font-weight": 800 }),
      note(x + 52, y + 51, body, 12),
    ].join("");
  }

  const flow = [
    text(1180, 154, "Factory assembly flow", 18, { fill: "#111", "font-weight": 800 }),
    flowBox(1180, 182, "1", "Read panel schedule", "Wall ID, panel ID, openings."),
    line(1345, 260, 1345, 280, { stroke: "#333", "stroke-width": 1.5, "marker-end": "url(#arrow)" }),
    flowBox(1180, 288, "2", "Optimise stock", "Group 90x45 and LVL cuts."),
    line(1345, 366, 1345, 386, { stroke: "#333", "stroke-width": 1.5, "marker-end": "url(#arrow)" }),
    flowBox(1180, 394, "3", "Cut and mark", "Print saw tags and plate marks."),
    line(1345, 472, 1345, 492, { stroke: "#333", "stroke-width": 1.5, "marker-end": "url(#arrow)" }),
    flowBox(1180, 500, "4", "Assemble in jig", "Studs, lintel, sill, noggings."),
    line(1345, 578, 1345, 598, { stroke: "#333", "stroke-width": 1.5, "marker-end": "url(#arrow)" }),
    flowBox(1180, 606, "5", "Brace and QC", "Check diagonal, tags, HD marks."),
    line(1345, 684, 1345, 704, { stroke: "#333", "stroke-width": 1.5, "marker-end": "url(#arrow)" }),
    flowBox(1180, 712, "6", "Label and pack", "Sequence for site installation."),
  ].join("");

  const mini = [
    text(82, 154, "Cut-list and assembly breakdown for sample panel GF-W01-P2", 18, { fill: "#111", "font-weight": 800 }),
    ...tableRows(82, 184, [126, 42, 92, 70, 64, 72, 104, 340], 36, rows, { header: true, size: 11 }),
    rect(82, 654, 1020, 225, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(106, 684, "Assembly marks shown on bottom plate before jigging", 17, { fill: "#111", "font-weight": 800 }),
    rect(130, 733, 860, 28, { fill: "#f7f8fa", stroke: "#111" }),
    ...[0, 450, 900, 1350, 1400, 3210, 3300, 3750, 4200].map((mm) => {
      const x = 130 + (mm / 4200) * 860;
      return [
        line(x, 717, x, 781, { stroke: "#3f4a54", "stroke-width": 1 }),
        text(x, 806, `${mm}`, 9, { fill: "#3f4a54", "text-anchor": "middle" }),
      ].join("");
    }).join(""),
    rect(130 + (1400 / 4200) * 860, 724, (1810 / 4200) * 860, 46, { fill: "#e8f2ff", stroke: "#2563a8", "stroke-width": 1.5 }),
    text(130 + ((1400 + 905) / 4200) * 860, 753, "W01 opening marked on plate", 12, {
      fill: "#155e9f",
      "font-weight": 800,
      "text-anchor": "middle",
    }),
    circle(130, 789, 9, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }),
    circle(130 + (1060 / 4200) * 860, 789, 9, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }),
    circle(990, 789, 9, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }),
    note(106, 846, "Plate marks and saw tags carry the same ID scheme used in the layout drawing so site crews can sort by wall and panel without re-measuring.", 13),
  ].join("");

  return page(
    "A004",
    "Factory Cut-list / Assembly Breakdown",
    "Member table and shop-floor process connecting estimate data to plate marks, saw tags, assembly and QC.",
    [mini, flow].join("")
  );
}

function qrPattern(x, y, cell = 9) {
  const on = new Set([
    "0,0", "1,0", "2,0", "4,0", "6,0", "7,0", "8,0",
    "0,1", "2,1", "3,1", "5,1", "6,1", "8,1",
    "0,2", "1,2", "2,2", "4,2", "5,2", "8,2",
    "1,3", "3,3", "4,3", "7,3",
    "0,4", "2,4", "5,4", "6,4", "8,4",
    "0,5", "3,5", "4,5", "6,5", "7,5",
    "0,6", "1,6", "2,6", "4,6", "8,6",
    "0,7", "2,7", "5,7", "6,7", "8,7",
    "0,8", "1,8", "2,8", "4,8", "6,8", "7,8", "8,8",
  ]);
  const cells = [];
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (on.has(`${col},${row}`)) {
        cells.push(rect(x + col * cell, y + row * cell, cell, cell, { fill: "#111" }));
      }
    }
  }
  return [
    rect(x - 8, y - 8, cell * 9 + 16, cell * 9 + 16, { fill: "#fff", stroke: "#111", "stroke-width": 1.2 }),
    cells.join(""),
  ].join("");
}

function sheet5() {
  function panel(x, y, w, h, dx, dy, label1, label2, seq) {
    const points = [
      [x, y],
      [x + w, y],
      [x + w + dx, y + dy],
      [x + dx, y + dy],
    ];
    return [
      polygon(points, { fill: "#f8fafc", stroke: "#111", "stroke-width": 1.5 }),
      line(x + 35, y + 16, x + w - 20, y + 16, { stroke: "#64748b", "stroke-width": 1 }),
      ...Array.from({ length: 7 }, (_, i) => {
        const xx = x + 70 + i * (w - 140) / 6;
        return line(xx, y + 16, xx + dx, y + dy - 16, { stroke: "#64748b", "stroke-width": 1 });
      }),
      rect(x + 80, y + 32, 235, 70, { fill: "#fff", stroke: "#155e9f", "stroke-width": 1.6 }),
      text(x + 94, y + 55, label1, 14, { fill: "#155e9f", "font-weight": 800 }),
      text(x + 94, y + 77, label2, 12, { fill: "#2f3a45", "font-weight": 700 }),
      text(x + 94, y + 96, `INSTALL SEQ ${seq}`, 12, { fill: "#b42318", "font-weight": 800 }),
      line(x + 258, y + 72, x + 298, y + 72, { stroke: "#333", "stroke-width": 2, "marker-end": "url(#arrow)" }),
    ].join("");
  }

  const stack = [
    text(96, 155, "Delivery pack with visible panel labels", 20, { fill: "#111", "font-weight": 800 }),
    rect(170, 756, 650, 38, { fill: "#8b7355", stroke: "#111", "stroke-width": 1.2 }),
    rect(850, 756, 250, 38, { fill: "#8b7355", stroke: "#111", "stroke-width": 1.2 }),
    panel(145, 622, 850, 104, 82, 52, "GF-W01-P1 | LEVEL GF", "OUTSIDE FACE", "01"),
    panel(170, 520, 850, 104, 82, 52, "GF-W01-P2 | LEVEL GF", "OUTSIDE FACE", "02"),
    panel(195, 418, 850, 104, 82, 52, "GF-W01-P3 | LEVEL GF", "OUTSIDE FACE", "03"),
    panel(220, 316, 850, 104, 82, 52, "GF-W02-P1 | LEVEL GF", "OUTSIDE FACE", "04"),
    line(260, 292, 214, 754, { stroke: "#334155", "stroke-width": 5 }),
    line(930, 336, 893, 754, { stroke: "#334155", "stroke-width": 5 }),
    text(308, 834, "Panels stacked in installation order with first external corner panels accessible.", 14, {
      fill: "#3f4a54",
      "text-anchor": "middle",
    }),
  ].join("");

  const manifest = [
    rect(1130, 162, 345, 444, { fill: "#fff", stroke: "#111", "stroke-width": 1.4 }),
    rect(1130, 162, 345, 46, { fill: "#eef2f6", stroke: "#111", "stroke-width": 1.2 }),
    text(1150, 192, "LAMINATED PACK SHEET", 16, { fill: "#111", "font-weight": 800 }),
    qrPattern(1160, 232, 9),
    text(1268, 253, "Pack: GF-EXT-01", 15, { fill: "#111", "font-weight": 800 }),
    note(1268, 279, "Ground floor external walls", 12),
    note(1268, 304, "Scan for layout PDF and", 12),
    note(1268, 327, "panel schedule extract", 12),
    line(1160, 356, 1438, 356, { stroke: "#c4cbd3", "stroke-width": 1 }),
    text(1160, 386, "Seq  Panel", 13, { fill: "#111", "font-weight": 800 }),
    note(1160, 415, "01   GF-W01-P1   outside face", 12),
    note(1160, 441, "02   GF-W01-P2   outside face", 12),
    note(1160, 467, "03   GF-W01-P3   outside face", 12),
    note(1160, 493, "04   GF-W02-P1   outside face", 12),
    note(1160, 519, "05   GF-W02-P2   outside face", 12),
    line(1160, 548, 1438, 548, { stroke: "#c4cbd3", "stroke-width": 1 }),
    note(1160, 577, "Hold pack flat, restrained and dry.", 12),
  ].join("");

  const labels = [
    rect(1130, 650, 345, 244, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(1150, 681, "Label requirements", 17, { fill: "#111", "font-weight": 800 }),
    note(1150, 714, "Each panel label includes:", 13),
    note(1170, 743, "wall ID and panel ID", 13),
    note(1170, 769, "level: GF / first floor", 13),
    note(1170, 795, "inside or outside face", 13),
    note(1170, 821, "orientation arrow", 13),
    note(1170, 847, "installation sequence number", 13),
    note(1170, 873, "pack ID or QR-style reference", 13),
  ].join("");

  return page(
    "A005",
    "Labelling and Packing",
    "Panel labels, pack manifest and delivery stacking that preserve installation order from factory to site.",
    [stack, manifest, labels].join("")
  );
}

function stepIcon(x, y, type) {
  if (type === "check") {
    return [
      rect(x + 16, y + 56, 176, 94, { fill: "url(#concreteHatch)", stroke: "#9ca3af" }),
      line(x + 16, y + 166, x + 192, y + 166, {
        stroke: "#333",
        "stroke-width": 1.3,
        "marker-start": "url(#dimArrow)",
        "marker-end": "url(#dimArrow)",
      }),
      line(x - 2, y + 56, x - 2, y + 150, {
        stroke: "#333",
        "stroke-width": 1.3,
        "marker-start": "url(#dimArrow)",
        "marker-end": "url(#dimArrow)",
      }),
    ].join("");
  }
  if (type === "lines") {
    return [
      rect(x + 18, y + 52, 178, 108, { fill: "#fff", stroke: "#9ca3af" }),
      line(x + 34, y + 76, x + 180, y + 76, { stroke: "#111", "stroke-width": 3 }),
      line(x + 34, y + 112, x + 180, y + 112, { stroke: "#111", "stroke-width": 3, "stroke-dasharray": "8 6" }),
      line(x + 76, y + 62, x + 76, y + 148, { stroke: "#111", "stroke-width": 3 }),
      text(x + 92, y + 139, "set-out", 11, { fill: "#3f4a54" }),
    ].join("");
  }
  if (type === "ids") {
    return [
      rect(x + 18, y + 52, 178, 108, { fill: "#fff", stroke: "#9ca3af" }),
      text(x + 38, y + 82, "GF-W01", 14, { fill: "#155e9f", "font-weight": 800 }),
      text(x + 118, y + 116, "GF-W05", 14, { fill: "#155e9f", "font-weight": 800 }),
      circle(x + 54, y + 132, 13, { fill: "#fff", stroke: "#111" }),
      text(x + 54, y + 137, "J01", 9, { fill: "#111", "font-weight": 800, "text-anchor": "middle" }),
    ].join("");
  }
  if (type === "sort") {
    return [
      rect(x + 18, y + 58, 170, 20, { fill: "#f8fafc", stroke: "#111" }),
      rect(x + 32, y + 88, 170, 20, { fill: "#f8fafc", stroke: "#111" }),
      rect(x + 46, y + 118, 170, 20, { fill: "#f8fafc", stroke: "#111" }),
      text(x + 30, y + 73, "01 GF-W01-P1", 10, { fill: "#155e9f", "font-weight": 800 }),
      text(x + 44, y + 103, "02 GF-W01-P2", 10, { fill: "#155e9f", "font-weight": 800 }),
      text(x + 58, y + 133, "03 GF-W01-P3", 10, { fill: "#155e9f", "font-weight": 800 }),
    ].join("");
  }
  if (type === "corner") {
    return [
      line(x + 52, y + 148, x + 176, y + 148, { stroke: "#111", "stroke-width": 3 }),
      line(x + 52, y + 148, x + 52, y + 62, { stroke: "#111", "stroke-width": 8 }),
      line(x + 52, y + 62, x + 148, y + 62, { stroke: "#111", "stroke-width": 8 }),
      text(x + 66, y + 92, "external", 11, { fill: "#3f4a54" }),
      text(x + 66, y + 108, "corner", 11, { fill: "#3f4a54" }),
    ].join("");
  }
  if (type === "brace") {
    return [
      line(x + 56, y + 148, x + 176, y + 148, { stroke: "#111", "stroke-width": 3 }),
      line(x + 72, y + 148, x + 72, y + 60, { stroke: "#111", "stroke-width": 7 }),
      line(x + 72, y + 60, x + 174, y + 60, { stroke: "#111", "stroke-width": 7 }),
      line(x + 72, y + 60, x + 144, y + 148, { stroke: "#4f8b65", "stroke-width": 4 }),
      line(x + 124, y + 60, x + 210, y + 20, { stroke: "#64748b", "stroke-width": 3 }),
      line(x + 210, y + 20, x + 210, y + 148, { stroke: "#64748b", "stroke-width": 2 }),
      text(x + 136, y + 112, "plumb", 11, { fill: "#3f4a54" }),
    ].join("");
  }
  if (type === "internal") {
    return [
      rect(x + 20, y + 64, 172, 92, { fill: "#fff", stroke: "#9ca3af" }),
      line(x + 38, y + 82, x + 176, y + 82, { stroke: "#111", "stroke-width": 6 }),
      line(x + 104, y + 82, x + 104, y + 142, { stroke: "#404850", "stroke-width": 5 }),
      line(x + 138, y + 82, x + 138, y + 142, { stroke: "#404850", "stroke-width": 5 }),
      text(x + 62, y + 135, "internal", 11, { fill: "#3f4a54" }),
    ].join("");
  }
  return [
    rect(x + 20, y + 58, 172, 98, { fill: "#fff", stroke: "#9ca3af" }),
    circle(x + 58, y + 118, 10, { fill: "#fff", stroke: "#b42318", "stroke-width": 3 }),
    rect(x + 96, y + 82, 78, 48, { fill: "url(#braceHatch)", stroke: "#4f8b65" }),
    pathEl(`M${x + 60},${y + 88} L${x + 78},${y + 108} L${x + 114},${y + 70}`, { fill: "none", stroke: "#111", "stroke-width": 4 }),
    text(x + 94, y + 148, "final checks", 11, { fill: "#3f4a54" }),
  ].join("");
}

function sheet6() {
  const steps = [
    ["1", "Step 1: check slab/floor dimensions", "check", "Confirm overall dimensions, diagonals, rebates, step-downs and hold-down set-out before walls leave the pack."],
    ["2", "Step 2: mark wall lines", "lines", "Snap external and internal wall lines from the approved set-out, including offsets for linings where required."],
    ["3", "Step 3: mark wall IDs on slab/floor", "ids", "Write GF-W01, GF-W02 and junction IDs at the line so each panel has a matching site location."],
    ["4", "Step 4: sort panels by installation order", "sort", "Open delivery pack, check labels and place panels near their sequence without blocking crane or access paths."],
    ["5", "Step 5: stand external corner panels first", "corner", "Start with external corner panels to lock orientation and give the remaining external walls a set-out reference."],
    ["6", "Step 6: plumb, brace and fix panels", "brace", "Temporarily brace, check plumb, fix to slab/floor and install nominated hold-downs as the wall line is built."],
    ["7", "Step 7: install remaining internal walls", "internal", "Stand internal walls after the external frame is stable, tying junctions back to the marked wall IDs."],
    ["8", "Step 8: complete tie-downs and bracing checks", "checks", "Check bracing panel edges, straps, hold-downs, connectors and junction fixings before handover."],
  ];

  const boxes = steps.map((step, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = 78 + col * 376;
    const y = 168 + row * 360;
    return [
      rect(x, y, 330, 306, { fill: "#fff", stroke: "#b8c0cc", "stroke-width": 1.2 }),
      rect(x, y, 330, 52, { fill: "#eef2f6", stroke: "#b8c0cc", "stroke-width": 1.2 }),
      circle(x + 26, y + 26, 15, { fill: "#111" }),
      text(x + 26, y + 32, step[0], 14, { fill: "#fff", "font-weight": 800, "text-anchor": "middle" }),
      wrapBoldText(x + 52, y + 22, step[1], 250, 13, 15),
      stepIcon(x + 50, y + 56, step[2]),
      wrapText(x + 24, y + 246, step[3], 282, 13, 19),
    ].join("");
  }).join("");

  const checklist = [
    rect(80, 900, 1432, 66, { fill: "#f8fafc", stroke: "#b8c0cc", "stroke-width": 1.2 }),
    text(102, 928, "Site QA close-out", 16, { fill: "#111", "font-weight": 800 }),
    note(328, 928, "slab dimensions checked", 13),
    note(548, 928, "wall IDs matched", 13),
    note(760, 928, "temporary bracing installed", 13),
    note(1034, 928, "hold-downs fitted", 13),
    note(1238, 928, "bracing sheets verified", 13),
    note(1452, 928, "junctions fixed", 13),
    ...[305, 525, 737, 1011, 1215, 1429].map((x) => rect(x, 912, 15, 15, { fill: "#fff", stroke: "#111" })).join(""),
    note(102, 952, "Record unresolved items before lining or bracing cover-up. Do not substitute tie-downs or bracing without approved direction.", 13),
  ].join("");

  return page(
    "A006",
    "Site Installation Sequence",
    "Eight-step site workflow preserving the manufacturer's wall IDs, panel labels and tie-down intent.",
    [boxes, checklist].join("")
  );
}

function wrapText(x, y, value, maxWidth, size = 13, lineHeight = 18) {
  const words = value.split(/\s+/);
  const lines = [];
  let lineValue = "";
  const maxChars = Math.max(18, Math.floor(maxWidth / (size * 0.55)));
  for (const word of words) {
    const next = lineValue ? `${lineValue} ${word}` : word;
    if (next.length > maxChars && lineValue) {
      lines.push(lineValue);
      lineValue = word;
    } else {
      lineValue = next;
    }
  }
  if (lineValue) lines.push(lineValue);
  return lines.map((lineText, index) => note(x, y + index * lineHeight, lineText, size)).join("");
}

function wrapBoldText(x, y, value, maxWidth, size = 13, lineHeight = 15) {
  const words = value.split(/\s+/);
  const lines = [];
  let lineValue = "";
  const maxChars = Math.max(18, Math.floor(maxWidth / (size * 0.55)));
  for (const word of words) {
    const next = lineValue ? `${lineValue} ${word}` : word;
    if (next.length > maxChars && lineValue) {
      lines.push(lineValue);
      lineValue = word;
    } else {
      lineValue = next;
    }
  }
  if (lineValue) lines.push(lineValue);
  return lines.slice(0, 2).map((lineText, index) => text(x, y + index * lineHeight, lineText, size, {
    fill: "#111",
    "font-weight": 800,
  })).join("");
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Australian Residential Wall Frame Fabrication and Installation Sequence</title>
  <style>
    @page {
      size: A3 landscape;
      margin: 0;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: #d8dde3;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
    }

    .sheet {
      width: 420mm;
      height: 297mm;
      background: #fff;
      margin: 12px auto;
      page-break-after: always;
      overflow: hidden;
      box-shadow: 0 6px 22px rgba(15, 23, 42, 0.18);
    }

    .sheet:last-child {
      page-break-after: auto;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
      text-rendering: geometricPrecision;
    }

    @media print {
      body {
        background: #fff;
      }

      .sheet {
        margin: 0;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  ${[sheet1(), sheet2(), sheet3(), sheet4(), sheet5(), sheet6()].join("\n")}
</body>
</html>
`;

fs.writeFileSync(HTML_PATH, html, "utf8");

const browserCandidates = [
  process.env.CHROME_PATH,
  path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);

const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
if (!browserPath) {
  throw new Error("No Chrome or Edge executable found for PDF export.");
}

fs.rmSync(PDF_PATH, { force: true });
const profileDir = path.join(TMP_DIR, "chrome-profile");
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true });

const browserResult = spawnSync(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-background-networking",
  "--no-pdf-header-footer",
  "--print-to-pdf-no-header",
  `--user-data-dir=${profileDir}`,
  `--print-to-pdf=${PDF_PATH}`,
  pathToFileURL(HTML_PATH).href,
], {
  encoding: "utf8",
  stdio: "pipe",
});

if (browserResult.status !== 0 || !fs.existsSync(PDF_PATH)) {
  throw new Error(`Chrome PDF export failed.\nSTDOUT:\n${browserResult.stdout}\nSTDERR:\n${browserResult.stderr}`);
}

console.log(`HTML: ${HTML_PATH}`);
console.log(`PDF:  ${PDF_PATH}`);

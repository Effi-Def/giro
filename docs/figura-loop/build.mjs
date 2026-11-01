// Fig 1 di Giro: come gira un loop. Una piastra con tre anelli di nastro trascinati dalla stessa cinghia.
// node docs/figura-loop/build.mjs [--light]  →  docs/figura-loop/figura-loop(.html | -chiara.html)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import { W, beatsFor, spanOf, laneSvg } from "./tape.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export /gm, "");

const WIDTH = 600, HEIGHT = 380;
const { X0, LANES } = W;
const PLATE = { x: -146, y: -68, w: 262, d: 120, r: 8 };
const PLATE_H = 12, FOOT_H = 5;
const MOTOR = [X0, -46];
const PULLEYS = [MOTOR, ...[...LANES].reverse().map((l) => [X0, l.y])];   // da dietro in avanti
const BELT_R = 6.3, BELT_Z = [1.6, 3.2];
const DIAL = [-129, 39], DIAL_R = 13, DIAL_Z = 3, DIAL_TOP = 11;
const B0 = 2.4;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [MOTOR[0], MOTOR[1], 28], [X0, -22, 14]],
  WIDTH, HEIGHT, { pad: 22, azimuth: 54, elevation: 35 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const [VX, VY] = k.towardViewer(P);

// ---------- piastra ----------
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

// Le cave delle slitte, con i fermi alle estremità.
function slots() {
  const out = [];
  for (const lane of LANES) {
    const lo = X0 + spanOf(W.B_MIN, lane.k) - 7, hi = X0 + spanOf(W.B_MAX, lane.k) + 7;
    const slot = { x: lo, y: lane.y - 1.8, w: hi - lo, d: 3.6, r: 1.8 };
    out.push(S(k.slabOf(slot, -0.01, 0.01, P, 6), { tone: "lo", flat: true }));
    out.push(L(k.planOutline(k.insetPlan(slot, 0.9), 0, P, 6), { tone: "faint" }));
    for (const x of [lo - 3.4, hi + 0.4]) {
      const stop = { x, y: lane.y - 3.6, w: 3, d: 7.2, r: 0.8 };
      out.push(S(k.slabOf(stop, 0, 2.4, P, 3, 0.4), { tone: "mid" }));
      out.push(D([at([x + 1.5, lane.y, 2.4])], { size: 0.42 }));
    }
  }
  return out.join("");
}

// Righello del primo loop: un tratto ogni 0,25 s, quello lungo a ogni secondo.
const POINTER_DX = 3.2;
const rulerX = (b) => X0 + spanOf(b, 1) + POINTER_DX;
function ruler() {
  const y = LANES[0].y + 13;
  const plan = { x: rulerX(1.5) - 3, y, w: rulerX(3.75) - rulerX(1.5) + 6, d: 6, r: 1 };
  const out = [S(k.slabOf(plan, 0, 0.6, P, 3), { tone: "lo", crease: "none" })];
  const minor = [], major = [];
  for (let b = 1.5; b <= 3.75 + 1e-9; b += 0.25) {
    const x = rulerX(b), big = Math.abs(b - Math.round(b)) < 1e-6;
    (big ? major : minor).push(k.lineOnTop([x, y], [x, y + (big ? 3.4 : 1.8)], 0.6, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(D([at([plan.x + 1.5, y + 4.5, 0.6]), at([plan.x + plan.w - 1.5, y + 4.5, 0.6])], { size: 0.42 }));
  return out.join("");
}

function labelPlate() {
  const plan = { x: 84, y: 34, w: 26, d: 14, r: 1.5 };
  const z = 0.8;
  return [
    S(k.slabOf(plan, 0, z, P, 4), { tone: "lo" }),
    L(k.planOutline(k.insetPlan(plan, 1.6), z, P, 4), { tone: "faint" }),
    k.faceTextSvg(k.topMatrix([plan.x + 5, plan.y + 6.4], z, P, "x"), "GIRO", { size: 3.4, tone: "mid" }),
    L(k.lineOnTop([plan.x + 5, plan.y + 9], [plan.x + 19, plan.y + 9], z, P), { tone: "lo", free: true }),
    L(k.lineOnTop([plan.x + 5, plan.y + 11], [plan.x + 14, plan.y + 11], z, P), { tone: "lo", free: true }),
    D([at([plan.x + plan.w - 3.4, plan.y + 3.4, z]), at([plan.x + plan.w - 3.4, plan.y + plan.d - 3.4, z])], { size: 0.45 }),
  ].join("");
}

// Bobina di nastro di scorta: da qui si tagliano gli anelli.
const REEL = [56, 26];
function reel() {
  const [x, y] = REEL, out = [];
  out.push(`<path class="iso-halo" d="${k.cylinder(x, y, 22, 0, 1, P, 64).fill}" style="filter:blur(5px)"/>`);
  out.push(S(k.cylinder(x, y, 12, 0, 1, P, 48), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 22, 1, 1.2, P, 96, 0.6), { tone: "mid" }));
  out.push(L(k.ring(x, y, 20.6, 2.2, P, 96), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 17.5, 2.2, 6.2, P, 96, 0.5), { tone: "hi", crease: "lo", inner: L(k.sideArc(x, y, 17.5, 4.3, P, 48) + k.sideArc(x, y, 17.5, 6.4, P, 48), { tone: "faint" }) }));
  out.push(L([15.6, 13.6, 11.6, 9.8].map((r) => k.ring(x, y, r, 8.4, P, 72)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 7.6, 8.4, 0.8, P, 48, 0.3), { tone: "mid" }));
  out.push(L([0, 1, 2].map((i) => { const t = (i / 3) * Math.PI * 2 + 0.3; return k.lineOnTop([x + 3.2 * Math.cos(t), y + 3.2 * Math.sin(t)], [x + 6.4 * Math.cos(t), y + 6.4 * Math.sin(t)], 9.2, P); }).join(""), { tone: "mid" }));
  out.push(L(k.ring(x, y, 6.4, 9.2, P, 40) + k.ring(x, y, 3.2, 9.2, P, 32), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, 2.2, 9.2, 1.6, P, 24, 0.3), { tone: "mid" }));
  return out.join("");
}

// Blocco di giunzione con le due fessure di taglio e la lametta.
function splicer() {
  const block = { x: -30, y: 33, w: 36, d: 10, r: 1.2 }, z = 4;
  const ch = { y0: block.y + 3.2, y1: block.y + 6.8 };
  const out = [`<path class="iso-halo" d="${k.haloOf(block, 0, 1, P)}" style="filter:blur(4px)"/>`];
  out.push(S(k.slabOf(block, 0, z, P, 3, 0.5), { tone: "mid" }));
  out.push(L(k.lineOnTop([block.x, ch.y0], [block.x + block.w, ch.y0], z, P) + k.lineOnTop([block.x, ch.y1], [block.x + block.w, ch.y1], z, P), { tone: "lo" }));
  const cx = block.x + 22;
  const slot = (a) => {
    const dx = Math.tan(a) * (block.d / 2), w = 0.45;
    return k.onTop([[cx - dx - w, block.y + 0.9], [cx + dx - w, block.y + block.d - 0.9], [cx + dx + w, block.y + block.d - 0.9], [cx - dx + w, block.y + 0.9]], z, P, true);
  };
  out.push(L(slot(0) + slot(Math.PI / 4), { tone: "mid" }));
  out.push(D([at([block.x + 3, block.y + 1.6, z]), at([block.x + 3, block.y + block.d - 1.6, z]), at([block.x + block.w - 3, block.y + 1.6, z]), at([block.x + block.w - 3, block.y + block.d - 1.6, z])], { size: 0.42 }));
  const blade = { x: -26, y: 46, w: 20, d: 4.4, r: 0.4 };
  out.push(S(k.slabOf(blade, 0, 0.4, P, 2), { tone: "hi", crease: "lo" }));
  out.push(L(k.planOutline({ x: blade.x + 6, y: blade.y + 1.4, w: 8, d: 1.6, r: 0.8 }, 0.4, P, 4), { tone: "lo" }));
  return out.join("");
}

// ---------- cinghia e motore: la stessa velocità per tutti i capstan ----------
function beltRibbon() {
  const [x, y0] = MOTOR, y1 = LANES[0].y, R = BELT_R;
  const pts = [];
  const straight = (ax, ay, bx, by, n, count) => { for (let i = 0; i < count; i++) pts.push({ p: [ax + ((bx - ax) * i) / count, ay + ((by - ay) * i) / count], n }); };
  const arc = (cy, t0, t1, count) => { for (let i = 0; i < count; i++) { const t = t0 + ((t1 - t0) * i) / count; pts.push({ p: [x + R * Math.cos(t), cy + R * Math.sin(t)], n: [Math.cos(t), Math.sin(t)] }); } };
  straight(x + R, y0, x + R, y1, [1, 0], 18);
  arc(y1, 0, Math.PI, 22);
  straight(x - R, y1, x - R, y0, [-1, 0], 18);
  arc(y0, Math.PI, 2 * Math.PI, 22);
  pts.push(pts[0]);
  const { sinA, cosA } = k.cameraOf(P);
  const quads = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i].p, b = pts[i + 1].p;
    const n = [(pts[i].n[0] + pts[i + 1].n[0]) / 2, (pts[i].n[1] + pts[i + 1].n[1]) / 2];
    const near = n[0] * VX + n[1] * VY > 0;
    const f = near ? n : [-n[0], -n[1]];
    const shade = Math.min(3, Math.max(0, Math.floor(((f[0] * -sinA + f[1] * cosA) / Math.hypot(...f) + 1) / 2 * 4)));
    quads.push({ a, b, near, shade });
  }
  const side = (near) => {
    const shades = [[], [], [], []], edges = [];
    let top = [], bottom = [];
    const flush = () => { if (top.length) edges.push(k.pathOf(top), k.pathOf(bottom)); top = []; bottom = []; };
    for (const q of quads) {
      if (q.near !== near) { flush(); continue; }
      const ta = at([...q.a, BELT_Z[1]]), tb = at([...q.b, BELT_Z[1]]), ba = at([...q.a, BELT_Z[0]]), bb = at([...q.b, BELT_Z[0]]);
      shades[q.shade].push(k.pathOf([ta, tb, bb, ba], true));
      if (!top.length) { top.push(ta); bottom.push(ba); }
      top.push(tb); bottom.push(bb);
    }
    flush();
    const limbs = [];
    for (let i = 1; i < quads.length; i++) if (quads[i].near !== quads[i - 1].near && near) limbs.push(k.segment([...quads[i].a, BELT_Z[0]], [...quads[i].a, BELT_Z[1]], P));
    return `<g class="iso-solid" data-seamless="">${shades.map((l, i) => (l.length ? `<path class="iso-shade" data-shade="${i}" d="${l.join("")}"/>` : "")).join("")}</g>` + L(edges.join("") + limbs.join(""), { tone: near ? "mid" : "lo" });
  };
  return { far: side(false), near: side(true) };
}

const STANDOFFS = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sy]) => [MOTOR[0] + sx * 9.2, MOTOR[1] + sy * 9.2]);
function standoff([x, y]) {
  return S(k.cylinder(x, y, 2.2, 0, 0.8, P, 20), { tone: "lo" }) + S(k.cylinder(x, y, 1.6, 0.8, 5.2, P, 20), { tone: "mid", crease: "none" });
}

function drive() {
  const belt = beltRibbon();
  const out = [];
  STANDOFFS.filter(([x]) => x < MOTOR[0]).forEach((p) => out.push(standoff(p)));
  for (const [x, y] of PULLEYS) {
    out.push(S(k.cylinder(x, y, 4, 0, 0.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 7, 0.6, 0.8, P, 48, 0.3), { tone: "mid" }));
  }
  out.push(belt.far);
  for (const [x, y] of PULLEYS) out.push(S(k.cylinder(x, y, 6, 1.4, 2, P, 48), { tone: "mid", crease: "none" }));
  out.push(belt.near);
  for (const [x, y] of PULLEYS) out.push(S(k.cylinder(x, y, 7, 3.4, 0.8, P, 48, 0.3), { tone: "mid" }));
  // motore capovolto su quattro distanziali, l'albero scende alla sua puleggia
  out.push(S(k.cylinder(MOTOR[0], MOTOR[1], 1.6, 4.2, 1.8, P, 16), { tone: "mid", crease: "none" }));
  STANDOFFS.filter(([x]) => x > MOTOR[0]).forEach((p) => out.push(standoff(p)));
  const [mx, my] = MOTOR;
  out.push(`<path class="iso-halo" d="${k.cylinder(mx, my, 14, 6, 1.2, P, 48).fill}" style="opacity:calc(var(--anatomy-halo-opacity) * .5);filter:blur(5px)"/>`);
  out.push(S(k.cylinder(mx, my, 14.5, 6, 1.4, P, 64, 0.5), { tone: "mid" }));
  out.push(D(STANDOFFS.map(([x, y]) => at([x, y, 7.4])), { size: 0.5 }));
  out.push(S(k.cylinder(mx, my, 9, 7.4, 16.6, P, 64), { tone: "hi", crease: "lo", inner: L(k.sideArc(mx, my, 9, 10, P, 40) + k.sideArc(mx, my, 9, 21, P, 40), { tone: "faint" }) }));
  out.push(L(k.knurl(mx, my, 9, 10, 21, 56, P, 0.4), { tone: "faint" }));
  out.push(S(k.cylinder(mx, my, 7.6, 24, 1.6, P, 56, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(mx, my, 3, 25.6, 1.4, P, 28, 0.3), { tone: "mid" }));
  out.push(D([0, 1, 2].map((i) => { const t = (i / 3) * Math.PI * 2 + 0.4; return at([mx + 5.6 * Math.cos(t), my + 5.6 * Math.sin(t), 25.6]); }), { size: 0.42 }));
  // morsetti del motore
  const tab = { x: mx + 8.6, y: my - 2.6, w: 3.2, d: 5.2, r: 0.6 };
  out.push(S(k.slabOf(tab, 16.5, 4.5, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([tab.x + 1.6, tab.y + 1.4, 21]), at([tab.x + 1.6, tab.y + 3.8, 21])], { size: 0.42 }));
  return out.join("");
}

function powerSwitch() {
  const plan = { x: -84, y: -62, w: 15, d: 10, r: 1.5 };
  const z = 5, cx = plan.x + 8, cy = plan.y + 5;
  return [
    `<path class="iso-halo" d="${k.haloOf(plan, 0, 1, P)}" style="filter:blur(4px)"/>`,
    S(k.slabOf(plan, 0, z, P, 4, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, 1.4, P, 4), { tone: "faint" }) }),
    D([at([plan.x + 2.4, plan.y + 2.4, z]), at([plan.x + 2.4, plan.y + plan.d - 2.4, z])], { size: 0.42 }),
    S(k.cylinder(cx, cy, 2.4, z, 0.8, P, 24, 0.3), { tone: "mid" }),
    L(k.segment([cx, cy, z + 0.8], [cx + 3.2, cy + 1.4, z + 5], P), { tone: "hi" }).replace("<path", '<path style="stroke-width:1.4"'),
    `<circle class="gr-knob" cx="${at([cx + 3.2, cy + 1.4, z + 5])[0].toFixed(1)}" cy="${at([cx + 3.2, cy + 1.4, z + 5])[1].toFixed(1)}" r="1.3"/>`,
  ].join("");
}

// ---------- slitte dei rulli tenditori (si muovono con la lunghezza) ----------
function slider(lane) {
  const out = [];
  const block = { x: -6, y: -4, w: 12, d: 8, r: 1.5 };
  out.push(`<path class="iso-halo" d="${k.haloOf(block, 0, 1, P)}" style="filter:blur(3px)"/>`);
  if (lane.k === 1) {
    const arm = { x: POINTER_DX - 1.2, y: 3.8, w: 2.4, d: 10.6, r: 0.6 };
    out.push(S(k.slabOf(arm, 1.6, 0.8, P, 2, 0.2), { tone: "hi", crease: "lo" }));
    out.push(L(k.lineOnTop([POINTER_DX, 11.6], [POINTER_DX, 14.4], 2.4, P), { tone: "hi" }));
  }
  out.push(S(k.slabOf(block, 0, 3, P, 4, 0.5), { tone: "mid" }));
  out.push(D([[-4.2, -2.4], [-4.2, 2.4], [4.2, -2.4], [4.2, 2.4]].map(([x, y]) => at([x, y, 3])), { size: 0.4 }));
  out.push(S(k.cylinder(0, 0, 4.5, 3, 1.4, P, 36, 0.3), { tone: "mid" }));
  // vite di bloccaggio sul fianco in vista
  const sx = lane.k === 1 ? -2.6 : 0;
  const F = G.frameAlong([sx, 4, 1.5], [0, 1, 0]);
  out.push(S(G.disc(0, 1.2, 1, F, P), { tone: "mid" }));
  out.push(S(G.disc(1.2, 3.4, 1.5, F, P), { tone: "mid" }));
  out.push(L(G.ribsOf(F, 1.2, 3.4, 1.5, 14, P, { least: 0.3 }), { tone: "lo" }));
  return out.join("");
}
const sliderAt = (lane, b) => k.translateAlong(P, [X0 + spanOf(b, lane.k), lane.y, 0]);

// ---------- contagiri: un giro di lancetta per ogni giro del primo loop ----------
function dialTicks(beats) {
  const t = k.radialTicks(DIAL[0], DIAL[1], DIAL_R - 2.6, beats * 4, 4, DIAL_TOP, [1.1, 2.4], P);
  return L(t.minor, { tone: "lo" }) + L(t.major, { tone: "mid" });
}
const needleAt = (turn) => {
  const a = turn * Math.PI * 2, [x, y] = DIAL;
  return k.lineOnTop([x - Math.sin(a) * 3, y + Math.cos(a) * 3], [x + Math.sin(a) * (DIAL_R - 4.4), y - Math.cos(a) * (DIAL_R - 4.4)], DIAL_TOP + 0.2, P);
};
function dial() {
  const [x, y] = DIAL;
  return [
    `<path class="iso-halo" d="${k.cylinder(x, y, 11, 0, 1, P, 40).fill}" style="filter:blur(5px)"/>`,
    S(k.cylinder(x, y, 9.5, 0, DIAL_Z, P, 48, 0.4), { tone: "mid" }),
    D([0, 1, 2].map((i) => { const t = (i / 3) * Math.PI * 2 + 0.9; return at([x + 7.8 * Math.cos(t), y + 7.8 * Math.sin(t), DIAL_Z]); }), { size: 0.42 }),
    S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_TOP - DIAL_Z, P, 72, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3.2, P, 48), { tone: "faint" }) }),
    L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3.2, DIAL_TOP, 90, P, 0.3), { tone: "lo" }),
    L(k.ring(x, y, DIAL_R - 2.6, DIAL_TOP, P, 72), { tone: "lo" }),
    `<g data-part="ticks">${dialTicks(beatsFor(B0))}</g>`,
    `<path data-part="needle" class="iso-line" data-tone="hi" data-free="" d="${needleAt(0)}" style="stroke-width:1.1"/>`,
    L(k.ring(x, y, 1.6, DIAL_TOP, P, 16), { tone: "mid" }),
  ].join("");
}

// Il filo dalla testina del primo loop al contagiri.
function wire() {
  const y = LANES[0].y;
  const from = at([X0 + 8.4, y + 11, 2.2]), to = at([DIAL[0] + 8, DIAL[1] - 4.4, 1.6]);
  const via = [at([X0 + 8.4, y + 13.5, 0]), at([DIAL[0] + 12, DIAL[1] - 4, 0])];
  return k.wireSvg(from, to, { via, tone: "lo", size: 0.8 });
}
function motorWire() {
  const [mx, my] = MOTOR;
  const from = at([mx + 11.8, my - 1.2, 19]), to = at([-76, -57, 5]);
  return k.wireSvg(from, to, { via: [at([mx + 15, my - 2, 0]), at([-78, -54, 0])], tone: "lo", size: 0.8 });
}

// ---------- assemblaggio ----------
const lanesBack = [...LANES].map((lane, i) => ({ lane, i })).reverse();
const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT,
  label: "Una piastra con tre anelli di nastro, lunghi uno, due e tre giri. Una sola cinghia, mossa da un motore, fa girare i tre capstan alla stessa velocità; il rullo tenditore di ogni anello scorre in una cava e fissa la sua lunghezza. Il primo anello decide il giro, gli altri ne sono multipli interi, e le loro giunte ripassano dalla testina sempre insieme.",
  body: [
    plate(), slots(), ruler(), labelPlate(), splicer(), reel(), powerSwitch(),
    ...LANES.map((lane, i) => `<g data-slider="${i}" transform="${sliderAt(lane, B0)}">${slider(lane)}</g>`).reverse(),
    drive(), motorWire(), wire(),
    ...lanesBack.map(({ lane, i }) => `<g data-lane="${i}">${laneSvg(k, P, lane, B0)}</g>`),
    dial(),
  ],
});

const n0 = beatsFor(B0);
const say = (b) => { const n = beatsFor(b); return `giro ${b.toFixed(2).replace(".", ",")} s · ${n} battiti · ${Math.round((60 * n) / b)} BPM`; };

const live = `
const P = ${JSON.stringify(P)};
const k = { iso, depthOf, radialTicks, pathOf, cylinder, slabOf, insetPlan, planOutline, solidSvg, lineSvg, dotsSvg, lineOnTop, segment, towardViewer, cameraOf };
const DIAL = ${JSON.stringify(DIAL)}, DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP};
const POINTER_DX = ${POINTER_DX};
const dialTicks = ${dialTicks.toString().replace(/\bL\(/g, "lineSvgShort(")};
const lineSvgShort = (d, s) => lineSvg(d, s);
const needleAt = ${needleAt.toString().replace(/k\.lineOnTop/g, "lineOnTop")};
const say = ${say.toString()};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const lanes = [...svg.querySelectorAll("[data-lane]")].sort((a, b) => a.dataset.lane - b.dataset.lane);
const sliders = [...svg.querySelectorAll("[data-slider]")].sort((a, b) => a.dataset.slider - b.dataset.slider);
const ticks = svg.querySelector('[data-part="ticks"]');
const needle = svg.querySelector('[data-part="needle"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const TOUR = [2.4, 1.65, 3.0, 3.5, 2.0];
let refs = [];
let b = ${B0}, target = b, built = -1, beats = ${n0};
let theta = 0.32, last = 0, clock = 0, frame = 0, visible = false, touring = true, idle = 0;
const flash = W.LANES.map(() => -10), lastPhase = W.LANES.map(() => 0);
function build() {
  W.LANES.forEach((lane, i) => {
    lanes[i].innerHTML = laneSvg(k, P, lane, b);
    sliders[i].setAttribute("transform", translateAlong(P, [W.X0 + spanOf(b, lane.k), lane.y, 0]));
  });
  refs = lanes.map((g) => ({
    far: g.querySelector('[data-w="far"]'), near: g.querySelector('[data-w="near"]'),
    sFar: g.querySelector('[data-s="far"]'), sNear: g.querySelector('[data-s="near"]'),
    led: g.querySelector("[data-led]"),
  }));
  const n = beatsFor(b);
  if (n !== beats) { beats = n; ticks.innerHTML = dialTicks(n); }
  built = b;
}
function draw(now) {
  if (Math.abs(b - built) > 0.0015) build();
  W.LANES.forEach((lane, i) => {
    const phase = (((theta % lane.k) + lane.k) % lane.k) / lane.k;
    if (phase < lastPhase[i] - 0.5) flash[i] = now;
    lastPhase[i] = phase;
    const m = marksOf(k, P, lane, b, phase, NOTES[i]);
    const r = refs[i];
    r.far.setAttribute("d", m.far); r.near.setAttribute("d", m.near);
    r.sFar.setAttribute("d", m.spliceSide === "far" ? m.splice : "");
    r.sNear.setAttribute("d", m.spliceSide === "near" ? m.splice : "");
    r.led.setAttribute("opacity", still.matches ? "0" : Math.exp(-(now - flash[i]) / 220).toFixed(3));
  });
  needle.setAttribute("d", needleAt(theta % 1));
  const text = say(b);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", b.toFixed(2));
  stage.setAttribute("aria-valuetext", text);
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring && !calm) { clock += dt; target = TOUR[Math.floor(clock / 4.5) % TOUR.length]; }
  b = calm ? target : b + (target - b) * (1 - Math.exp(-dt / 0.45));
  if (Math.abs(target - b) < 0.0005) b = target;
  if (!calm) theta += dt / b;
  draw(now);
  frame = visible && !(calm && b === target) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false; target = clamp(next, W.B_MIN, W.B_MAX);
  clearTimeout(idle); idle = setTimeout(() => { touring = true; clock = 0; run(); }, 5000);
  run();
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  steer(W.B_MIN + clamp(((event.clientX - box.left) / box.width - 0.15) / 0.7, 0, 1) * (W.B_MAX - W.B_MIN));
});
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = target + 0.1;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = target - 0.1;
  if (event.key === "Home") to = W.B_MIN;
  if (event.key === "End") to = W.B_MAX;
  if (to === null) return;
  event.preventDefault();
  steer(Math.round(to * 20) / 20);
});
build();
draw(performance.now());
`;

const CSS = `<style>
.iso{--gr-tape-0:#1f1f1f;--gr-tape-1:#232323;--gr-tape-2:#272727;--gr-tape-3:#2b2b2b;--gr-wave:#7a7a7a}
.iso[data-theme="light"]{--gr-tape-0:#cfcec9;--gr-tape-1:#d7d6d1;--gr-tape-2:#dfded9;--gr-tape-3:#e7e6e1;--gr-wave:#8a8a8f}
.iso .gr-tape.iso-solid>.iso-shade[data-shade="0"]{fill:var(--gr-tape-0);stroke:var(--gr-tape-0)}
.iso .gr-tape.iso-solid>.iso-shade[data-shade="1"]{fill:var(--gr-tape-1);stroke:var(--gr-tape-1)}
.iso .gr-tape.iso-solid>.iso-shade[data-shade="2"]{fill:var(--gr-tape-2);stroke:var(--gr-tape-2)}
.iso .gr-tape.iso-solid>.iso-shade[data-shade="3"]{fill:var(--gr-tape-3);stroke:var(--gr-tape-3)}
.gr-wave{fill:var(--gr-wave);opacity:.75;stroke:none}
.gr-led-base{fill:var(--anatomy-lo)}
.gr-led{fill:var(--anatomy-lit)}
.gr-knob{fill:var(--anatomy-paper);stroke:var(--anatomy-hi);stroke-width:.6}
</style>`;

const body = CSS + k.plateHtml({
  fig: "Fig 1",
  title: "Come gira un loop",
  hint: "Muovi il puntatore per cambiare il primo giro",
  readout: say(B0),
  keys: [
    { mark: "lit", label: "La giunta di ogni anello: dove è partita la registrazione" },
    { mark: "raised", label: "Tre anelli di nastro: uno, due e tre giri" },
    { mark: "flat", label: "Una sola cinghia: stessa velocità per tutti" },
  ],
  caption:
    "Il primo loop dura quanto lo suoni: da qui Giro ricava il tempo, supponendo 1, 2, 4 o 8 battiti tra 70 e 140 BPM. Ogni loop successivo è lungo un numero intero di giri, così il nastro corre alla stessa velocità per tutti e le giunte ripassano dalla testina insieme: il primo a ogni giro, il secondo ogni due, il terzo ogni tre. La lancetta fa un giro per ogni giro del primo loop; i tratti lunghi sono i battiti, quelli corti i sedicesimi su cui si quantizza.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Lunghezza del primo giro: le frecce la cambiano di un decimo di secondo" aria-valuemin="${W.B_MIN}" aria-valuemax="${W.B_MAX}" aria-valuenow="${B0}">${svg}</div>`,
});

const out = theme === "light" ? "figura-loop-chiara.html" : "figura-loop.html";
const html = k.pageHtml({ title: "Come gira un loop", theme, body, script: strip("kit/iso-kit.mjs") + "\n" + strip("tape.mjs") + "\n" + live }).replace('<html lang="en">', '<html lang="it">');
writeFileSync(join(HERE, out), html);
console.log("scritto", out, (html.length / 1024).toFixed(0) + " KB");

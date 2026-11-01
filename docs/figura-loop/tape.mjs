// Modello e geometria viva della figura: gli anelli di nastro, i loro rulli e la testina.
// Usato sia dal build sia dalla pagina (il testo del file viene incorporato senza "export"):
// non deve dipendere da nient'altro che dalle funzioni del kit passate in `k`.

export const W = {
  X0: -112,          // asse dei capstan (tutti sulla stessa cinghia)
  RT: 4.3,           // raggio del nastro attorno a capstan e rullo tenditore
  ZT0: 5.4,          // bordo basso del nastro
  ZT1: 11.6,         // bordo alto del nastro
  HX: 9.9,           // la testina sta 9,9 unità dopo il capstan
  SPEED: 40,         // unità di nastro al secondo: uguale per tutti gli anelli
  B_MIN: 1.6,
  B_MAX: 3.6,
  LANES: [
    { k: 1, y: 26 },
    { k: 2, y: 2 },
    { k: 3, y: -22 },
  ],
};

// Come Giro (app.js, beatsFor): 1, 2, 4, 8… battiti finché il tempo sta sopra 70 BPM.
export function beatsFor(secs) {
  let n = 1;
  while ((60 * n) / secs < 70) n *= 2;
  return n;
}

// Distanza tra capstan e rullo tenditore perché l'anello duri k giri da `b` secondi.
export const spanOf = (b, kk) => (W.SPEED * kk * b - 2 * Math.PI * W.RT) / 2;
export const perimeterOf = (b, kk) => W.SPEED * kk * b;

// Punto e normale uscente del nastro a distanza s dalla testina, nel verso in cui corre.
export function tapeAt(D, y, s) {
  const { X0, RT, HX } = W;
  const L0 = D - HX, A = Math.PI * RT;
  if (s < L0) return { p: [X0 + HX + s, y + RT], n: [0, 1] };
  s -= L0;
  if (s < A) { const t = Math.PI / 2 - s / RT; return { p: [X0 + D + RT * Math.cos(t), y + RT * Math.sin(t)], n: [Math.cos(t), Math.sin(t)] }; }
  s -= A;
  if (s < D) return { p: [X0 + D - s, y - RT], n: [0, -1] };
  s -= D;
  if (s < A) { const t = -Math.PI / 2 - s / RT; return { p: [X0 + RT * Math.cos(t), y + RT * Math.sin(t)], n: [Math.cos(t), Math.sin(t)] }; }
  s -= A;
  return { p: [X0 + s, y + RT], n: [0, 1] };
}

// Stazioni lungo l'anello: i tratti dritti a passi di 5, gli archi in 18 parti.
export function stationsOf(D) {
  const { RT, HX } = W;
  const A = Math.PI * RT, out = [];
  const run = (from, length, count) => { for (let i = 0; i < count; i++) out.push(from + (length * i) / count); };
  let s = 0;
  const L0 = D - HX;
  run(s, L0, Math.max(1, Math.ceil(L0 / 5))); s += L0;
  run(s, A, 18); s += A;
  run(s, D, Math.max(1, Math.ceil(D / 5))); s += D;
  run(s, A, 18); s += A;
  run(s, HX, 2); s += HX;
  out.push(s);
  return out;
}

const facingOf = (k, P, n) => { const [vx, vy] = k.towardViewer(P); return n[0] * vx + n[1] * vy; };

// Il colore di una faccia del nastro, con la stessa regola del kit (extrude).
function shadeOf(k, P, n) {
  const { sinA, cosA } = k.cameraOf(P);
  const lit = (n[0] * -sinA + n[1] * cosA + 1) / 2;
  return Math.min(3, Math.max(0, Math.floor(lit * 4)));
}

function post(k, P, cx, cy, bottom, part) {
  if (part === "low") return k.solidSvg(k.cylinder(cx, cy, 5.5, bottom, W.ZT0 - bottom, P, 40, 0.4), { tone: "mid" });
  if (part === "body") return k.solidSvg(k.cylinder(cx, cy, 4, W.ZT0, W.ZT1 - W.ZT0, P, 36), { tone: "mid", crease: "none" });
  return (
    k.solidSvg(k.cylinder(cx, cy, 5.5, W.ZT1, 1, P, 40, 0.4), { tone: "mid" }) +
    k.solidSvg(k.cylinder(cx, cy, 2.6, W.ZT1 + 1, 1.6, P, 24, 0.3), { tone: "hi", crease: "lo" }) +
    k.lineSvg(k.lineOnTop([cx - 1.8, cy], [cx + 1.8, cy], W.ZT1 + 2.6, P), { tone: "lo" })
  );
}

// Il nastro di un anello: facce lontane (si vede l'interno) e vicine, ognuna con i suoi bordi.
function ribbon(k, P, D, y) {
  const st = stationsOf(D);
  const quads = [];
  for (let i = 0; i < st.length - 1; i++) {
    const a = tapeAt(D, y, st[i]).p, b = tapeAt(D, y, st[i + 1] - 1e-9).p;
    const mid = tapeAt(D, y, (st[i] + st[i + 1]) / 2);
    const out = facingOf(k, P, mid.n);
    const near = out > 0;
    const face = near ? mid.n : [-mid.n[0], -mid.n[1]];
    quads.push({ a, b, near, shade: shadeOf(k, P, face) });
  }
  const side = (near) => {
    const shades = [[], [], [], []], top = [], bottom = [];
    let runTop = [], runBottom = [];
    const flush = () => { if (runTop.length) { top.push(k.pathOf(runTop)); bottom.push(k.pathOf(runBottom)); } runTop = []; runBottom = []; };
    quads.forEach((q) => {
      if (q.near !== near) { flush(); return; }
      const ta = k.iso([q.a[0], q.a[1], W.ZT1], P), tb = k.iso([q.b[0], q.b[1], W.ZT1], P);
      const ba = k.iso([q.a[0], q.a[1], W.ZT0], P), bb = k.iso([q.b[0], q.b[1], W.ZT0], P);
      shades[q.shade].push(k.pathOf([ta, tb, bb, ba], true));
      if (!runTop.length) { runTop.push(ta); runBottom.push(ba); }
      runTop.push(tb); runBottom.push(bb);
    });
    flush();
    const fill = shades.map((list, i) => (list.length ? `<path class="iso-shade" data-shade="${i}" d="${list.join("")}"/>` : "")).join("");
    return `<g class="iso-solid gr-tape" data-seamless="">${fill}</g>` +
      k.lineSvg(top.join(""), { tone: near ? "hi" : "mid" }) + k.lineSvg(bottom.join(""), { tone: near ? "hi" : "mid" });
  };
  // Dove il nastro gira dal lato in vista a quello interno: il suo contorno verticale.
  const limbs = [];
  for (let i = 1; i < quads.length; i++) {
    if (quads[i].near !== quads[i - 1].near) { const p = quads[i].a; limbs.push(k.segment([p[0], p[1], W.ZT0], [p[0], p[1], W.ZT1], P)); }
  }
  return { far: side(false), near: side(true), limbs: k.lineSvg(limbs.join(""), { tone: "hi" }) };
}

function head(k, P, y) {
  const x = W.X0 + 7.0;
  const mount = { x, y: y + 4.6, w: 6.0, d: 6.4, r: 0.8 };
  const body = { x: x + 0.4, y: y + 4.55, w: 5.2, d: 4.2, r: 1.2 };
  const top = 12.2;
  return (
    k.solidSvg(k.slabOf(mount, 0, 5, P, 3, 0.4), { tone: "mid" }) +
    k.dotsSvg([k.iso([x + 1.4, y + 9.9, 5], P), k.iso([x + 4.6, y + 9.9, 5], P)], { size: 0.42 }) +
    k.solidSvg(k.slabOf(body, 5, top - 5, P, 3, 0.4), { tone: "hi", crease: "lo" }) +
    k.lineSvg(k.planOutline(k.insetPlan(body, 1), top, P, 3), { tone: "faint" }) +
    `<circle class="gr-led-base" cx="${k.iso([x + 3, y + 6.65, top], P)[0].toFixed(1)}" cy="${k.iso([x + 3, y + 6.65, top], P)[1].toFixed(1)}" r="0.9"/>` +
    `<circle class="gr-led" data-led="" cx="${k.iso([x + 3, y + 6.65, top], P)[0].toFixed(1)}" cy="${k.iso([x + 3, y + 6.65, top], P)[1].toFixed(1)}" r="0.9" opacity="0"/>`
  );
}

// Tutto quello che sta all'altezza del nastro per un anello, nell'ordine del pittore.
export function laneSvg(k, P, lane, b) {
  const D = spanOf(b, lane.k);
  const tape = ribbon(k, P, D, lane.y);
  const cx = W.X0, tx = W.X0 + D;
  return [
    post(k, P, cx, lane.y, 4.2, "low"), post(k, P, tx, lane.y, 4.4, "low"),
    tape.far,
    `<path class="gr-wave" data-w="far" d=""/>`, `<path class="iso-line" data-tone="lit" data-s="far" d="" style="stroke-width:1.3"/>`,
    post(k, P, cx, lane.y, 0, "body"), post(k, P, tx, lane.y, 0, "body"),
    tape.near, tape.limbs,
    `<path class="gr-wave" data-w="near" d=""/>`, `<path class="iso-line" data-tone="lit" data-s="near" d="" style="stroke-width:1.3"/>`,
    post(k, P, cx, lane.y, 0, "top"), post(k, P, tx, lane.y, 0, "top"),
    head(k, P, lane.y),
  ].join("");
}

// Le note incise su ogni anello: [posizione nel giro dell'anello 0…1, ampiezza, decadimento].
export const NOTES = [
  [[0, 1, 0.05], [0.25, 0.7, 0.04], [0.5, 1, 0.05], [0.625, 0.45, 0.03], [0.75, 0.7, 0.04]],
  [[0, 0.8, 0.16], [0.25, 0.6, 0.12], [0.5, 0.8, 0.16], [0.75, 0.6, 0.1]],
  [[0.04, 0.55, 0.05], [0.17, 0.75, 0.06], [0.33, 0.5, 0.04], [0.5, 0.8, 0.08], [0.62, 0.45, 0.04], [0.79, 0.65, 0.07], [0.92, 0.4, 0.03]],
];

export function ampOf(notes, u) {
  let a = 0;
  for (const [at, gain, decay] of notes) {
    const d = (((u - at) % 1) + 1) % 1;
    a += gain * (d < 0.006 ? d / 0.006 : Math.exp(-(d - 0.006) / decay));
  }
  return Math.min(1, a) * 2.4;
}

// Forma d'onda e giunta di un anello quando la giunta è a `phase` (0…1) del suo giro.
export function marksOf(k, P, lane, b, phase, notes) {
  const D = spanOf(b, lane.k), per = perimeterOf(b, lane.k);
  const zc = (W.ZT0 + W.ZT1) / 2;
  const splice = phase * per;
  const runs = { far: [], near: [] };
  let run = null, side = null;
  const step = 1.2, count = Math.ceil(per / step);
  for (let i = 0; i <= count; i++) {
    const s = Math.min(per - 1e-6, i * step);
    const at = tapeAt(D, lane.y, s);
    const now = facingOf(k, P, at.n) > 0 ? "near" : "far";
    if (now !== side) { if (run && run.length > 1) runs[side].push(run); run = []; side = now; }
    const u = ((((s - splice) / per) % 1) + 1) % 1;
    run.push([at.p, ampOf(notes, u)]);
  }
  if (run && run.length > 1) runs[side].push(run);
  const shape = (list) => list.map((r) => {
    const up = r.map(([p, a]) => k.iso([p[0], p[1], zc + a], P));
    const down = r.map(([p, a]) => k.iso([p[0], p[1], zc - a], P)).reverse();
    return k.pathOf([...up, ...down], true);
  }).join("");
  const sp = tapeAt(D, lane.y, splice % per);
  const spliceSide = facingOf(k, P, sp.n) > 0 ? "near" : "far";
  const line = k.segment([sp.p[0], sp.p[1], W.ZT0], [sp.p[0], sp.p[1], W.ZT1], P);
  return { far: shape(runs.far), near: shape(runs.near), splice: line, spliceSide };
}

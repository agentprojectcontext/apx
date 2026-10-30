// The hero's background: blobos drawn with the text of their agent's .md, in a grid of monospace glyphs. Every
// 6.5 s each one moves and becomes another agent; glyphs near the pointer scatter. Still when motion is reduced.
type Eye = { x: number; y: number; w: number; h: number };
export type GlyphAgent = { src: string; eyes: Eye[]; text: string };
type Cell = {
  ch: string;
  to: string;
  r: number;
  g: number;
  b: number;
  a: number;
  tr: number;
  tg: number;
  tb: number;
  ta: number;
  sw: number;
};
type Slot = { c0: number; r0: number; cw: number; rh: number; ai: number };

const RAND = "01#%&*+=<>{}[]/\\|~:;abcdefghijklmnopqrstuvwxyz";

export function startGlyphs(canvas: HTMLCanvasElement, agents: GlyphAgent[]): void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  if (!ctx || !agents.length) return;
  const images = new Map<string, Promise<HTMLImageElement>>();
  const load = (src: string) => {
    let p = images.get(src);
    if (!p) {
      p = new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.src = src;
      });
      images.set(src, p);
    }
    return p;
  };
  const mouse = { x: -1e4, y: -1e4 };
  addEventListener(
    "pointermove",
    (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    },
    { passive: true },
  );
  const G = { cols: 0, rows: 0, cell: 6, lh: 7.8, cells: [] as Cell[], w: 0, h: 0, dpr: 1, slots: [] as Slot[] };
  let settleUntil = 0;

  const target = (s: Slot, a: GlyphAgent) =>
    load(a.src).then((im) => {
      const { cw, rh, c0, r0 } = s;
      if (!G.cols) return;
      const oc = document.createElement("canvas");
      oc.width = cw;
      oc.height = rh;
      const o = oc.getContext("2d", { willReadFrequently: true });
      if (!o) return;
      // Glyph cells are 1.3 times taller than wide, so the body is drawn squashed to come out round.
      const sw = cw * 1.12;
      const sh = sw / 1.3;
      const ox = (cw - sw) / 2;
      const oy = (rh - sh) / 2;
      o.drawImage(im, ox, oy, sw, sh);
      o.fillStyle = "#000";
      for (const e of a.eyes)
        o.fillRect(
          ox + (e.x / 256) * sw,
          oy + (e.y / 256) * sh,
          Math.max(1, (e.w / 256) * sw),
          Math.max(1, (e.h / 256) * sh),
        );
      const data = o.getImageData(0, 0, cw, rh).data;
      const now = performance.now();
      let ti = 0;
      for (let y = 0; y < rh; y++)
        for (let x = 0; x < cw; x++) {
          const gx = c0 + x;
          const gy = r0 + y;
          if (gx >= G.cols || gy >= G.rows) continue;
          const c = G.cells[gy * G.cols + gx];
          if (!c) continue;
          const i = (y * cw + x) * 4;
          const R = data[i] ?? 0;
          const Gg = data[i + 1] ?? 0;
          const B = data[i + 2] ?? 0;
          const A = (data[i + 3] ?? 0) / 255;
          const lum = (R * 0.3 + Gg * 0.59 + B * 0.11) / 255;
          if (A > 0.4 && lum > 0.12) {
            let ch = a.text[ti++ % a.text.length] ?? "·";
            if (ch === " ") ch = "·";
            const boost = 1.15 + (1 - lum) * 0.6;
            c.to = ch;
            c.tr = Math.min(255, R * boost + 12);
            c.tg = Math.min(255, Gg * boost + 12);
            c.tb = Math.min(255, B * boost + 12);
            c.ta = 0.5 + lum * 0.38;
          } else {
            c.to = " ";
            c.ta = 0;
          }
          c.sw = now + Math.random() * 500 + (x / cw) * 500;
        }
      settleUntil = performance.now() + 2000;
      wake();
    });

  const size = () => {
    const r = canvas.getBoundingClientRect();
    G.dpr = Math.min(2, devicePixelRatio || 1);
    G.w = r.width;
    G.h = r.height;
    canvas.width = Math.round(G.w * G.dpr);
    canvas.height = Math.round(G.h * G.dpr);
    const small = G.w < 760;
    G.cell = small ? 5 : 6;
    G.lh = G.cell * 1.3;
    G.cols = Math.floor(G.w / G.cell);
    G.rows = Math.floor(G.h / G.lh);
    G.cells = Array.from({ length: G.cols * G.rows }, (_, i) => {
      const dot = (i * 7919) % 31 === 0;
      return {
        ch: " ",
        to: dot ? "." : " ",
        r: 90,
        g: 98,
        b: 106,
        a: 0,
        tr: 90,
        tg: 98,
        tb: 106,
        ta: dot ? 0.28 : 0,
        sw: 0,
      };
    });
    // Uneven spots, so the three never line up.
    const spots = small
      ? [
          [0.1, 0.11, 92],
          [0.9, 0.2, 76],
        ]
      : [
          [0.11, 0.28, 150],
          [0.19, 0.62, 110],
          [0.88, 0.46, 170],
        ];
    G.slots = spots.map(([fx = 0, fy = 0, sz = 0], i) => {
      const cw = Math.round(sz / G.cell);
      const rh = Math.round(sz / G.lh);
      return {
        c0: Math.max(0, Math.round(fx * G.cols - cw / 2)),
        r0: Math.max(0, Math.round(fy * G.rows - rh / 2)),
        cw,
        rh,
        ai: i,
      };
    });
    for (const s of G.slots) void target(s, agents[s.ai % agents.length] as GlyphAgent);
  };

  const move = (t: number) => {
    const small = G.w < 760;
    const zones = small
      ? [
          [0.04, 0.2, 0.02, 0.26],
          [0.74, 0.96, 0.02, 0.3],
        ]
      : [
          [0.02, 0.26, 0.1, 0.42],
          [0.04, 0.3, 0.5, 0.8],
          [0.74, 0.97, 0.14, 0.72],
        ];
    G.slots.forEach((s, si) => {
      for (let y = 0; y < s.rh; y++)
        for (let x = 0; x < s.cw; x++) {
          const gx = s.c0 + x;
          const gy = s.r0 + y;
          const c = gx < G.cols && gy < G.rows ? G.cells[gy * G.cols + gx] : undefined;
          if (c) {
            c.to = " ";
            c.ta = 0;
            c.sw = t + Math.random() * 400;
          }
        }
      const [x0 = 0, x1 = 1, y0 = 0, y1 = 1] = zones[si % zones.length] ?? [];
      const fx = x0 + Math.random() * (x1 - x0);
      const fy = y0 + Math.random() * (y1 - y0);
      s.c0 = Math.max(0, Math.min(G.cols - s.cw, Math.round(fx * G.cols - s.cw / 2)));
      s.r0 = Math.max(0, Math.min(G.rows - s.rh, Math.round(fy * G.rows - s.rh / 2)));
      s.ai = (s.ai + G.slots.length) % agents.length;
      void target(s, agents[s.ai] as GlyphAgent);
    });
  };

  let visible = true;
  let raf = 0;
  let last = 0;
  let width = -1;
  const frame = (t: number) => {
    raf = 0;
    if (Math.abs(canvas.clientWidth - width) > 2) {
      width = canvas.clientWidth;
      size();
      last = t;
    }
    if (!reduce && t - last > 6500) {
      last = t;
      move(t);
    }
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.clearRect(0, 0, G.w, G.h);
    ctx.font = `600 ${G.cell + 1.5}px "Geist Mono", ui-monospace, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const R2 = 34 * 34;
    const k = reduce ? 1 : 0.1;
    for (let y = 0; y < G.rows; y++)
      for (let x = 0; x < G.cols; x++) {
        const c = G.cells[y * G.cols + x];
        if (!c || (c.ch === " " && c.to === " " && c.a < 0.02)) continue;
        const px = x * G.cell + G.cell / 2;
        const py = y * G.lh;
        c.r += (c.tr - c.r) * k;
        c.g += (c.tg - c.g) * k;
        c.b += (c.tb - c.b) * k;
        c.a += (c.ta - c.a) * k;
        let glyph = c.ch;
        let al = c.a;
        let ox = 0;
        let oy = 0;
        if (t > c.sw && c.ch !== c.to) {
          if (t - c.sw < 280 && !reduce) {
            glyph = RAND[(Math.random() * RAND.length) | 0] ?? ".";
            al = Math.max(al, 0.5);
          } else {
            c.ch = c.to;
            glyph = c.to;
          }
        }
        if (!reduce) {
          const dx = px - mouse.x;
          const dy = py - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            const f = 1 - d2 / R2;
            ox = dx * f * 0.3;
            oy = dy * f * 0.3;
            if (glyph !== " ") {
              al = Math.min(1, al + f * 0.5);
              if (Math.random() < f * 0.25) glyph = RAND[(Math.random() * RAND.length) | 0] ?? ".";
            }
          }
        }
        if (glyph === " " || al < 0.02) continue;
        ctx.fillStyle = `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${al.toFixed(2)})`;
        ctx.fillText(glyph, px + ox, py + oy);
      }
    // With reduced motion the field is drawn until it settles, then left still.
    if (visible && (!reduce || t < settleUntil)) wake();
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible) wake();
  }).observe(canvas);
  addEventListener("resize", wake);
  wake();
}

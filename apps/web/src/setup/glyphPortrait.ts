import { BLOBS, type BlobName } from "@apx/ui";
import type { Language } from "../i18n/index.ts";

/** One portrait: the blob it draws and the text of the file it is drawn with. */
type Scene = { key: BlobName; text: string };

const agentFile = (fm: Array<[string, string]>, body: string) =>
  `${fm.map(([k, v]) => `${k}: ${v}`).join(" ")} ${body}`;

// The mobile About's crew: an agent is a markdown file, and it remembers in another one.
const SCENES: Record<Language, Scene[]> = {
  en: [
    {
      key: "perla",
      text: agentFile(
        [
          ["name", "Tomás"],
          ["role", "Developer"],
          ["runtime", "claude-code"],
        ],
        "You are Tomás, the developer. Reproduce first, fix second, and always say which test proves it.",
      ),
    },
    {
      key: "papa",
      text: "# memory · night shift - Backups at 3:00, report at 9:00. - If a routine fails twice, tell Nova, not the owner.",
    },
    {
      key: "orbita",
      text: agentFile(
        [
          ["name", "Lucía"],
          ["role", "Product manager"],
          ["autonomy", "total"],
        ],
        "You are Lucía, product manager at Acme Store. Split big asks into tasks, assign them, and follow up.",
      ),
    },
    {
      key: "menta",
      text: "# memory · nova - The owner reads Telegram first thing, WhatsApp after lunch. - Never wake them for less than a blocker.",
    },
    {
      key: "caracol",
      text: agentFile(
        [
          ["name", "Vera"],
          ["role", "Marketing"],
          ["skills", "[newsletter, social-posts]"],
        ],
        "You are Vera. Short copy, one idea per post, and nothing goes out without a date.",
      ),
    },
    {
      key: "parche",
      text: "# memory · whatsapp desk - Answer saved contacts only. - Anything about money goes to the owner on Telegram.",
    },
  ],
  es: [
    {
      key: "perla",
      text: agentFile(
        [
          ["name", "Tomás"],
          ["role", "Desarrollador"],
          ["runtime", "claude-code"],
        ],
        "Sos Tomás, el desarrollador. Primero reproducí, después arreglá, y siempre decí qué test lo prueba.",
      ),
    },
    {
      key: "papa",
      text: "# memoria · turno noche - Backups a las 3:00, reporte a las 9:00. - Si una rutina falla dos veces, avisale a Nova.",
    },
    {
      key: "orbita",
      text: agentFile(
        [
          ["name", "Lucía"],
          ["role", "Product manager"],
          ["autonomy", "total"],
        ],
        "Sos Lucía, product manager de Acme Store. Dividí los pedidos grandes en tareas, asignalas y seguilas.",
      ),
    },
    {
      key: "menta",
      text: "# memoria · nova - El dueño lee Telegram a primera hora y WhatsApp después de almorzar. - Nunca lo despiertes por menos que un bloqueo.",
    },
    {
      key: "caracol",
      text: agentFile(
        [
          ["name", "Vera"],
          ["role", "Marketing"],
          ["skills", "[newsletter, social-posts]"],
        ],
        "Sos Vera. Textos cortos, una idea por posteo, y nada sale sin fecha.",
      ),
    },
    {
      key: "parche",
      text: "# memoria · mesa de whatsapp - Contestá sólo a contactos guardados. - Todo lo de plata va al dueño por Telegram.",
    },
  ],
};

const RAND = "01#%&*+=<>{}[]/\\|~:;abcdefghijklmnopqrstuvwxyz";
const EVERY_MS = 5500;

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

/** A blob's body with its eyes, at 256 units, ready to sample. */
function loadFace(key: BlobName): Promise<HTMLCanvasElement> {
  const blob = BLOBS[key];
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const out = document.createElement("canvas");
      out.width = out.height = 256;
      const o = out.getContext("2d");
      if (!o) return reject(new Error("no 2d context"));
      o.drawImage(img, 0, 0, 256, 256);
      o.fillStyle = blob.eyeColor;
      for (const e of blob.eyes) {
        o.beginPath();
        o.roundRect(e.x, e.y, e.w, e.h, e.rx);
        o.fill();
      }
      resolve(out);
    };
    img.onerror = reject;
    img.src = blob.src;
  });
}

/**
 * Draws an agent's face with the text of its own file, as the mobile About does, cycling through the crew; the
 * pointer pushes the characters it passes over aside. Returns the cleanup.
 */
export function startGlyphPortrait(canvas: HTMLCanvasElement, language: Language): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const scenes = SCENES[language];
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const faces = new Map<BlobName, Promise<HTMLCanvasElement>>();
  const face = (key: BlobName) => {
    let f = faces.get(key);
    if (!f) {
      f = loadFace(key);
      faces.set(key, f);
    }
    return f;
  };
  const g = { cols: 0, rows: 0, cell: 8, lh: 10.4, w: 0, h: 0, dpr: 1, mx: -1e4, my: -1e4, cells: [] as Cell[] };
  let at = 0;
  let timer = 0;
  let frame = 0;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    g.dpr = Math.min(3, window.devicePixelRatio || 1);
    g.w = r.width;
    g.h = r.height;
    canvas.width = Math.round(r.width * g.dpr);
    canvas.height = Math.round(r.height * g.dpr);
    g.lh = g.cell * 1.3;
    g.cols = Math.floor(g.w / g.cell);
    g.rows = Math.floor(g.h / g.lh);
    g.cells = Array.from({ length: g.cols * g.rows }, () => ({
      ch: " ",
      to: " ",
      r: 70,
      g: 76,
      b: 82,
      a: 0,
      tr: 70,
      tg: 76,
      tb: 82,
      ta: 0.3,
      sw: 0,
    }));
  };

  const target = (scene: Scene) => {
    const { cols, rows } = g;
    void face(scene.key)
      .then((im) => {
        if (cols !== g.cols || rows !== g.rows) return;
        const small = document.createElement("canvas");
        small.width = cols;
        small.height = rows;
        const o = small.getContext("2d", { willReadFrequently: true });
        if (!o) return;
        const sw = Math.min(cols, rows * 1.3) * 1.05;
        const sh = sw / 1.3;
        o.drawImage(im, (cols - sw) / 2, (rows - sh) / 2, sw, sh);
        const px = o.getImageData(0, 0, cols, rows).data;
        const text = scene.text.replace(/\s+/g, " ");
        const now = performance.now();
        let ti = 0;
        g.cells.forEach((c, k) => {
          const [R, G, B] = [px[k * 4] ?? 0, px[k * 4 + 1] ?? 0, px[k * 4 + 2] ?? 0];
          const A = (px[k * 4 + 3] ?? 0) / 255;
          const lum = (R * 0.3 + G * 0.59 + B * 0.11) / 255;
          if (A > 0.4 && lum > 0.12) {
            const ch = text[ti++ % text.length] ?? " ";
            const bo = 1.15 + (1 - lum) * 0.6;
            c.to = ch === " " ? "·" : ch;
            c.tr = Math.min(255, R * bo + 12);
            c.tg = Math.min(255, G * bo + 12);
            c.tb = Math.min(255, B * bo + 12);
            c.ta = 0.62 + lum * 0.38;
          } else if (A > 0.4) {
            c.to = " ";
            c.ta = 0;
          } else {
            c.to = (k * 7919) % 23 === 0 ? "." : " ";
            c.tr = 90;
            c.tg = 98;
            c.tb = 106;
            c.ta = 0.35;
          }
          c.sw = still ? 0 : now + Math.random() * 500 + ((k % cols) / cols) * 500;
        });
      })
      .catch(() => {});
  };

  const draw = (t: number) => {
    frame = requestAnimationFrame(draw);
    if (!g.cols) return;
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    ctx.font = `600 ${g.cell + 2}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const R2 = 42 * 42;
    const k = still ? 1 : 0.1;
    for (let y = 0; y < g.rows; y++)
      for (let x = 0; x < g.cols; x++) {
        const c = g.cells[y * g.cols + x];
        if (!c) continue;
        const px = x * g.cell + g.cell / 2;
        const py = y * g.lh;
        c.r += (c.tr - c.r) * k;
        c.g += (c.tg - c.g) * k;
        c.b += (c.tb - c.b) * k;
        c.a += (c.ta - c.a) * k;
        let ch = c.ch;
        let a = c.a;
        let ox = 0;
        let oy = 0;
        if (t > c.sw && c.ch !== c.to) {
          if (t - c.sw < 280) {
            ch = RAND[(Math.random() * RAND.length) | 0] ?? ch;
            a = Math.max(a, 0.5);
          } else {
            c.ch = c.to;
            ch = c.to;
          }
        }
        const dx = px - g.mx;
        const dy = py - g.my;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const f = 1 - d2 / R2;
          ox = dx * f * 0.35;
          oy = dy * f * 0.35;
          if (ch !== " ") {
            a = Math.min(1, a + f * 0.5);
            if (Math.random() < f * 0.25) ch = RAND[(Math.random() * RAND.length) | 0] ?? ch;
          }
        }
        if (ch === " " || a < 0.02) continue;
        ctx.fillStyle = `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a.toFixed(2)})`;
        ctx.fillText(ch, px + ox, py + oy);
      }
  };

  const show = () => {
    const scene = scenes[at % scenes.length];
    if (scene) target(scene);
    at++;
    window.clearTimeout(timer);
    if (!still) timer = window.setTimeout(show, EVERY_MS);
  };
  const point = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    g.mx = e.clientX - r.left;
    g.my = e.clientY - r.top;
  };
  const away = () => {
    g.mx = g.my = -1e4;
  };
  const resize = () => {
    size();
    const scene = scenes[(at + scenes.length - 1) % scenes.length];
    if (scene) target(scene);
  };

  canvas.addEventListener("pointermove", point);
  canvas.addEventListener("pointerleave", away);
  window.addEventListener("resize", resize);
  size();
  show();
  frame = requestAnimationFrame(draw);
  return () => {
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    canvas.removeEventListener("pointermove", point);
    canvas.removeEventListener("pointerleave", away);
    window.removeEventListener("resize", resize);
  };
}

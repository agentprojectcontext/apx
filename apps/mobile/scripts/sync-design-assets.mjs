import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shared = resolve(mobile, "../../packages/ui");
const target = resolve(mobile, "src/ui");
mkdirSync(target, { recursive: true });
const names = [
  "MessageCircle",
  "Inbox",
  "ListChecks",
  "Terminal",
  "LayoutGrid",
  "RefreshCw",
  "Bot",
  "Folder",
  "Send",
  "Brain",
  "FileText",
  "File",
  "FileAudio",
  "FileArchive",
  "Settings",
  "Search",
  "SquarePen",
  "ChevronLeft",
  "ChevronRight",
  "ChevronDown",
  "MoreHorizontal",
  "Plus",
  "Play",
  "ArrowUp",
  "Zap",
  "Check",
  "TriangleAlert",
  "Bell",
  "Square",
  "Wrench",
  "X",
  "KeyRound",
  "QrCode",
  "Link",
  "Trash2",
  "Moon",
  "Smartphone",
  "History",
  "Clock",
  "Users",
  "Plug",
  "BellOff",
  "MessageSquare",
  "Globe",
  "Info",
  "Pencil",
  "Pin",
  "PinOff",
  "Archive",
  "ArchiveRestore",
  "Paperclip",
  "Image",
  "Camera",
  "Mic",
  "CircleCheck",
  "CircleX",
  "Calendar",
  "RotateCcw",
  "Hand",
  "Flag",
  "UserRound",
  "Pause",
  "Copy",
  "Share2",
  "Download",
  "Video",
  "TextSelect",
  "Music",
  "Maximize",
  "WifiOff",
  "CheckCheck",
  "ListFilter",
  "Monitor",
  "Sparkles",
  "ExternalLink",
];
const icons = {};
for (const name of names) {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-z])([0-9])/g, "$1-$2")
    .toLowerCase();
  const folder = resolve(shared, "node_modules/lucide-react/dist/esm/icons");
  let source = readFileSync(resolve(folder, `${slug}.js`), "utf8");
  const alias = source.match(/export \{ default \} from '([^']+)'/);
  if (alias) source = readFileSync(resolve(folder, alias[1]), "utf8");
  const expression = source.match(/createLucideIcon\("[^"]+", ([\s\S]*?)\);/)[1];
  icons[name] = runInNewContext(expression).map(([tag, attrs]) => {
    const { key, ...geometry } = attrs;
    return [tag, geometry];
  });
}
writeFileSync(
  resolve(target, "iconNodes.ts"),
  `// Generated from the web's Lucide library by scripts/sync-design-assets.mjs.\nexport const iconNodes = ${JSON.stringify(icons, null, 2)} as const;\n`,
);
writeFileSync(resolve(target, "icons.LICENSE"), readFileSync(resolve(shared, "node_modules/lucide-react/LICENSE")));
const source = readFileSync(resolve(shared, "src/blobs/catalog.ts"), "utf8");
const eyes = {};
for (const match of source.matchAll(/ {2}(\w+): \{\s*label:.*?eyeColor: "([^"]+)",\s*eyes: \[([\s\S]*?)\],/gs)) {
  eyes[match[1]] = {
    color: match[2],
    eyes: [...match[3].matchAll(/\{([^}]+)\}/g)].map((eye) =>
      Object.fromEntries([...eye[1].matchAll(/(x|y|w|h|rx): ([\d.]+)/g)].map((value) => [value[1], Number(value[2])])),
    ),
  };
}
writeFileSync(
  resolve(target, "blobEyes.ts"),
  `// Generated from the shared 256-unit blob catalog by scripts/sync-design-assets.mjs.\nexport const blobEyes: Record<string, { color: string; eyes: Array<{ x: number; y: number; w: number; h: number; rx: number }> }> = ${JSON.stringify(eyes, null, 2)};\n`,
);
writeFileSync(
  resolve(target, "engineMarks.ts"),
  `// Synced from packages/ui/src/engine-marks.ts by scripts/sync-design-assets.mjs.\n${readFileSync(resolve(shared, "src/engine-marks.ts"), "utf8")}`,
);

// The panel's minimal look, light and dark (dark overrides the light block), as plain native colors and numbers.
const css = readFileSync(resolve(shared, "src/styles/tokens.css"), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css: no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--apx-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const light = block('.apx,\n[data-apx-look="minimal"]');
// Hermes reads rgba(), not the CSS4 space syntax the stylesheet uses.
const native = (value) =>
  value.replace(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/, (_, r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a})`);
const nativeTokens = (vars) => {
  const tokens = {};
  for (const [name, value] of Object.entries(vars)) {
    // Colors and sizes only: the rest are web-only choices (fonts, text transforms, shadows).
    if (!/^(#|rgb|\d+px$)/.test(value)) continue;
    const key = name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    tokens[key] = /^\d+px$/.test(value) ? Number.parseInt(value, 10) : native(value);
  }
  return tokens;
};
const palettes = {
  light: nativeTokens(light),
  dark: nativeTokens({ ...light, ...block('[data-apx-look="minimal"][data-apx-mode="dark"]') }),
};
writeFileSync(
  resolve(target, "tokens.ts"),
  `// Generated from packages/ui/src/styles/tokens.css (minimal look) by scripts/sync-design-assets.mjs.\nexport const palettes = ${JSON.stringify(palettes, null, 2)} as const;\n`,
);

mkdirSync(resolve(mobile, "assets"), { recursive: true });
writeFileSync(resolve(mobile, "assets/logo.png"), readFileSync(resolve(mobile, "../web/src/assets/logo.png")));

// The panel's routine activation slots and weekly-cron reading, so both apps draw the same bars.
mkdirSync(resolve(mobile, "src/routines"), { recursive: true });
for (const file of ["slots.ts", "cron.ts"]) {
  const code = readFileSync(resolve(mobile, "../web/src/routines", file), "utf8").replace(
    'from "@apx/protocol"',
    'from "../../../../packages/protocol/src/index.ts"',
  );
  writeFileSync(
    resolve(mobile, "src/routines", file),
    `// Synced from apps/web/src/routines/${file} by scripts/sync-design-assets.mjs.\n${code}`,
  );
}

// The board's due dates and the way a task's history reads, so the phone and the panel say the same.
mkdirSync(resolve(mobile, "src/tasks"), { recursive: true });
for (const file of ["when.ts", "history.ts"]) {
  const code = readFileSync(resolve(mobile, "../web/src/tasks", file), "utf8").replace(
    'from "@apx/protocol"',
    'from "../../../../packages/protocol/src/index.ts"',
  );
  writeFileSync(
    resolve(mobile, "src/tasks", file),
    `// Synced from apps/web/src/tasks/${file} by scripts/sync-design-assets.mjs.\n${code}`,
  );
}

// The bodies the About portrait draws, inlined: its WebView loads nothing from outside.
const FACES = ["orbita", "perla", "caracol", "menta", "papa", "parche"];
const faces = Object.fromEntries(
  FACES.map((key) => [
    key,
    `data:image/webp;base64,${readFileSync(resolve(shared, `src/blobs/bodies/${key}.webp`)).toString("base64")}`,
  ]),
);
mkdirSync(resolve(mobile, "src/about"), { recursive: true });
writeFileSync(
  resolve(mobile, "src/about/faces.ts"),
  `// Generated from packages/ui/src/blobs/bodies by scripts/sync-design-assets.mjs.\nexport const faces: Record<string, string> = ${JSON.stringify(faces, null, 2)};\n`,
);

writeFileSync(
  resolve(target, "channelMarks.ts"),
  `// Synced from packages/ui/src/channel-marks.ts by scripts/sync-design-assets.mjs.\n${readFileSync(resolve(shared, "src/channel-marks.ts"), "utf8")}`,
);

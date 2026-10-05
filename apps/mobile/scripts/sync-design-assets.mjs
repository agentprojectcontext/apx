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
];
const icons = {};
for (const name of names) {
  const slug = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
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

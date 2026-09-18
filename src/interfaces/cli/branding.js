// APX CLI branding — a consistent "you're running APX vX" mark on every command.
//
// Two shapes:
//   apxBanner(version, subtitle)  big ASCII wordmark for branding-heavy moments
//                                 (onboarding, top-level entry). Loud on purpose.
//   apxHeader(version, subtitle)  one-line "▸ APX CLI · vX · <subtitle>" for the
//                                 everyday commands. Quiet, never in the way.
//
// Both write to STDERR so they never pollute piped stdout (`apx exec … | jq`,
// `apx config show > file`). Like mascot.js, they always print (so the mark is
// truly on every run), and self-suppress only when APX_QUIET / APX_NO_BANNER is
// set — the escape hatch for scripts and CI.
//
// Color: reuses raw ANSI like mascot.js. Honors NO_COLOR.

const NO_COLOR = !!process.env.NO_COLOR;
const c = (code) => (s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const B = c("1");
const DI = c("2");
const GR = c("32");
const CY = c("36");
const WH = c("97");

function suppressed() {
  return !!(process.env.APX_NO_BANNER || process.env.APX_QUIET);
}

// Compact header — the mark, not just the word. The default for everyday
// subcommands.
//
//    ▄█████▄
//   █ ◕   ◕ █   APX CLI · v1.34.0 · skills inspector
//    ▀█████▀
//
// Three lines rather than the wordmark's eight: the face is what people
// recognise, and a command that prints a logo taller than its own output is a
// logo that gets suppressed. Same head as core/mascot.js and the web's Splash —
// one character everywhere, at the size each place can afford.
export function apxHeader(version, subtitle = "") {
  if (suppressed()) return;
  const tag = `${B(WH("APX"))} ${DI("CLI")}`;
  const ver = DI(`v${version}`);
  const sub = subtitle ? `  ${DI("·")}  ${CY(subtitle)}` : "";
  const text = `${tag}  ${DI("·")}  ${ver}${sub}`;
  process.stderr.write(
    "\n" +
    `   ${GR("▄█████▄")}\n` +
    `  ${GR("█ ◕   ◕ █")}   ${text}\n` +
    `   ${GR("▀█████▀")}\n` +
    "\n"
  );
}

// Big ASCII wordmark for branding-heavy commands.
export function apxBanner(version, subtitle = "") {
  if (suppressed()) return;
  const g = (s) => GR(s);
  const lines = [
    "",
    `  ${g("█████╗ ██████╗ ██╗  ██╗")}`,
    `  ${g("██╔══██╗██╔══██╗╚██╗██╔╝")}`,
    `  ${g("███████║██████╔╝ ╚███╔╝ ")}   ${B(WH("Agent Project Context"))}`,
    `  ${g("██╔══██║██╔═══╝  ██╔██╗ ")}   ${DI(`v${version}`)}`,
    `  ${g("██║  ██║██║     ██╔╝ ██╗")}${subtitle ? `   ${CY(subtitle)}` : ""}`,
    `  ${g("╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝")}`,
    "",
  ];
  process.stderr.write(lines.join("\n") + "\n");
}

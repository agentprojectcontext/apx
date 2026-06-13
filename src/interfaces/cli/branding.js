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

// Compact, single-line header. The default for everyday subcommands.
//   ▸ APX CLI · v1.34.0 · skills inspector
export function apxHeader(version, subtitle = "") {
  if (suppressed()) return;
  const tag = `${GR("▸")} ${B(WH("APX"))} ${DI("CLI")}`;
  const ver = DI(`v${version}`);
  const sub = subtitle ? `  ${DI("·")}  ${CY(subtitle)}` : "";
  process.stderr.write(`\n${tag}  ${DI("·")}  ${ver}${sub}\n\n`);
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

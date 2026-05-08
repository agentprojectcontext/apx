// APX mascot — a panda that appears in different moods across the CLI.
// Usage: import { mascot } from '../core/mascot.js'; mascot('happy');

const R = "\x1b[0m";
const B = "\x1b[1m";
const W = "\x1b[97m";       // bright white
const K = "\x1b[30m";       // black
const BK = "\x1b[40m";      // bg black
const BW = "\x1b[47m";      // bg white
const CY = "\x1b[36m";
const YE = "\x1b[33m";
const GR = "\x1b[32m";
const RE = "\x1b[31m";
const DI = "\x1b[2m";
const BL = "\x1b[34m";

// Each mood: [panda lines, caption]
const MOODS = {
  // ─── happy: default greeting / daemon started ────────────────────────────
  happy: {
    color: GR,
    lines: [
      `   ${BK}${W}  ▄███████▄  ${R}`,
      `  ${BK}${W} █ ${R}${B}██${R}${W}   ${B}██${R}${BK}${W} █ ${R}`,
      `  ${BK}${W} █  ◕   ◕  █ ${R}`,
      `  ${BK}${W} █   ╰ω╯   █ ${R}`,
      `   ${BK}${W}  ▀███████▀  ${R}`,
      `   ${DI}   ╱  ╲  ╱  ╲   ${R}`,
    ],
    caption: `${GR}${B}ready to go!${R}`,
  },

  // ─── wave: first run / setup ─────────────────────────────────────────────
  wave: {
    color: CY,
    lines: [
      `   ${BK}${W}  ▄███████▄  ${R}     👋`,
      `  ${BK}${W} █ ${R}${B}██${R}${W}   ${B}██${R}${BK}${W} █ ${R}`,
      `  ${BK}${W} █  ◕   ◕  █ ${R}`,
      `  ${BK}${W} █   ╰▽╯   █ ${R}`,
      `   ${BK}${W}  ▀███████▀  ${R}`,
      `   ${DI}   ╱  ╲  ╱  ╲   ${R}`,
    ],
    caption: `${CY}${B}APX — Agent Project Context${R}`,
  },

  // ─── confused: unknown command / not found ────────────────────────────────
  confused: {
    color: YE,
    lines: [
      `   ${BK}${W}  ▄███████▄  ${R}  ${YE}?${R}`,
      `  ${BK}${W} █ ${R}${B}██${R}${W}   ${B}██${R}${BK}${W} █ ${R}`,
      `  ${BK}${W} █  ◔   ◔  █ ${R}`,
      `  ${BK}${W} █   ╰~╯   █ ${R}`,
      `   ${BK}${W}  ▀███████▀  ${R}`,
      `   ${DI}   ╱  ╲  ╱  ╲   ${R}`,
    ],
    caption: `${YE}${B}hmm, I don't know that one${R}`,
  },

  // ─── sad: error ───────────────────────────────────────────────────────────
  sad: {
    color: RE,
    lines: [
      `   ${BK}${W}  ▄███████▄  ${R}`,
      `  ${BK}${W} █ ${R}${B}██${R}${W}   ${B}██${R}${BK}${W} █ ${R}`,
      `  ${BK}${W} █  ╥   ╥  █ ${R}`,
      `  ${BK}${W} █   ╰︵╯   █ ${R}`,
      `   ${BK}${W}  ▀███████▀  ${R}`,
      `   ${DI}   ╱  ╲  ╱  ╲   ${R}`,
    ],
    caption: `${RE}${B}something went wrong${R}`,
  },

  // ─── excited: update available ────────────────────────────────────────────
  excited: {
    color: BL,
    lines: [
      `   ${BK}${W}  ▄███████▄  ${R}  ${BL}⬆${R}`,
      `  ${BK}${W} █ ${R}${B}██${R}${W}   ${B}██${R}${BK}${W} █ ${R}`,
      `  ${BK}${W} █  ★   ★  █ ${R}`,
      `  ${BK}${W} █   ╰◡╯   █ ${R}`,
      `   ${BK}${W}  ▀███████▀  ${R}`,
      `   ${DI}   ╱  ╲  ╱  ╲   ${R}`,
    ],
    caption: `${BL}${B}new version available!${R}`,
  },

  // ─── sleeping: daemon not running ────────────────────────────────────────
  sleeping: {
    color: DI,
    lines: [
      `   ${BK}${W}  ▄███████▄  ${R}  ${DI}z z z${R}`,
      `  ${BK}${W} █ ${R}${B}██${R}${W}   ${B}██${R}${BK}${W} █ ${R}`,
      `  ${BK}${W} █  −   −  █ ${R}`,
      `  ${BK}${W} █   ╰_╯   █ ${R}`,
      `   ${BK}${W}  ▀███████▀  ${R}`,
      `   ${DI}   ╱  ╲  ╱  ╲   ${R}`,
    ],
    caption: `${DI}${B}daemon is not running${R}`,
  },
};

// Print the mascot to stderr (doesn't interfere with piped output).
// mood: 'happy' | 'wave' | 'confused' | 'sad' | 'excited' | 'sleeping'
export function mascot(mood = "happy", message = "") {
  const def = MOODS[mood] || MOODS.happy;
  const out = [
    "",
    ...def.lines,
    `      ${def.caption}`,
    message ? `   ${def.color}${message}${R}` : "",
    "",
  ].join("\n");
  process.stderr.write(out + "\n");
}

// One-liner for inline use: mascot.confused("apx: unknown command: foo")
mascot.confused  = (msg) => mascot("confused",  msg);
mascot.sad       = (msg) => mascot("sad",       msg);
mascot.happy     = (msg) => mascot("happy",     msg);
mascot.wave      = (msg) => mascot("wave",      msg);
mascot.excited   = (msg) => mascot("excited",   msg);
mascot.sleeping  = (msg) => mascot("sleeping",  msg);

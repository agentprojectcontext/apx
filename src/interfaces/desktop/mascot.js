// Mascot (blob) window renderer. Vanilla JS — the desktop app is not React.
// Draws the chosen blob avatar, lets the user drag it anywhere, hops on poke,
// and floats notification bubbles pushed from the daemon relay in main.js.
"use strict";

/* global BLOB_PRESETS, BLOB_VIEWBOX */

const blobEl = document.getElementById("blob");
const bodyEl = document.getElementById("blob-body");
const eyesG  = document.getElementById("blob-eyes-g");
const eyesSvg = document.getElementById("blob-eyes");
const bubbleEl = document.getElementById("bubble");
const bubbleText = document.getElementById("bubble-text");

// ── Paint the blob from its preset ─────────────────────────────────────────
function paintBlob(key) {
  const p = BLOB_PRESETS[key] || BLOB_PRESETS.noche || Object.values(BLOB_PRESETS)[0];
  if (!p) return;
  bodyEl.src = p.src;
  eyesSvg.setAttribute("viewBox", `0 0 ${BLOB_VIEWBOX} ${BLOB_VIEWBOX}`);
  eyesG.innerHTML = "";
  for (const e of p.eyes || []) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", e.x); r.setAttribute("y", e.y);
    r.setAttribute("width", e.w); r.setAttribute("height", e.h);
    r.setAttribute("rx", e.rx); r.setAttribute("fill", p.eyeColor);
    eyesG.appendChild(r);
  }
}

(async function init() {
  let cfg = {};
  try { cfg = (await window.mascot.getConfig()) || {}; } catch {}
  paintBlob(cfg.blob || "noche");
  if (cfg.name) blobEl.title = cfg.name;
})();

window.mascot.onAvatar((key) => paintBlob(key));

// ── Click-through management ────────────────────────────────────────────────
// The window ignores the mouse over transparent pixels (main forwards move
// events). We re-enable it only while the pointer is over the blob or bubble,
// so the rest of the desktop stays fully usable underneath.
let ignoring = true;
function setIgnore(next) {
  if (next === ignoring) return;
  ignoring = next;
  window.mascot.setIgnore(next);
}
function overInteractive(x, y) {
  for (const el of [blobEl, bubbleEl.hidden ? null : bubbleEl]) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}
window.addEventListener("mousemove", (e) => {
  if (dragging) return; // stay interactive throughout a drag
  setIgnore(!overInteractive(e.clientX, e.clientY));
});

// ── Drag anywhere + click-to-poke ───────────────────────────────────────────
let dragging = false;
let moved = false;
let grabDX = 0, grabDY = 0;

blobEl.addEventListener("pointerdown", async (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  let b;
  try { b = await window.mascot.getBounds(); } catch { return; }
  grabDX = e.screenX - b.x;
  grabDY = e.screenY - b.y;
  dragging = true;
  moved = false;
  blobEl.classList.add("dragging");
  try { blobEl.setPointerCapture(e.pointerId); } catch {}
});

blobEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const nx = Math.round(e.screenX - grabDX);
  const ny = Math.round(e.screenY - grabDY);
  window.mascot.setPos(nx, ny);
  if (!moved && (Math.abs(e.movementX) > 1 || Math.abs(e.movementY) > 1)) moved = true;
});

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  blobEl.classList.remove("dragging");
  try { blobEl.releasePointerCapture(e.pointerId); } catch {}
  if (moved) {
    window.mascot.savePos();
  } else {
    // A clean click (no drag) toggles the voice HUD, with a happy hop.
    hop();
    window.mascot.poke();
  }
}
blobEl.addEventListener("pointerup", endDrag);
blobEl.addEventListener("pointercancel", endDrag);

// Right-click → native context menu (open web chat, toggle voice, etc.).
blobEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.mascot.menu();
});

function hop() {
  blobEl.classList.remove("react");
  void blobEl.offsetWidth; // restart the animation
  blobEl.classList.add("react");
  setTimeout(() => blobEl.classList.remove("react"), 520);
}

// ── Notifications ───────────────────────────────────────────────────────────
const queue = [];
const notificationSound = new Audio("./assets/notification.mp3");
notificationSound.preload = "auto";
let showing = false;
let hideTimer = null;

function bubbleDuration(text) {
  return Math.min(9000, Math.max(3500, 1500 + text.length * 45));
}

function pump() {
  if (showing || queue.length === 0) return;
  const msg = queue.shift();
  showing = true;
  bubbleText.textContent = msg.text;
  bubbleEl.hidden = false;
  if (msg.sound !== false) {
    notificationSound.currentTime = 0;
    void notificationSound.play().catch(() => {});
  }
  void bubbleEl.offsetWidth;
  bubbleEl.classList.add("show");
  hop();
  clearTimeout(hideTimer);
  hideTimer = setTimeout(dismiss, bubbleDuration(msg.text));
}

function dismiss() {
  clearTimeout(hideTimer);
  bubbleEl.classList.remove("show");
  setTimeout(() => {
    bubbleEl.hidden = true;
    showing = false;
    pump();
  }, 200);
}

bubbleEl.addEventListener("click", dismiss);

window.mascot.onNotify((msg) => {
  const text = (msg && (msg.text || msg.message || "")).toString().trim();
  if (!text) return;
  queue.push({ text, sound: msg.sound !== false });
  pump();
});

/*! APX Kit v1 — overlays and menus: dropdown and context menus, tooltip, popover, sheet, accordion, combobox,
   APX.confirm and toggle buttons. Served right after apx-kit.js in the same script; it extends window.APX. */
(() => {
  const APX = window.APX;
  if (!APX?.kit || APX.overlays) return;
  APX.overlays = 1;

  /* Where a floating panel goes: on `side` of the anchor, flipped when the other side has more room, shifted to stay
     `pad` inside the view, and capped (maxHeight) when it fits on neither side. Pure, so it is tested without a DOM. */
  const OPP = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  function place(anchor, size, view, opts) {
    const o = opts || {};
    const gap = o.gap == null ? 6 : o.gap;
    const pad = o.pad == null ? 8 : o.pad;
    const align = o.align || "start";
    let side = OPP[o.side] ? o.side : "bottom";
    const room = (s) =>
      s === "bottom"
        ? view.height - anchor.bottom - gap - pad
        : s === "top"
          ? anchor.top - gap - pad
          : s === "right"
            ? view.width - anchor.right - gap - pad
            : anchor.left - gap - pad;
    const vertical = side === "top" || side === "bottom";
    if (room(side) < (vertical ? size.height : size.width) && room(OPP[side]) > room(side)) side = OPP[side];
    const w = size.width;
    let h = size.height;
    let maxHeight;
    if (vertical && h > room(side)) {
      h = Math.max(room(side), 0);
      maxHeight = h;
    }
    let left;
    let top;
    if (vertical) {
      top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - h;
      left =
        align === "end" ? anchor.right - w : align === "center" ? (anchor.left + anchor.right - w) / 2 : anchor.left;
    } else {
      left = side === "right" ? anchor.right + gap : anchor.left - gap - w;
      top =
        align === "end" ? anchor.bottom - h : align === "center" ? (anchor.top + anchor.bottom - h) / 2 : anchor.top;
    }
    return {
      left: Math.round(clamp(left, pad, view.width - w - pad)),
      top: Math.round(clamp(top, pad, view.height - h - pad)),
      side,
      maxHeight,
    };
  }
  APX.place = place;
  // Without a DOM (node tests) only the pure helpers load.
  if (typeof document === "undefined") return;

  const CSS = `
.ax-dropdown{position:relative;display:inline-flex}
.ax-dropdown__menu,.ax-pop,.ax-combo__list,.ax-tooltip{position:fixed;inset:auto;margin:0;z-index:60;box-sizing:border-box}
.ax-dropdown__menu:not([data-open]),.ax-pop:not([data-open]),.ax-combo__list:not([data-open]),.ax-tooltip:not([data-open]){display:none}
.ax-dropdown__menu,.ax-combo__list{min-width:180px;max-width:calc(100vw - 16px);padding:4px;border:1px solid var(--apx-border);border-radius:var(--apx-radius-md);background:var(--apx-surface-raised);color:var(--apx-fg);box-shadow:0 12px 32px rgb(0 0 0 / .2);overflow:auto;outline:none;flex-direction:column;font-size:13px}
.ax-dropdown__menu[data-open],.ax-combo__list[data-open]{display:flex;animation:ax-pop .12s cubic-bezier(.2,0,0,1)}
@keyframes ax-pop{from{opacity:0;transform:scale(.97)}}
.ax-dropdown__item{display:flex;align-items:center;gap:8px;min-height:32px;padding:0 10px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--apx-fg);text-align:left;text-decoration:none;cursor:pointer;width:100%;flex:none;position:relative;white-space:nowrap;outline:none;--s:15px}
.ax-dropdown__item:focus,.ax-dropdown__item:focus-visible{background:var(--apx-fill);outline:none}
.ax-dropdown__item ax-icon{color:var(--apx-fg-muted)}
.ax-dropdown__item:disabled,.ax-dropdown__item[aria-disabled=true]{opacity:.45;cursor:default}
.ax-dropdown__item kbd{margin-left:auto;padding-left:16px;font:11px var(--apx-font-mono);color:var(--apx-fg-subtle)}
.ax-dropdown__item--danger,.ax-dropdown__item--danger ax-icon{color:var(--apx-danger)}
.ax-dropdown__item--danger:focus{background:var(--apx-danger-soft);color:var(--apx-danger-soft-fg)}
.ax-dropdown__item[role=menuitemcheckbox],.ax-dropdown__item[role=menuitemradio]{padding-left:30px}
.ax-dropdown__item[role=menuitemcheckbox][aria-checked=true]::before{content:"";position:absolute;left:13px;top:50%;width:4px;height:8px;border:solid currentColor;border-width:0 1.8px 1.8px 0;transform:translateY(-60%) rotate(45deg)}
.ax-dropdown__item[role=menuitemradio][aria-checked=true]::before{content:"";position:absolute;left:12px;top:50%;width:6px;height:6px;border-radius:50%;background:currentColor;transform:translateY(-50%)}
.ax-dropdown__label{padding:6px 10px 4px;font-size:11.5px;font-weight:550;color:var(--apx-fg-subtle)}
.ax-dropdown__menu hr{flex:none;border:0;height:1px;background:var(--apx-border);margin:4px -4px}
.ax-btn:not(.ax-btn--primary)[aria-expanded=true],.ax-iconbtn[aria-expanded=true]{background:var(--apx-fill-strong);color:var(--apx-fg)}
.ax-tooltip{max-width:260px;padding:4px 8px;border:0;border-radius:6px;background:var(--apx-fg);color:var(--apx-bg);font:500 11.5px/1.4 var(--apx-font-sans);pointer-events:none;overflow:visible;z-index:70;text-wrap:pretty}
.ax-tooltip[data-open]{display:block;animation:ax-fade .1s}
@keyframes ax-fade{from{opacity:0}}
.ax-pop{width:var(--w,300px);max-width:calc(100vw - 16px);padding:14px 16px;gap:12px;border:1px solid var(--apx-border);border-radius:var(--apx-radius-md);background:var(--apx-surface-raised);color:var(--apx-fg);box-shadow:0 12px 32px rgb(0 0 0 / .2);font-size:13px;overflow:auto;outline:none;flex-direction:column}
.ax-pop[data-open]{display:flex;animation:ax-pop .14s cubic-bezier(.2,0,0,1)}
.ax-pop__head{display:flex;flex-direction:column;gap:2px;font-weight:600;font-size:14px}
.ax-pop__head small,.ax-pop__head p{margin:0;font-weight:400;font-size:12px;color:var(--apx-fg-muted)}
.ax-pop__body{display:flex;flex-direction:column;gap:10px}
.ax-pop__foot{display:flex;justify-content:flex-end;gap:8px;margin:2px -16px -14px;padding:10px 16px;border-top:1px solid var(--apx-border)}
.ax-sheet{position:fixed;inset:0 0 0 auto;margin:0;padding:0;border:0;border-left:1px solid var(--apx-border);width:min(var(--w,400px),calc(100vw - 32px));max-width:none;height:100%;max-height:none;background:var(--apx-surface-raised);color:var(--apx-fg);box-shadow:0 0 48px rgb(0 0 0 / .3)}
.ax-sheet[open]{display:flex;flex-direction:column;animation:ax-sheet-r .22s cubic-bezier(.2,0,0,1)}
.ax-sheet::backdrop{background:rgb(0 0 0 / .45)}
.ax-sheet[data-side=left]{inset:0 auto 0 0;border-left:0;border-right:1px solid var(--apx-border)}
.ax-sheet[data-side=left][open]{animation-name:ax-sheet-l}
.ax-sheet[data-side=bottom]{inset:auto 0 0;width:100%;height:auto;max-height:85vh;border-left:0;border-top:1px solid var(--apx-border);border-radius:var(--apx-radius-lg) var(--apx-radius-lg) 0 0}
.ax-sheet[data-side=bottom][open]{animation-name:ax-sheet-b}
@keyframes ax-sheet-r{from{transform:translateX(100%)}}@keyframes ax-sheet-l{from{transform:translateX(-100%)}}@keyframes ax-sheet-b{from{transform:translateY(100%)}}
.ax-sheet__head{flex:none;display:flex;align-items:flex-start;gap:12px;padding:18px 20px 10px}
.ax-sheet__head>:first-child{flex:1;min-width:0}
.ax-sheet__body{flex:1;min-height:0;overflow:auto;padding:6px 20px 20px;display:flex;flex-direction:column;gap:14px}
.ax-sheet__foot{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--apx-border)}
.ax-accordion{display:flex;flex-direction:column}
.ax-accordion>details{border-bottom:1px solid var(--apx-border)}
.ax-accordion>details>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 2px;font-size:13.5px;font-weight:550}
.ax-accordion>details>summary::-webkit-details-marker{display:none}
.ax-accordion>details>summary:hover{text-decoration:underline;text-underline-offset:3px}
.ax-accordion>details>summary::after{content:"";flex:none;width:7px;height:7px;border-right:1.5px solid var(--apx-fg-subtle);border-bottom:1.5px solid var(--apx-fg-subtle);transform:translateY(-2px) rotate(45deg);transition:transform .2s cubic-bezier(.2,0,0,1)}
.ax-accordion>details[open]>summary::after{transform:translateY(2px) rotate(225deg)}
.ax-accordion>details>:not(summary){padding:0 2px 14px;color:var(--apx-fg-muted);font-size:13px;animation:ax-acc .2s cubic-bezier(.2,0,0,1)}
@keyframes ax-acc{from{opacity:0;transform:translateY(-4px)}}
select[data-ax-combobox][data-ax-enhanced]{display:none}
.ax-combo{position:relative;display:inline-flex;min-width:180px;vertical-align:middle}
.ax-combo__input{width:100%;padding-right:30px;background-image:linear-gradient(45deg,transparent 50%,var(--apx-fg-subtle) 50%),linear-gradient(135deg,var(--apx-fg-subtle) 50%,transparent 50%);background-position:calc(100% - 16px) 14px,calc(100% - 12px) 14px;background-size:4px 4px;background-repeat:no-repeat}
.ax-combo__opt{display:flex;align-items:center;flex:none;min-height:30px;padding:0 10px 0 28px;border-radius:7px;cursor:pointer;position:relative}
.ax-combo__opt[data-active]{background:var(--apx-fill)}
.ax-combo__opt[aria-selected=true]::before{content:"";position:absolute;left:11px;top:50%;width:4px;height:8px;border:solid currentColor;border-width:0 1.8px 1.8px 0;transform:translateY(-60%) rotate(45deg)}
.ax-combo__opt[aria-disabled=true]{opacity:.45;cursor:default}
.ax-combo__group{flex:none;padding:6px 10px 2px;font-size:11.5px;font-weight:550;color:var(--apx-fg-subtle)}
.ax-combo__empty{padding:10px;text-align:center;color:var(--apx-fg-subtle);font-size:12.5px}
.ax-confirm__text{margin:0;color:var(--apx-fg-muted);font-size:13.5px;text-wrap:pretty}
.ax-btn--danger{background:var(--apx-danger);color:var(--apx-bg)}.ax-btn--danger:hover{background:color-mix(in srgb,var(--apx-danger) 86%,var(--apx-fg))}
.ax-toggle{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:var(--apx-radius-pill);background:transparent;color:var(--apx-fg-muted);font:inherit;font-size:12.5px;font-weight:550;cursor:pointer;white-space:nowrap;transition:background .14s,color .14s;--s:15px}
.ax-toggle:hover{background:var(--apx-fill);color:var(--apx-fg)}.ax-toggle:disabled{opacity:.5;cursor:default}
.ax-toggle[aria-pressed=true]{background:var(--apx-surface-raised);color:var(--apx-fg);box-shadow:0 0 0 1px var(--apx-border),0 1px 2px rgb(0 0 0 / .16)}
.ax-toggle--sm{height:26px;padding:0 9px;font-size:12px}
:root[data-ax-style=aurora] .ax-dropdown__item:focus,:root[data-ax-style=aurora] .ax-combo__opt[data-active]{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg)}
:root[data-ax-style=aurora] .ax-dropdown__item:focus ax-icon{color:inherit}
:root[data-ax-style=aurora] .ax-dropdown__item--danger:focus{background:var(--apx-danger-soft);color:var(--apx-danger-soft-fg)}
:root[data-ax-style=aurora] .ax-toggle[aria-pressed=true],:root[data-ax-style=aurora] .ax-btn:not(.ax-btn--primary)[aria-expanded=true],:root[data-ax-style=aurora] .ax-iconbtn[aria-expanded=true]{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--apx-brand) 45%,transparent)}
:root[data-ax-style=aurora] .ax-accordion>details[open]>summary::after{border-color:var(--apx-brand)}
:root[data-ax-style=aurora] .ax-combo__input:focus{border-color:color-mix(in srgb,var(--apx-brand) 45%,transparent)}
:root[data-ax-style=aurora] .ax-btn--danger{background:var(--apx-danger-soft);color:var(--apx-danger-soft-fg);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--apx-danger) 45%,transparent)}
`;
  const style = document.createElement("style");
  style.id = "apx-kit-overlays";
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);

  const ES = /^es\b/i.test(document.documentElement.lang || navigator.language || "en");
  const T = ES
    ? { confirm: "Confirmar", cancel: "Cancelar", none: "Sin resultados" }
    : { confirm: "Confirm", cancel: "Cancel", none: "No results" };
  const esc = APX.esc || ((s) => String(s));
  let uid = 0;
  const idOf = (el, p) => {
    if (!el.id) el.id = `ax-${p}-${++uid}`;
    return el.id;
  };
  const closest = (e, sel) => (e.target?.closest ? e.target.closest(sel) : null);
  const query = (sel) => {
    try {
      return sel ? document.querySelector(sel) : null;
    } catch {
      return null;
    }
  };
  // The top layer (popover API) keeps panels above modal dialogs and out of overflow:hidden parents.
  const canPop = typeof HTMLElement.prototype.showPopover === "function";

  /* Open floating layers, innermost last: Esc closes the last, a press or focus outside closes the rest. */
  let layers = [];
  const layerOf = (el) => layers.find((l) => l.el === el);
  function lift(el) {
    el.setAttribute("data-open", "");
    if (!canPop) return;
    if (!el.hasAttribute("popover")) el.setAttribute("popover", "manual");
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      /* detached: stays fixed in place */
    }
  }
  function lower(el) {
    el.removeAttribute("data-open");
    if (!canPop || !el.hasAttribute("popover")) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
    } catch {
      /* already hidden */
    }
  }
  const rectOf = (a) =>
    a.getBoundingClientRect ? a.getBoundingClientRect() : { left: a.x, right: a.x, top: a.y, bottom: a.y, width: 0 };
  function viewSize() {
    const d = document.documentElement;
    return { width: d.clientWidth || innerWidth, height: d.clientHeight || innerHeight };
  }
  function put(layer) {
    const el = layer.el;
    const a = rectOf(layer.anchor);
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.maxHeight = "";
    if (layer.matchWidth) el.style.minWidth = `${Math.round(a.width)}px`;
    const r = el.getBoundingClientRect();
    const p = place(a, { width: r.width, height: r.height }, viewSize(), layer.opts);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    if (p.maxHeight != null) el.style.maxHeight = `${p.maxHeight}px`;
    el.setAttribute("data-placed", p.side);
  }
  function open(el, anchor, opts, extra) {
    const layer = Object.assign({ el, anchor, opts }, extra);
    layers = layers.filter((l) => l.el !== el).concat(layer);
    lift(el);
    put(layer);
    if (layer.trigger) layer.trigger.setAttribute("aria-expanded", "true");
    return layer;
  }
  function close(el, refocus) {
    const layer = layerOf(el);
    if (!layer) return;
    for (const l of layers.slice(layers.indexOf(layer) + 1)) {
      if (el.contains(l.el) || (l.trigger && el.contains(l.trigger))) close(l.el);
    }
    layers = layers.filter((l) => l !== layer);
    lower(el);
    if (layer.trigger) layer.trigger.setAttribute("aria-expanded", "false");
    if (layer.onClose) layer.onClose();
    if (refocus && layer.trigger?.isConnected) layer.trigger.focus({ preventScroll: true });
  }
  const inside = (l, t) => l.el.contains(t) || l.trigger?.contains(t);
  document.addEventListener(
    "pointerdown",
    (e) => {
      for (const l of layers.slice().reverse()) if (!inside(l, e.target)) close(l.el);
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    for (const l of layers.slice().reverse()) if (!inside(l, e.target)) close(l.el);
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      hideTip();
      const top = layers[layers.length - 1];
      if (!top) return;
      e.preventDefault();
      e.stopPropagation();
      close(top.el, true);
    },
    true,
  );
  function reflow(e) {
    if (e && e.type === "scroll" && layers.some((l) => l.el.contains(e.target))) return;
    for (const l of layers) put(l);
    if (tipFor) put({ el: tip, anchor: tipFor, opts: tipOpts(tipFor) });
  }
  addEventListener("resize", reflow);
  document.addEventListener("scroll", reflow, true);

  /* Dropdown and context menus: .ax-dropdown__menu[role=menu] with button.ax-dropdown__item. */
  const ITEM = ".ax-dropdown__item";
  const OPEN_MENU = ".ax-dropdown__menu[data-open]";
  const enabled = (i) => !i.disabled && i.getAttribute("aria-disabled") !== "true" && !i.hidden;
  const itemsOf = (menu) => Array.from(menu.querySelectorAll(ITEM)).filter(enabled);
  function prepMenu(menu) {
    if (!menu.getAttribute("role")) menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    for (const i of menu.querySelectorAll(ITEM)) {
      if (!i.getAttribute("role")) i.setAttribute("role", "menuitem");
      i.tabIndex = -1;
      if (i.disabled) i.setAttribute("aria-disabled", "true");
      if (/checkbox|radio/.test(i.getAttribute("role")) && !i.hasAttribute("aria-checked"))
        i.setAttribute("aria-checked", "false");
    }
    for (const h of menu.querySelectorAll("hr")) h.setAttribute("role", "separator");
  }
  function menuOf(trigger) {
    const m = query(trigger.getAttribute("data-ax-dropdown"));
    if (m) return m;
    const root = trigger.closest(".ax-dropdown");
    return root?.querySelector(".ax-dropdown__menu");
  }
  function openMenu(menu, anchor, o) {
    const m = typeof menu === "string" ? query(menu) : menu;
    if (!m) return;
    const opt = o || {};
    prepMenu(m);
    const root = m.closest(".ax-dropdown");
    const attr = (n) => m.getAttribute(n) || root?.getAttribute(n) || opt.trigger?.getAttribute(n);
    const opts = { side: opt.side || attr("data-side") || "bottom", align: opt.align || attr("data-align") || "start" };
    if (!anchor.getBoundingClientRect) opts.gap = 2;
    if (opt.trigger) {
      opt.trigger.setAttribute("aria-haspopup", "menu");
      opt.trigger.setAttribute("aria-controls", idOf(m, "menu"));
    }
    open(m, anchor, opts, { trigger: opt.trigger, target: opt.target });
    const list = itemsOf(m);
    const first = opt.focus === "first" ? list[0] : opt.focus === "last" ? list[list.length - 1] : null;
    (first || m).focus({ preventScroll: true });
  }
  const labelOf = (item) =>
    Array.from(item.childNodes)
      .filter((n) => n.nodeName !== "KBD")
      .map((n) => n.textContent)
      .join("")
      .trim();
  function choose(item) {
    const menu = item.closest(".ax-dropdown__menu");
    if (!menu || !enabled(item)) return;
    const role = item.getAttribute("role");
    const group = item.getAttribute("data-group");
    let checked;
    if (role === "menuitemcheckbox") {
      checked = item.getAttribute("aria-checked") !== "true";
      item.setAttribute("aria-checked", String(checked));
    } else if (role === "menuitemradio") {
      for (const r of menu.querySelectorAll("[role=menuitemradio]"))
        if (r.getAttribute("data-group") === group) r.setAttribute("aria-checked", String(r === item));
      checked = true;
    }
    const layer = layerOf(menu);
    const value = item.value || item.getAttribute("data-value") || labelOf(item);
    const detail = { value, checked, group: group || undefined, target: layer?.target };
    item.dispatchEvent(new CustomEvent("ax:select", { bubbles: true, detail }));
    if (role !== "menuitemcheckbox") close(menu, true);
  }
  function menuKey(e, menu) {
    const list = itemsOf(menu);
    const i = list.indexOf(e.target);
    let next;
    if (e.key === "ArrowDown") next = list[(i + 1) % list.length];
    else if (e.key === "ArrowUp") next = list[i <= 0 ? list.length - 1 : i - 1];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Tab") {
      e.preventDefault();
      close(menu, true);
      return;
    } else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const order = list.slice(i + 1).concat(list.slice(0, i + 1));
      next = order.find((it) => labelOf(it).toLowerCase().startsWith(k));
    }
    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: true });
    }
  }
  function openContext(el, x, y) {
    const menu = query(el.getAttribute("data-ax-context"));
    if (!menu) return false;
    openMenu(menu, { x, y }, { target: el, side: "bottom", align: "start" });
    return true;
  }
  document.addEventListener("contextmenu", (e) => {
    if (closest(e, OPEN_MENU)) return e.preventDefault();
    const el = closest(e, "[data-ax-context]");
    if (!el) return;
    let x = e.clientX;
    let y = e.clientY;
    if (!x && !y) {
      const r = el.getBoundingClientRect();
      x = r.left + 8;
      y = r.top + 8;
    }
    if (openContext(el, x, y)) e.preventDefault();
  });
  // Touch: a long press opens the context menu (iOS fires no contextmenu event).
  let press = null;
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  document.addEventListener("pointerdown", (e) => {
    const el = e.pointerType === "touch" && closest(e, "[data-ax-context]");
    if (!el) return;
    const x = e.clientX;
    const y = e.clientY;
    const timer = setTimeout(() => {
      press = null;
      openContext(el, x, y);
    }, 500);
    press = { x, y, timer };
  });
  document.addEventListener("pointermove", (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
    const it = closest(e, ITEM);
    const menu = closest(e, OPEN_MENU);
    if (!menu || e.pointerType === "touch") return;
    if (it && enabled(it)) {
      if (document.activeElement !== it) it.focus({ preventScroll: true });
    } else if (document.activeElement !== menu && menu.contains(document.activeElement))
      menu.focus({ preventScroll: true });
  });
  document.addEventListener("pointerup", cancelPress);
  document.addEventListener("pointercancel", cancelPress);

  /* Tooltip: one floating element for every [data-ax-tip]; ~400 ms on hover (none when moving between tips), at once
     on keyboard focus. */
  const tip = document.createElement("div");
  tip.className = "ax-tooltip";
  tip.id = "ax-tooltip";
  tip.setAttribute("role", "tooltip");
  let tipFor = null;
  let tipNext = null;
  let tipTimer = 0;
  let tipHiddenAt = 0;
  let pressAt = 0;
  // A rail sits on the left edge: its tips go right, where there is room.
  const tipSide = (el) => el.getAttribute("data-ax-tip-side") || (el.closest(".ax-rail") ? "right" : "top");
  const tipOpts = (el) => ({ side: tipSide(el), align: "center", gap: 6 });
  function nameFromTip(el) {
    if (!el.hasAttribute("aria-label") && !el.textContent.trim())
      el.setAttribute("aria-label", el.getAttribute("data-ax-tip"));
  }
  function showTip(el) {
    clearTimeout(tipTimer);
    tipNext = null;
    const text = el.getAttribute("data-ax-tip");
    if (!text || !el.isConnected) return;
    if (tipFor && tipFor !== el) hideTip();
    if (!tip.isConnected) document.body.appendChild(tip);
    tipFor = el;
    tip.textContent = text;
    nameFromTip(el);
    if (el.getAttribute("aria-label") !== text) el.setAttribute("aria-describedby", tip.id);
    lift(tip);
    put({ el: tip, anchor: el, opts: tipOpts(el) });
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipNext = null;
    if (!tipFor) return;
    if (tipFor.getAttribute("aria-describedby") === tip.id) tipFor.removeAttribute("aria-describedby");
    tipFor = null;
    tipHiddenAt = Date.now();
    lower(tip);
  }
  document.addEventListener("mouseover", (e) => {
    const el = closest(e, "[data-ax-tip]");
    if (el === tipFor || el === tipNext) return;
    if (!el) return hideTip();
    const warm = tipFor || Date.now() - tipHiddenAt < 300;
    hideTip();
    if (warm) return showTip(el);
    tipNext = el;
    tipTimer = setTimeout(() => showTip(el), 400);
  });
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) hideTip();
  });
  document.addEventListener(
    "pointerdown",
    () => {
      pressAt = Date.now();
      hideTip();
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    const el = closest(e, "[data-ax-tip]");
    if (el && Date.now() - pressAt > 250) showTip(el);
  });
  document.addEventListener("focusout", (e) => {
    if (tipFor?.contains(e.target)) hideTip();
  });

  /* Popover: [data-ax-popover="#id"] toggles div.ax-pop; focus moves in, Esc brings it back. */
  const FOCUSABLE =
    'button:not([disabled]),[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function openPop(pop, trig) {
    if (!pop.getAttribute("role")) pop.setAttribute("role", "dialog");
    pop.tabIndex = -1;
    const head = pop.querySelector(".ax-pop__head");
    if (head && !pop.hasAttribute("aria-label")) pop.setAttribute("aria-labelledby", idOf(head, "pop-title"));
    trig.setAttribute("aria-haspopup", "dialog");
    trig.setAttribute("aria-controls", idOf(pop, "pop"));
    const attr = (n) => pop.getAttribute(n) || trig.getAttribute(n);
    open(
      pop,
      trig,
      { side: attr("data-side") || "bottom", align: attr("data-align") || "center", gap: 8 },
      { trigger: trig },
    );
    const first =
      pop.querySelector("[autofocus]") ||
      Array.from(pop.querySelectorAll(FOCUSABLE)).find((f) => f.getClientRects().length > 0);
    (first || pop).focus({ preventScroll: true });
  }

  document.addEventListener("click", (e) => {
    const dd = closest(e, "[data-ax-dropdown]");
    if (dd && !dd.disabled) {
      const menu = menuOf(dd);
      if (!menu) return;
      if (layerOf(menu)) close(menu, false);
      else openMenu(menu, dd, { trigger: dd, focus: e.detail === 0 ? "first" : null });
      return;
    }
    const item = closest(e, ITEM);
    if (item) return choose(item);
    const pt = closest(e, "[data-ax-popover]");
    const pop = pt && query(pt.getAttribute("data-ax-popover"));
    if (pop) {
      if (layerOf(pop)) close(pop, false);
      else openPop(pop, pt);
      return;
    }
    const x = closest(e, ".ax-pop [data-ax-close]");
    if (x) return close(x.closest(".ax-pop"), true);
    const tg = closest(e, "button.ax-toggle");
    if (tg && !tg.disabled) {
      const on = tg.getAttribute("aria-pressed") !== "true";
      tg.setAttribute("aria-pressed", String(on));
      const k = tg.getAttribute("data-ax-persist");
      if (k && APX.state) APX.state.set(k, on);
      tg.dispatchEvent(new CustomEvent("ax:toggle", { bubbles: true, detail: { pressed: on } }));
      return;
    }
    // A click on a sheet's backdrop lands on the dialog itself, outside its box.
    const d = e.target;
    if (d instanceof HTMLDialogElement && d.open && d.classList.contains("ax-sheet")) {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.matches?.("[data-ax-dropdown]") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const menu = menuOf(t);
      if (!menu) return;
      e.preventDefault();
      openMenu(menu, t, { trigger: t, focus: e.key === "ArrowDown" ? "first" : "last" });
      return;
    }
    const menu = closest(e, OPEN_MENU);
    if (menu) menuKey(e, menu);
  });

  /* Accordion: .ax-accordion[data-single] keeps one details open. */
  document.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (d.tagName !== "DETAILS" || !d.open) return;
      const acc = d.parentElement;
      if (!acc?.matches(".ax-accordion[data-single]")) return;
      for (const o of acc.children) if (o !== d && o.tagName === "DETAILS" && o.open) o.open = false;
    },
    true,
  );

  /* Combobox: select[data-ax-combobox] gets a text input that filters its options; the select keeps the value and
     fires input/change, so data-ax-persist and data-ax-key filters keep working. */
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function combobox(sel) {
    if (sel._axCombo) return sel._axCombo;
    const wrap = document.createElement("span");
    wrap.className = "ax-combo";
    if (sel.getAttribute("style")) wrap.setAttribute("style", sel.getAttribute("style"));
    const input = document.createElement("input");
    input.className = "ax-input ax-combo__input";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = sel.getAttribute("data-placeholder") || "";
    input.disabled = sel.disabled;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    const list = document.createElement("div");
    list.className = "ax-combo__list";
    list.setAttribute("role", "listbox");
    input.setAttribute("aria-controls", idOf(list, "listbox"));
    wrap.append(input, list);
    sel.before(wrap);
    sel.setAttribute("data-ax-enhanced", "");
    const lab = sel.labels?.[0];
    if (sel.getAttribute("aria-label")) input.setAttribute("aria-label", sel.getAttribute("aria-label"));
    else if (lab && !lab.contains(input)) input.setAttribute("aria-labelledby", idOf(lab, "label"));

    let active = null;
    const isOpen = () => list.hasAttribute("data-open");
    const label = () => {
      const o = sel.options[sel.selectedIndex];
      return o ? o.textContent.trim() : "";
    };
    const sync = () => {
      if (!isOpen()) input.value = label();
    };
    const choices = () => Array.from(list.querySelectorAll("[role=option]:not([aria-disabled=true])"));
    function setActive(el, scroll) {
      if (active) active.removeAttribute("data-active");
      active = el;
      if (!el) return input.removeAttribute("aria-activedescendant");
      el.setAttribute("data-active", "");
      input.setAttribute("aria-activedescendant", el.id);
      if (scroll !== false) el.scrollIntoView({ block: "nearest" });
    }
    function render(q, preferSelected) {
      list.textContent = "";
      const nq = norm(q);
      for (const node of sel.children) {
        const group = node.tagName === "OPTGROUP";
        const opts = (group ? Array.from(node.children) : [node]).filter(
          (o) => o.tagName === "OPTION" && !o.hidden && norm(o.textContent).includes(nq),
        );
        if (!opts.length) continue;
        if (group) {
          const g = document.createElement("div");
          g.className = "ax-combo__group";
          g.setAttribute("role", "presentation");
          g.textContent = node.label;
          list.append(g);
        }
        for (const o of opts) {
          const el = document.createElement("div");
          el.className = "ax-combo__opt";
          el.id = `${list.id}-${o.index}`;
          el.setAttribute("role", "option");
          el.setAttribute("aria-selected", String(o.selected));
          if (o.disabled) el.setAttribute("aria-disabled", "true");
          el.textContent = o.textContent.trim();
          el._opt = o;
          list.append(el);
        }
      }
      if (!list.firstChild) {
        const none = document.createElement("div");
        none.className = "ax-combo__empty";
        none.textContent = T.none;
        list.append(none);
      }
      const all = choices();
      setActive((preferSelected && all.find((o) => o.getAttribute("aria-selected") === "true")) || all[0] || null);
    }
    function show() {
      if (isOpen()) return;
      render("", true);
      const onClose = () => {
        setActive(null);
        input.value = label();
      };
      open(list, input, { side: "bottom", align: "start", gap: 4 }, { trigger: input, matchWidth: true, onClose });
      if (active) active.scrollIntoView({ block: "nearest" });
    }
    function pick(el) {
      if (!el?._opt || el.getAttribute("aria-disabled") === "true") return;
      const changed = !el._opt.selected;
      el._opt.selected = true;
      close(list);
      input.value = label();
      if (!changed) return;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    input.addEventListener("input", () => {
      if (!isOpen()) show();
      render(input.value, false);
      const l = layerOf(list);
      if (l) put(l);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen()) return show();
        const all = choices();
        const i = all.indexOf(active);
        setActive(e.key === "ArrowDown" ? all[Math.min(i + 1, all.length - 1)] : all[Math.max(i - 1, 0)]);
      } else if (e.key === "Enter" && isOpen()) {
        e.preventDefault();
        pick(active);
      } else if (e.key === "Tab" && isOpen()) close(list);
    });
    input.addEventListener("click", show);
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => close(list));
    list.addEventListener("pointerdown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => pick(closest(e, "[role=option]")));
    list.addEventListener("pointermove", (e) => {
      const o = closest(e, "[role=option]:not([aria-disabled=true])");
      if (o && o !== active) setActive(o, false);
    });
    // Code (or a restored data-ax-persist value) that sets the select shows in the input too.
    for (const k of ["value", "selectedIndex"]) {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, k);
      Object.defineProperty(sel, k, {
        configurable: true,
        get() {
          return d.get.call(this);
        },
        set(v) {
          d.set.call(this, v);
          sync();
        },
      });
    }
    sel.addEventListener("change", sync);
    sync();
    sel._axCombo = { input, open: show, close: () => close(list) };
    return sel._axCombo;
  }

  /* APX.confirm(text, {title, confirm, cancel, danger}) → Promise<boolean>; Esc or Cancel resolve false. */
  function confirm(text, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      const id = idOf(d, "confirm");
      d.className = "ax-dialog ax-confirm";
      d.setAttribute("role", "alertdialog");
      d.setAttribute("aria-labelledby", o.title ? `${id}-t` : `${id}-d`);
      d.setAttribute("aria-describedby", `${id}-d`);
      d.innerHTML = `<div>${o.title ? `<h2 class="ax-h2" id="${id}-t">${esc(o.title)}</h2>` : ""}<p class="ax-confirm__text" id="${id}-d">${esc(text)}</p><div class="ax-dialog__actions"><button type="button" class="ax-btn ax-btn--ghost" data-v="0">${esc(o.cancel || T.cancel)}</button><button type="button" class="ax-btn ${o.danger ? "ax-btn--danger" : "ax-btn--primary"}" data-v="1">${esc(o.confirm || T.confirm)}</button></div></div>`;
      const prev = document.activeElement;
      d.addEventListener("click", (e) => {
        const b = closest(e, "[data-v]");
        if (b) d.close(b.getAttribute("data-v"));
      });
      d.addEventListener("close", () => {
        resolve(d.returnValue === "1");
        d.remove();
        if (prev?.isConnected && prev.focus) prev.focus({ preventScroll: true });
      });
      document.body.appendChild(d);
      // showModal focuses Cancel, the first button: an autofocus attribute is refused inside a cross-origin frame.
      d.showModal();
    });
  }

  function restoreToggles() {
    for (const b of document.querySelectorAll("button.ax-toggle")) {
      const k = b.getAttribute("data-ax-persist");
      const v = k && APX.state ? APX.state.get(k) : undefined;
      if (v !== undefined) b.setAttribute("aria-pressed", String(!!v));
      else if (!b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", "false");
    }
  }
  function prep() {
    for (const t of document.querySelectorAll("[data-ax-dropdown]")) {
      t.setAttribute("aria-haspopup", "menu");
      if (!t.hasAttribute("aria-expanded")) t.setAttribute("aria-expanded", "false");
    }
    for (const t of document.querySelectorAll("[data-ax-popover]")) {
      t.setAttribute("aria-haspopup", "dialog");
      if (!t.hasAttribute("aria-expanded")) t.setAttribute("aria-expanded", "false");
    }
    for (const m of document.querySelectorAll(".ax-dropdown__menu")) prepMenu(m);
    for (const t of document.querySelectorAll("[data-ax-tip]")) nameFromTip(t);
    for (const s of document.querySelectorAll("select[data-ax-combobox]")) combobox(s);
    for (const d of document.querySelectorAll("dialog.ax-sheet:not([aria-label]):not([aria-labelledby])")) {
      const h = d.querySelector(".ax-sheet__head h1,.ax-sheet__head h2,.ax-sheet__head h3");
      if (h) d.setAttribute("aria-labelledby", idOf(h, "sheet-title"));
    }
    restoreToggles();
  }
  if (APX.state?.on) APX.state.on((_s, source) => source === "remote" && restoreToggles());
  function boot() {
    prep();
    // Pages that draw their markup later get the same wiring; prep only sets attributes, so it settles.
    new MutationObserver(prep).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  Object.assign(APX, {
    confirm,
    combobox,
    openMenu: (menu, at, o) => openMenu(menu, at, Object.assign({ focus: "first" }, o)),
    closeOverlays: () => {
      for (const l of layers.slice().reverse()) close(l.el);
      hideTip();
    },
  });
})();

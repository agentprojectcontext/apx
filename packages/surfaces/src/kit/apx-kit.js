/*! APX Kit v1 — widgets and apps written by agents. One <script>, no build.
   Usage: <script src="/_apx/kit@1.js"></script>  (APX inlines it; works offline)
   ax-* classes, <ax-*> elements, declarative filters, views, persistent state and the bridge to APX. */
(function () {
  if (window.APX && window.APX.kit) return;
  var CSS = `
:root{color-scheme:light;
--apx-font-sans:system-ui,-apple-system,"Segoe UI","Helvetica Neue",sans-serif;--apx-font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
--apx-bg:#faf9f7;--apx-surface:#fff;--apx-surface-raised:#fff;--apx-fill:#efeeea;--apx-fill-hover:#e8e7e3;--apx-fill-strong:#e2e1dc;
--apx-fg:#161616;--apx-fg-muted:#5f5e5a;--apx-fg-subtle:#8e8d88;--apx-border:#e7e5e0;--apx-border-strong:#d6d4ce;
--apx-accent:#141414;--apx-accent-hover:#2b2b2b;--apx-accent-fg:#fff;
--apx-brand:#1a9460;--apx-brand-soft:#e2f3e9;--apx-brand-soft-fg:#13704a;
--apx-violet:#7a4de6;--apx-violet-soft:#eee8fc;--apx-violet-soft-fg:#5b33c4;
--apx-info:#2f6fe0;--apx-info-soft:#e6eefc;--apx-info-soft-fg:#2358b8;
--apx-warning:#c2650f;--apx-warning-soft:#fbecda;--apx-warning-soft-fg:#9a4d08;
--apx-danger:#d23c3c;--apx-danger-soft:#fce8e8;--apx-danger-soft-fg:#b02a2a;
--apx-ring:rgb(26 148 96 / .35);--apx-shadow-sm:0 1px 2px rgb(0 0 0 / .05);
--apx-radius-sm:8px;--apx-radius-md:12px;--apx-radius-lg:18px;--apx-radius-pill:999px}
:root[data-ax-mode=dark]{color-scheme:dark;
--apx-bg:#161615;--apx-surface:#1e1e1d;--apx-surface-raised:#252524;--apx-fill:#272726;--apx-fill-hover:#2e2e2c;--apx-fill-strong:#353533;
--apx-fg:#ededeb;--apx-fg-muted:#a6a59f;--apx-fg-subtle:#767570;--apx-border:#2c2c2a;--apx-border-strong:#3b3b38;
--apx-accent:#f1f0ec;--apx-accent-hover:#fff;--apx-accent-fg:#141414;
--apx-brand:#3ec98b;--apx-brand-soft:rgb(62 201 139 / .14);--apx-brand-soft-fg:#6fdcaa;
--apx-violet:#a47ff5;--apx-violet-soft:rgb(164 127 245 / .16);--apx-violet-soft-fg:#c2a8fa;
--apx-info:#6a9cf5;--apx-info-soft:rgb(106 156 245 / .15);--apx-info-soft-fg:#9dbdf8;
--apx-warning:#eb9a4b;--apx-warning-soft:rgb(235 154 75 / .15);--apx-warning-soft-fg:#f2b779;
--apx-danger:#f06464;--apx-danger-soft:rgb(240 100 100 / .15);--apx-danger-soft-fg:#f59393;
--apx-ring:rgb(62 201 139 / .4);--apx-shadow-sm:none}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--apx-bg);color:var(--apx-fg);font:14px/1.5 var(--apx-font-sans);-webkit-font-smoothing:antialiased}
:root[data-ax-embed]{background:transparent}:root[data-ax-embed] body{background:transparent}
a{color:var(--apx-fg);text-underline-offset:2px}a:hover{color:var(--apx-brand)}
:focus-visible{outline:2px solid var(--apx-ring);outline-offset:2px}
.ax-page{max-width:1080px;margin:0 auto;padding:28px 32px 48px;display:flex;flex-direction:column;gap:20px}
:root[data-ax-embed] .ax-page{padding:20px 24px;gap:16px}
.ax-stack{display:flex;flex-direction:column;gap:var(--gap,12px)}
.ax-row{display:flex;align-items:center;flex-wrap:wrap;gap:var(--gap,8px)}
.ax-spread{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.ax-grid{display:grid;gap:var(--gap,12px);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--min,200px)),1fr))}
.ax-muted{color:var(--apx-fg-muted)}.ax-subtle{color:var(--apx-fg-subtle)}.ax-mono{font-family:var(--apx-font-mono);font-size:12px}
.ax-num{font-variant-numeric:tabular-nums}.ax-sm{font-size:12px}.ax-grow{flex:1;min-width:0}
.ax-eyebrow{font-size:12px;color:var(--apx-fg-subtle);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ax-title{margin:0;font-size:24px;line-height:1.2;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
.ax-h2{margin:0;font-size:15px;font-weight:600}
.ax-lede{margin:0;color:var(--apx-fg-muted);max-width:70ch;text-wrap:pretty}
.ax-note{margin:0;font-size:12px;color:var(--apx-fg-subtle);max-width:80ch;text-wrap:pretty}
.ax-code{font-family:var(--apx-font-mono);font-size:11.5px;padding:1px 6px;border-radius:6px;background:var(--apx-fill);color:var(--apx-fg-muted)}
.ax-kbd{font-family:var(--apx-font-mono);font-size:11px;padding:0 5px;border-radius:5px;border:1px solid var(--apx-border-strong);color:var(--apx-fg-muted)}
.ax-header{display:flex;flex-direction:column;gap:8px}
.ax-card{background:var(--apx-surface);border:1px solid var(--apx-border);border-radius:var(--apx-radius-md);padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--apx-shadow-sm);min-width:0}
.ax-card--flat{background:var(--apx-fill);border-color:transparent;box-shadow:none}
.ax-card--tight{padding:12px 14px;gap:8px}
.ax-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.ax-card__title{margin:0;font-size:14px;font-weight:600}
.ax-card__desc{margin:2px 0 0;font-size:12px;color:var(--apx-fg-muted);text-wrap:pretty}
.ax-divider{height:1px;background:var(--apx-border);border:0;margin:0}
.ax-stat{display:flex;flex-direction:column;gap:4px}
.ax-stat__label{font-size:12px;color:var(--apx-fg-muted);display:flex;align-items:center;gap:6px}
.ax-stat__value{font-size:30px;line-height:1.1;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ax-stat__value small{font-size:15px;font-weight:500;color:var(--apx-fg-muted);margin-left:2px}
.ax-stat__foot{font-size:12px;color:var(--apx-fg-subtle);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ax-stat--empty .ax-stat__value{color:var(--apx-fg-subtle);font-weight:500;font-size:22px}
.ax-delta{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}.ax-delta--up{color:var(--apx-brand)}.ax-delta--down{color:var(--apx-danger)}
.ax-badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:var(--apx-radius-pill);font-size:11.5px;font-weight:550;white-space:nowrap;background:var(--apx-fill);color:var(--apx-fg-muted)}
.ax-badge--brand{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg)}
.ax-badge--info{background:var(--apx-info-soft);color:var(--apx-info-soft-fg)}
.ax-badge--warning{background:var(--apx-warning-soft);color:var(--apx-warning-soft-fg)}
.ax-badge--danger{background:var(--apx-danger-soft);color:var(--apx-danger-soft-fg)}
.ax-badge--violet{background:var(--apx-violet-soft);color:var(--apx-violet-soft-fg)}
.ax-badge--dot::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.ax-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border-radius:var(--apx-radius-pill);border:0;background:var(--apx-fill);color:var(--apx-fg);font:inherit;font-size:13px;font-weight:550;cursor:pointer;white-space:nowrap;transition:background .14s}
.ax-btn:hover{background:var(--apx-fill-hover)}.ax-btn:disabled{opacity:.5;cursor:default}
.ax-btn--primary{background:var(--apx-accent);color:var(--apx-accent-fg)}.ax-btn--primary:hover{background:var(--apx-accent-hover)}
.ax-btn--ghost{background:transparent;color:var(--apx-fg-muted)}.ax-btn--ghost:hover{background:var(--apx-fill);color:var(--apx-fg)}
.ax-btn--sm{height:26px;padding:0 10px;font-size:12px}
.ax-btn[aria-busy=true]::before{content:"";width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:ax-spin .7s linear infinite}
@keyframes ax-spin{to{transform:rotate(360deg)}}
.ax-toolbar{display:flex;align-items:flex-end;flex-wrap:wrap;gap:10px}
.ax-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.ax-field>span{font-size:11.5px;color:var(--apx-fg-subtle)}
.ax-input,.ax-select{height:32px;padding:0 12px;border-radius:var(--apx-radius-pill);border:1px solid transparent;background:var(--apx-fill);color:var(--apx-fg);font:inherit;font-size:13px;min-width:0;outline:none}
.ax-input:focus,.ax-select:focus{border-color:var(--apx-border-strong);background:var(--apx-surface)}
.ax-input::placeholder{color:var(--apx-fg-subtle)}
.ax-input::-webkit-calendar-picker-indicator{opacity:.5;cursor:pointer}
:root[data-ax-mode=dark] .ax-input::-webkit-calendar-picker-indicator{filter:invert(1)}
.ax-select{appearance:none;padding-right:30px;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,var(--apx-fg-subtle) 50%),linear-gradient(135deg,var(--apx-fg-subtle) 50%,transparent 50%);background-position:calc(100% - 16px) 14px,calc(100% - 12px) 14px;background-size:4px 4px;background-repeat:no-repeat}
.ax-search{position:relative;display:flex;align-items:center;min-width:180px}
.ax-search .ax-input{width:100%;padding-left:32px}
.ax-search::before{content:"";position:absolute;left:12px;width:10px;height:10px;border:1.6px solid var(--apx-fg-subtle);border-radius:50%;margin-top:-2px}
.ax-search::after{content:"";position:absolute;left:21px;top:19px;width:5px;height:1.6px;background:var(--apx-fg-subtle);transform:rotate(45deg)}
.ax-seg{display:inline-flex;padding:3px;gap:2px;border-radius:var(--apx-radius-pill);background:var(--apx-fill)}
.ax-seg button{height:26px;padding:0 12px;border:0;border-radius:var(--apx-radius-pill);background:transparent;color:var(--apx-fg-muted);font:inherit;font-size:12.5px;font-weight:550;cursor:pointer;white-space:nowrap}
.ax-seg button[aria-pressed=true]{background:var(--apx-surface-raised);color:var(--apx-fg);box-shadow:0 0 0 1px var(--apx-border),0 1px 2px rgb(0 0 0 / .16)}
.ax-progress{height:6px;border-radius:99px;background:var(--apx-fill-strong);overflow:hidden}
.ax-progress>i{display:block;height:100%;width:calc(var(--v,0) * 1%);background:var(--tone,var(--apx-brand));border-radius:inherit;transition:width .4s cubic-bezier(.2,0,0,1)}
.ax-table{width:100%;border-collapse:collapse;font-size:13px}
.ax-table th{text-align:left;font-weight:500;font-size:12px;color:var(--apx-fg-subtle);padding:0 10px 8px;border-bottom:1px solid var(--apx-border)}
.ax-table td{padding:9px 10px;border-bottom:1px solid var(--apx-border);font-variant-numeric:tabular-nums}
.ax-table tr:last-child td{border-bottom:0}.ax-table th:first-child,.ax-table td:first-child{padding-left:0}.ax-table th:last-child,.ax-table td:last-child{padding-right:0}
.ax-table .r{text-align:right}
.ax-table tbody tr:hover td{background:var(--apx-fill)}
.ax-list{display:flex;flex-direction:column;background:var(--apx-surface);border:1px solid var(--apx-border);border-radius:var(--apx-radius-md);overflow:hidden}
.ax-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:14px 18px;border-top:1px solid var(--apx-border)}
.ax-item:first-child{border-top:0}.ax-item[hidden]{display:none}
.ax-item:hover{background:color-mix(in srgb,var(--apx-fill) 50%,transparent)}
.ax-item__title{font-weight:600;font-size:14px}
.ax-item__sub{font-size:12px;color:var(--apx-fg-subtle)}
.ax-item__body{grid-column:1/-1;color:var(--apx-fg);text-wrap:pretty}
.ax-item__foot{grid-column:1/-1;font-size:12px;color:var(--apx-fg-subtle);display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}
.ax-item__aside{grid-row:1/3;grid-column:2;align-self:start}
.ax-callout{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--apx-radius-md);background:var(--apx-fill);font-size:13px;color:var(--apx-fg-muted)}
.ax-callout--warning{background:var(--apx-warning-soft);color:var(--apx-warning-soft-fg)}
.ax-callout--danger{background:var(--apx-danger-soft);color:var(--apx-danger-soft-fg)}
.ax-callout--brand{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg)}
.ax-empty{padding:32px 16px;text-align:center;color:var(--apx-fg-subtle);font-size:13px}
.ax-details{border-radius:var(--apx-radius-md);background:var(--apx-fill)}
.ax-details>summary{list-style:none;cursor:pointer;padding:10px 14px;font-size:13px;font-weight:550;display:flex;align-items:center;gap:8px}
.ax-details>summary::-webkit-details-marker{display:none}
.ax-details>summary::before{content:"";width:6px;height:6px;border-right:1.5px solid var(--apx-fg-subtle);border-bottom:1.5px solid var(--apx-fg-subtle);transform:rotate(-45deg);transition:transform .14s}
.ax-details[open]>summary::before{transform:rotate(45deg)}
.ax-details>:not(summary){padding:0 14px 12px}
.ax-skeleton{border-radius:6px;background:linear-gradient(90deg,var(--apx-fill),var(--apx-fill-hover),var(--apx-fill));background-size:200% 100%;animation:ax-sh 1.2s ease-in-out infinite;min-height:12px}
@keyframes ax-sh{to{background-position:-200% 0}}
.ax-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--apx-fg-subtle)}
.ax-live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--apx-brand);box-shadow:0 0 0 3px var(--apx-brand-soft)}
.ax-live[data-state=stale]::before{background:var(--apx-warning);box-shadow:0 0 0 3px var(--apx-warning-soft)}
.ax-live[data-state=error]::before{background:var(--apx-danger);box-shadow:0 0 0 3px var(--apx-danger-soft)}
ax-bars{display:flex;flex-direction:column;gap:12px}
.ax-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;align-items:baseline}
.ax-bar__label{font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ax-bar__val{font-size:13px;font-variant-numeric:tabular-nums;display:flex;gap:8px;align-items:baseline}
.ax-bar__val b{font-weight:600}.ax-bar__val span{color:var(--apx-fg-subtle);font-size:12px;min-width:44px;text-align:right}
.ax-bar .ax-progress{grid-column:1/-1}
ax-split{display:flex;flex-direction:column;gap:10px}
.ax-split__track{display:flex;height:8px;border-radius:99px;overflow:hidden;gap:2px;background:var(--apx-fill-strong)}
.ax-split__track>i{display:block;height:100%}
.ax-split__legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--apx-fg-muted)}
.ax-split__legend span{display:inline-flex;align-items:center;gap:6px}.ax-split__legend b{color:var(--apx-fg);font-weight:600;font-variant-numeric:tabular-nums}
.ax-split__legend i{width:8px;height:8px;border-radius:3px}
ax-spark{display:block;height:var(--h,36px)}ax-spark svg{display:block;width:100%;height:100%;overflow:visible}
.ax-tag{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:7px;border:1px solid var(--apx-border);font-size:12px;color:var(--apx-fg-muted);background:var(--apx-surface);white-space:nowrap}
.ax-tag>b{font-weight:600;color:var(--apx-fg)}
.ax-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tone,var(--apx-brand));flex:none}
ax-steps{display:inline-flex;align-items:center;gap:4px;vertical-align:middle}
ax-steps i{width:8px;height:8px;border-radius:50%;background:var(--apx-fill-strong);flex:none}
ax-steps i[data-on]{background:var(--tone,var(--apx-brand))}
ax-steps i[data-fail]{background:var(--apx-danger)}
.ax-avatar{--s:32px;width:var(--s);height:var(--s);border-radius:50%;display:inline-grid;place-items:center;flex:none;font-size:calc(var(--s) * .38);font-weight:600;background:var(--tint,var(--apx-fill-strong));color:var(--apx-fg);overflow:hidden;object-fit:cover}
.ax-avatar--sm{--s:22px}.ax-avatar--lg{--s:44px}.ax-avatar--sq{border-radius:28%}
.ax-avatars{display:inline-flex}.ax-avatars>*{box-shadow:0 0 0 2px var(--apx-surface)}.ax-avatars>*+*{margin-left:-8px}
.ax-agent{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:13px;color:var(--tone,var(--apx-brand))}
.ax-agent::before{content:"";width:14px;height:12px;border-radius:50% 50% 45% 45%/60% 60% 40% 40%;background:var(--tone,var(--apx-brand))}
.ax-tabs{display:flex;gap:2px;border-bottom:1px solid var(--apx-border);overflow-x:auto}
.ax-tabs button{height:36px;padding:0 12px;border:0;background:none;font:inherit;font-size:13px;font-weight:550;color:var(--apx-fg-muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.ax-tabs button:hover{color:var(--apx-fg)}.ax-tabs button[aria-selected=true]{color:var(--apx-fg);border-bottom-color:var(--apx-fg)}
.ax-tabs .ax-count{font-size:11px;padding:0 6px;border-radius:99px;background:var(--apx-fill);color:var(--apx-fg-subtle)}
[data-panel][hidden]{display:none}
.ax-switch{appearance:none;width:34px;height:20px;border-radius:99px;background:var(--apx-fill-strong);position:relative;cursor:pointer;margin:0;flex:none;transition:background .14s}
.ax-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .25);transition:transform .14s}
.ax-switch:checked{background:var(--apx-accent)}.ax-switch:checked::after{transform:translateX(14px)}
:root[data-ax-mode=dark] .ax-switch:checked::after{background:var(--apx-accent-fg)}
.ax-check{appearance:none;width:16px;height:16px;border-radius:5px;border:1.5px solid var(--apx-border-strong);margin:0;cursor:pointer;display:inline-grid;place-items:center;flex:none;background:var(--apx-surface)}
.ax-check[type=radio]{border-radius:50%}
.ax-check:checked{background:var(--apx-accent);border-color:var(--apx-accent)}
.ax-check:checked::after{content:"";width:4px;height:8px;border:solid var(--apx-accent-fg);border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
.ax-check[type=radio]:checked::after{width:6px;height:6px;border:0;border-radius:50%;background:var(--apx-accent-fg);transform:none}
.ax-option{display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer}
.ax-option small{display:block;color:var(--apx-fg-subtle);font-size:12px}
.ax-textarea{min-height:80px;padding:10px 12px;border-radius:var(--apx-radius-md);border:1px solid transparent;background:var(--apx-fill);color:var(--apx-fg);font:inherit;font-size:13px;resize:vertical;outline:none;width:100%}
.ax-textarea:focus{border-color:var(--apx-border-strong);background:var(--apx-surface)}
.ax-range{appearance:none;width:100%;height:4px;border-radius:99px;background:linear-gradient(var(--apx-accent),var(--apx-accent)) 0/var(--p,50%) 100% no-repeat,var(--apx-fill-strong);margin:8px 0;cursor:pointer}
.ax-range::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border-radius:50%;background:var(--apx-surface-raised);border:2px solid var(--apx-accent)}
.ax-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--apx-surface-raised);border:2px solid var(--apx-accent)}
.ax-kv{display:grid;grid-template-columns:minmax(100px,max-content) minmax(0,1fr);gap:8px 20px;margin:0;font-size:13px}
.ax-kv dt{color:var(--apx-fg-subtle)}.ax-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ax-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.ax-steps li{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:7px 0;font-size:13px}
.ax-steps li::before{content:"";width:14px;height:14px;border-radius:50%;box-sizing:border-box;border:1.5px dashed var(--apx-border-strong)}
.ax-steps li[data-s=done]::before{border:0;background:var(--apx-brand) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M4 7.2l2 2 4-4.4' fill='none' stroke='white' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.ax-steps li[data-s=running]::before{border:2px solid var(--apx-info);border-right-color:transparent;animation:ax-spin .8s linear infinite}
.ax-steps li[data-s=failed]::before{border:0;background:var(--apx-danger) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M5 5l4 4M9 5l-4 4' stroke='white' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E")}
.ax-steps li>small{grid-column:2;font-size:12px;color:var(--apx-fg-subtle)}
.ax-steps li>em{grid-column:3;grid-row:1;font-style:normal;font-size:12px;color:var(--apx-fg-subtle);font-variant-numeric:tabular-nums}
.ax-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.ax-timeline li{position:relative;padding:0 0 18px 22px;font-size:13px}
.ax-timeline li::before{content:"";position:absolute;left:4px;top:6px;width:8px;height:8px;border-radius:50%;background:var(--tone,var(--apx-fg-subtle));box-shadow:0 0 0 3px var(--apx-bg)}
.ax-timeline li::after{content:"";position:absolute;left:7.5px;top:16px;bottom:0;width:1px;background:var(--apx-border)}
.ax-timeline li:last-child{padding-bottom:0}.ax-timeline li:last-child::after{display:none}
.ax-timeline time{display:block;font-size:11.5px;color:var(--apx-fg-subtle);font-variant-numeric:tabular-nums}
.ax-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12.5px;color:var(--apx-fg-subtle)}
.ax-crumbs>*+*::before{content:"/";margin-right:6px;color:var(--apx-border-strong)}
.ax-crumbs a{color:var(--apx-fg-muted);text-decoration:none}.ax-crumbs a:hover{color:var(--apx-fg)}.ax-crumbs>:last-child{color:var(--apx-fg)}
.ax-pages{display:flex;gap:2px;align-items:center}
.ax-pages button{min-width:30px;height:30px;padding:0 8px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--apx-fg-muted);cursor:pointer;font-variant-numeric:tabular-nums}
.ax-pages button:hover{background:var(--apx-fill)}.ax-pages button[aria-current=true]{background:var(--apx-fill-strong);color:var(--apx-fg);font-weight:600}
.ax-pre{margin:0;padding:12px 14px;border-radius:var(--apx-radius-md);background:var(--apx-fill);font-family:var(--apx-font-mono);font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre;color:var(--apx-fg)}
.ax-diff{margin:0;border-radius:var(--apx-radius-md);background:var(--apx-fill);font-family:var(--apx-font-mono);font-size:12px;line-height:1.7;overflow-x:auto;padding:8px 0}
.ax-diff>div{padding:0 14px;white-space:pre}
.ax-diff .add{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg)}.ax-diff .add::before{content:"+ "}
.ax-diff .del{background:var(--apx-danger-soft);color:var(--apx-danger-soft-fg)}.ax-diff .del::before{content:"− "}
.ax-diff .ctx::before{content:"  "}.ax-diff .ctx{color:var(--apx-fg-muted)}
.ax-file{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--apx-radius-md);border:1px solid var(--apx-border);background:var(--apx-surface)}
.ax-file__ico{width:34px;height:40px;border-radius:6px;background:var(--apx-fill);display:grid;place-items:end center;padding-bottom:5px;font:600 9px/1 var(--apx-font-mono);color:var(--apx-fg-muted);text-transform:uppercase;flex:none;clip-path:polygon(0 0,70% 0,100% 22%,100% 100%,0 100%)}
.ax-rank{list-style:none;margin:0;padding:0;counter-reset:r;display:flex;flex-direction:column}
.ax-rank li{counter-increment:r;display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--apx-border);font-size:13px}
.ax-rank li:first-child{border-top:0}
.ax-rank li::before{content:counter(r);font-size:12px;color:var(--apx-fg-subtle);font-variant-numeric:tabular-nums}
.ax-rank li>b{font-weight:600;font-variant-numeric:tabular-nums}
.ax-rank .ax-progress{grid-column:2/-1;height:4px}
.ax-compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--apx-border);border-radius:var(--apx-radius-md);overflow:hidden}
.ax-compare>div{padding:14px 16px;display:flex;flex-direction:column;gap:4px}.ax-compare>div+div{border-left:1px solid var(--apx-border)}
.ax-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:var(--apx-radius-md);background:var(--apx-surface);border:1px solid var(--apx-border);font-size:13px}
.ax-banner>.ax-grow{min-width:200px}
.ax-menu{position:relative;display:inline-block}
.ax-menu>summary{list-style:none}.ax-menu>summary::-webkit-details-marker{display:none}
.ax-menu__list{position:absolute;top:calc(100% + 6px);right:0;z-index:30;min-width:200px;padding:4px;border-radius:var(--apx-radius-md);background:var(--apx-surface-raised);border:1px solid var(--apx-border);box-shadow:0 8px 24px rgb(0 0 0 / .18);display:flex;flex-direction:column}
.ax-menu__list button,.ax-menu__list a{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--apx-fg);text-decoration:none;cursor:pointer;text-align:left}
.ax-menu__list button:hover,.ax-menu__list a:hover{background:var(--apx-fill)}
.ax-menu__list .danger{color:var(--apx-danger)}.ax-menu__list hr{border:0;height:1px;background:var(--apx-border);margin:4px 0}
.ax-dialog{border:0;padding:0;border-radius:var(--apx-radius-lg);background:var(--apx-surface-raised);color:var(--apx-fg);width:min(440px,calc(100vw - 32px));box-shadow:0 24px 64px rgb(0 0 0 / .3)}
.ax-dialog::backdrop{background:rgb(0 0 0 / .45)}
.ax-dialog>form,.ax-dialog>div{padding:20px 22px;display:flex;flex-direction:column;gap:12px}
.ax-dialog__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.ax-toasts{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:50;pointer-events:none}
.ax-toast{padding:9px 14px;border-radius:var(--apx-radius-pill);background:var(--apx-fg);color:var(--apx-bg);font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgb(0 0 0 / .2);animation:ax-in .2s cubic-bezier(.2,0,0,1)}
.ax-toast .ax-dot{--tone:var(--apx-brand)}
@keyframes ax-in{from{opacity:0;transform:translateY(8px)}}
.ax-table[data-ax-sort] th{cursor:pointer;user-select:none}.ax-table[data-ax-sort] th:hover{color:var(--apx-fg)}
.ax-table th[aria-sort=ascending]::after{content:" ↑"}.ax-table th[aria-sort=descending]::after{content:" ↓"}
ax-chart{display:block;position:relative}ax-chart svg{display:block;width:100%;overflow:visible}
ax-chart text{font:11px var(--apx-font-sans);fill:var(--apx-fg-subtle)}
.ax-chart__tip{position:absolute;pointer-events:none;padding:8px 10px;border-radius:10px;background:var(--apx-surface-raised);border:1px solid var(--apx-border);box-shadow:0 8px 24px rgb(0 0 0 / .18);font-size:12px;display:flex;flex-direction:column;gap:3px;min-width:120px;transform:translate(-50%,-100%);white-space:nowrap;z-index:10}
.ax-chart__tip b{font-weight:600}.ax-chart__tip span{display:flex;align-items:center;gap:6px;justify-content:space-between}
.ax-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--apx-fg-muted)}
.ax-legend span{display:inline-flex;align-items:center;gap:6px}.ax-legend i{width:8px;height:8px;border-radius:3px}
ax-donut,ax-ring{display:inline-grid;position:relative;place-items:center}
ax-donut svg,ax-ring svg{display:block;transform:rotate(-90deg)}
.ax-ring__c{position:absolute;inset:0;display:grid;place-content:center;text-align:center;line-height:1.15}
.ax-ring__c b{font-size:var(--fs,20px);font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.ax-ring__c small{font-size:11px;color:var(--apx-fg-subtle)}
ax-heat{display:block;overflow-x:auto}
.ax-heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,11px);gap:3px;width:max-content}
.ax-heat i{width:11px;height:11px;border-radius:3px;background:var(--apx-fill-strong)}
.ax-heat i[data-l="1"]{background:color-mix(in srgb,var(--apx-brand) 30%,var(--apx-fill-strong))}
.ax-heat i[data-l="2"]{background:color-mix(in srgb,var(--apx-brand) 55%,var(--apx-fill-strong))}
.ax-heat i[data-l="3"]{background:color-mix(in srgb,var(--apx-brand) 80%,var(--apx-fill-strong))}
.ax-heat i[data-l="4"]{background:var(--apx-brand)}
:root{--apx-grad:linear-gradient(90deg,var(--apx-brand),var(--apx-violet))}
.ax-hero{position:relative;background:var(--apx-surface);border:1px solid var(--apx-border);border-radius:var(--apx-radius-lg);padding:22px 24px;display:flex;flex-wrap:wrap;gap:16px 24px;justify-content:space-between;align-items:flex-start;overflow:hidden}
.ax-hero>*{position:relative;min-width:0}
.ax-hero__eyebrow{font-size:12.5px;font-weight:600;color:var(--apx-fg-muted)}
.ax-hero h1{margin:2px 0 6px;font-size:26px;line-height:1.15;letter-spacing:-.02em;font-weight:700}
.ax-hero p{margin:0;max-width:62ch;color:var(--apx-fg-muted);text-wrap:pretty}
.ax-card--accent{position:relative;overflow:hidden}
:root[data-ax-style=aurora] .ax-hero{border-color:var(--apx-border);background:radial-gradient(120% 140% at 0% 0%,color-mix(in srgb,var(--apx-brand) 22%,transparent),transparent 55%),radial-gradient(90% 120% at 100% 0%,color-mix(in srgb,var(--apx-violet) 24%,transparent),transparent 60%),var(--apx-surface)}
:root[data-ax-style=aurora] .ax-card--accent::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--apx-grad)}
:root[data-ax-style=aurora] .ax-progress>i{background:var(--tone,var(--apx-grad));background-size:calc(10000% / max(var(--v,100),1)) 100%}
:root[data-ax-style=aurora] .ax-btn--primary{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--apx-brand) 45%,transparent)}
:root[data-ax-style=aurora] .ax-btn--primary:hover{background:color-mix(in srgb,var(--apx-brand) 26%,transparent)}
:root[data-ax-style=aurora] .ax-seg button[aria-pressed=true]{background:var(--apx-brand-soft);color:var(--apx-brand-soft-fg);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--apx-brand) 45%,transparent)}
:root[data-ax-style=aurora] .ax-live::before{box-shadow:0 0 8px var(--apx-brand)}
:root{--apx-sidebar:#f4f3f0}:root[data-ax-mode=dark]{--apx-sidebar:#1a1a19}
:root[data-ax-surface=app],:root[data-ax-surface=app] body{height:100%;overflow:hidden;background:var(--apx-bg)}
ax-icon{display:inline-grid;place-items:center;width:var(--s,16px);height:var(--s,16px);flex:none;color:inherit}ax-icon svg{width:100%;height:100%;display:block}
.ax-app{display:flex;height:100%;min-height:0;background:var(--apx-bg);color:var(--apx-fg);overflow:hidden;position:relative}
.ax-rail{width:56px;flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 0;background:var(--apx-sidebar);border-right:1px solid var(--apx-border)}
.ax-rail__btn{position:relative;width:36px;height:36px;border:0;border-radius:10px;background:none;color:var(--apx-fg-muted);display:grid;place-items:center;cursor:pointer;--s:18px}
.ax-rail__btn:hover{background:var(--apx-fill);color:var(--apx-fg)}.ax-rail__btn[aria-selected=true]{background:var(--apx-fill-strong);color:var(--apx-fg)}
.ax-rail__btn[data-badge]::after{content:"";position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:var(--apx-info);box-shadow:0 0 0 2px var(--apx-sidebar)}
.ax-rail hr{width:24px;border:0;height:1px;background:var(--apx-border);margin:6px 0}
.ax-rail__spacer{flex:1}
.ax-sidebar{width:var(--w,256px);flex:none;display:flex;flex-direction:column;min-height:0;background:var(--apx-sidebar);border-right:1px solid var(--apx-border);transition:margin .2s cubic-bezier(.2,0,0,1)}
.ax-sidebar[data-collapsed]{margin-left:calc(var(--w,256px) * -1)}
.ax-sidebar__head{display:flex;align-items:center;gap:6px;height:52px;padding:0 10px 0 16px;flex:none}
.ax-sidebar__head>b{font-size:15px;font-weight:650;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}
.ax-sidebar__body{flex:1;min-height:0;overflow-y:auto;padding:4px 8px 12px;display:flex;flex-direction:column;gap:2px}
.ax-sidebar__foot{flex:none;padding:10px 12px;border-top:1px solid var(--apx-border);display:flex;align-items:center;gap:10px;font-size:13px}
.ax-section{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:14px 8px 4px;font-size:11.5px;font-weight:550;color:var(--apx-fg-subtle)}
.ax-nav{display:flex;flex-direction:column;gap:1px}
.ax-nav__item{display:flex;align-items:center;gap:9px;min-height:32px;padding:0 8px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--apx-fg-muted);text-decoration:none;cursor:pointer;text-align:left;width:100%;position:relative}
.ax-nav__item:hover{background:var(--apx-fill);color:var(--apx-fg)}
.ax-nav__item[aria-selected=true],.ax-nav__item[aria-current=page]{background:var(--apx-fill-strong);color:var(--apx-fg);font-weight:550}
.ax-nav__item>span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ax-nav__item>em{font-style:normal;font-size:11.5px;color:var(--apx-fg-subtle);font-variant-numeric:tabular-nums}
.ax-nav__item>.ax-nav__act{opacity:0;display:flex;gap:2px}.ax-nav__item:hover>.ax-nav__act{opacity:1}
.ax-nav__item--sub{padding-left:33px}
.ax-nav__item--muted{color:var(--apx-fg-subtle)}
.ax-group>summary{list-style:none}.ax-group>summary::-webkit-details-marker{display:none}
.ax-group>summary ax-icon.chev{transition:transform .14s}.ax-group:not([open])>summary ax-icon.chev{transform:rotate(-90deg)}
.ax-shell{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.ax-topbar{height:52px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px 0 16px;border-bottom:1px solid var(--apx-border);background:var(--apx-bg)}
.ax-topbar__title{font-size:14px;font-weight:600;flex:1;min-width:0;display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ax-topbar__title small{font-weight:400;color:var(--apx-fg-subtle);font-size:12px}
.ax-main{flex:1;min-height:0;overflow:auto;padding:24px}
.ax-main--flush{padding:0}
.ax-main__inner{max-width:var(--max,1040px);margin:0 auto;display:flex;flex-direction:column;gap:16px}
.ax-statusbar{height:28px;flex:none;display:flex;align-items:center;gap:14px;padding:0 14px;border-top:1px solid var(--apx-border);font-size:11.5px;color:var(--apx-fg-subtle);background:var(--apx-sidebar)}
.ax-aside{width:var(--w,320px);flex:none;border-left:1px solid var(--apx-border);display:flex;flex-direction:column;min-height:0;background:var(--apx-surface);transition:margin .2s cubic-bezier(.2,0,0,1)}
.ax-aside[data-collapsed]{margin-right:calc(var(--w,320px) * -1)}
.ax-aside__head{height:52px;flex:none;display:flex;align-items:center;gap:8px;padding:0 10px 0 16px;border-bottom:1px solid var(--apx-border);font-size:13px;font-weight:600}
.ax-aside__body{flex:1;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px}
.ax-iconbtn{width:30px;height:30px;border:0;border-radius:8px;background:none;color:var(--apx-fg-muted);display:inline-grid;place-items:center;cursor:pointer;flex:none;--s:16px}
.ax-iconbtn:hover{background:var(--apx-fill);color:var(--apx-fg)}.ax-iconbtn[aria-pressed=true]{background:var(--apx-fill-strong);color:var(--apx-fg)}
.ax-iconbtn--sm{width:24px;height:24px;border-radius:6px;--s:14px}
.ax-split{display:grid;grid-template-columns:var(--list,340px) minmax(0,1fr);height:100%;min-height:0}
.ax-split>*{min-height:0;overflow:auto}
.ax-split__list{border-right:1px solid var(--apx-border);display:flex;flex-direction:column}
.ax-split__list>.ax-split__tools{position:sticky;top:0;z-index:2;background:var(--apx-bg);padding:12px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--apx-border)}
.ax-listrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:11px 14px;border:0;border-bottom:1px solid var(--apx-border);background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;width:100%}
.ax-listrow:hover{background:var(--apx-fill)}
.ax-listrow[aria-selected=true]{background:var(--apx-fill-strong);box-shadow:inset 2px 0 0 var(--apx-fg)}
.ax-listrow>b{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ax-listrow>small{font-size:12px;color:var(--apx-fg-subtle);grid-column:1/-1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ax-listrow>em{font-style:normal;font-size:11.5px;color:var(--apx-fg-subtle);font-variant-numeric:tabular-nums}
.ax-detail{padding:28px 32px;display:flex;flex-direction:column;gap:18px;max-width:820px}
[data-view-panel][hidden],[data-detail][hidden]{display:none}
.ax-popover{position:absolute;z-index:40;min-width:240px;max-width:320px;padding:6px;border-radius:12px;background:var(--apx-surface-raised);border:1px solid var(--apx-border-strong);box-shadow:0 12px 32px rgb(0 0 0 / .28);display:flex;flex-direction:column;font-size:13px}
.ax-popover__head{display:flex;align-items:center;gap:8px;padding:6px 8px;font-weight:600}
.ax-popover__row{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;color:var(--apx-fg-muted);border-radius:8px;--s:14px}
.ax-popover__row ax-icon{margin-top:2px}
.ax-popover button.ax-popover__row{border:0;background:none;font:inherit;cursor:pointer;text-align:left;width:100%}.ax-popover button.ax-popover__row:hover{background:var(--apx-fill);color:var(--apx-fg)}
.ax-popover hr{border:0;height:1px;background:var(--apx-border);margin:4px 2px}
.ax-hover{position:relative}.ax-hover>.ax-popover{display:none;left:calc(100% + 6px);top:0}.ax-hover:hover>.ax-popover,.ax-hover:focus-within>.ax-popover{display:flex}
.ax-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(260px,1fr);gap:12px;height:100%;min-height:0;overflow-x:auto;padding:16px}
.ax-col{display:flex;flex-direction:column;gap:8px;min-height:0;background:var(--apx-sidebar);border-radius:var(--apx-radius-md);padding:10px}
.ax-col__head{display:flex;align-items:center;gap:8px;padding:2px 4px 6px;font-size:13px;font-weight:600}
.ax-col__head em{font-style:normal;font-weight:400;color:var(--apx-fg-subtle);font-size:12px}
.ax-col__body{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0}
.ax-tile{background:var(--apx-surface);border:1px solid var(--apx-border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;font-size:13px;cursor:grab}
.ax-tile:hover{border-color:var(--apx-border-strong)}
.ax-tile__foot{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--apx-fg-subtle)}
.ax-settings{max-width:720px;display:flex;flex-direction:column;gap:28px}
.ax-setgroup{display:flex;flex-direction:column}
.ax-setgroup>h3{margin:0 0 8px;font-size:13px;font-weight:600}
.ax-setrow{display:flex;align-items:center;gap:16px;padding:12px 0;border-top:1px solid var(--apx-border);font-size:13px}
.ax-setrow>div:first-child{flex:1;min-width:0}.ax-setrow small{display:block;color:var(--apx-fg-subtle);font-size:12px}
.ax-empty-app{height:100%;display:grid;place-content:center;justify-items:center;gap:8px;text-align:center;color:var(--apx-fg-subtle);font-size:13px;padding:24px}
@media (max-width:1180px){.ax-app>.ax-aside{position:absolute;inset:0 0 0 auto;z-index:30;box-shadow:0 0 40px rgb(0 0 0 / .3)}.ax-app>.ax-aside[data-collapsed]{margin-right:calc(var(--w,320px) * -1 - 40px)}}
@media (max-width:900px){.ax-topbar .ax-seg,.ax-topbar .ax-live{display:none}}
@media (max-width:760px){.ax-app>.ax-sidebar{position:absolute;inset:0 auto 0 0;z-index:30;box-shadow:0 0 40px rgb(0 0 0 / .3)}.ax-app>.ax-sidebar[data-collapsed]{margin-left:calc(var(--w,256px) * -1 - 40px)}.ax-app>.ax-aside{position:absolute;inset:0 0 0 auto;z-index:30}.ax-split{grid-template-columns:1fr}.ax-split>.ax-split__list+*{display:none}}
`;
  var TONES = { brand: 'var(--apx-brand)', info: 'var(--apx-info)', warning: 'var(--apx-warning)', danger: 'var(--apx-danger)', violet: 'var(--apx-violet)', neutral: 'var(--apx-fg-subtle)', muted: 'var(--apx-fill-strong)' };
  var tone = function (t) { return TONES[t] || t || TONES.brand; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var LANG = document.documentElement.lang || navigator.language || 'en';
  var T = /^es\b/i.test(LANG) ? { empty: 'Sin datos', copied: 'Copiado', now: 'recién', of: ' de ', yes: 'sí', no: 'no', failed: 'falló' } : { empty: 'No data', copied: 'Copied', now: 'just now', of: ' of ', yes: 'yes', no: 'no', failed: 'failed' };
  var fmt = function (n, d) { return Number(n).toLocaleString(LANG, { maximumFractionDigits: d == null ? 1 : d }); };
  var json = function (el, attr) { try { return JSON.parse(el.getAttribute(attr) || '[]'); } catch (e) { console.warn('[apx-kit] invalid JSON in', attr, el); return []; } };

  var st = document.createElement('style'); st.id = 'apx-kit'; st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);

  var root = document.documentElement, qs = new URLSearchParams(location.search);
  function setMode(m) { root.setAttribute('data-ax-mode', m === 'dark' ? 'dark' : 'light'); }
  var mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  setMode(qs.get('mode') || root.getAttribute('data-ax-mode') || (mq && mq.matches ? 'dark' : 'light'));
  var styleMeta = document.querySelector('meta[name="apx-style"]');
  var axStyle = qs.get('style') || root.getAttribute('data-ax-style') || (styleMeta && styleMeta.content) || 'base';
  if (axStyle === 'aurora') root.setAttribute('data-ax-style', 'aurora'); else root.removeAttribute('data-ax-style');
  var inFrame = window.parent !== window;
  if (inFrame || qs.has('embed')) root.setAttribute('data-ax-embed', '');
  // Inside APX the host bridge (window.apx) owns prompts, sizing and state; other hosts get plain apx:* messages.
  var host = window.apx && window.apx.host === 'apx' ? window.apx : null;

  function post(type, data) {
    if (host) { if (type === 'ask' && data) host.sendPrompt(data.text); return; }
    if (inFrame) window.parent.postMessage(Object.assign({ type: 'apx:' + type }, data || {}), '*');
  }
  window.addEventListener('message', function (e) {
    var d = e.data || {}; if (d.type === 'apx:theme') setMode(d.mode);
    if (d.type === 'apx:data') document.dispatchEvent(new CustomEvent('apx:data', { detail: d.payload }));
  });


  /* Persistent state: APX keeps it per widget, across reloads and new versions, and the agent can read and change it.
     APX.state.get(k, fallback) · set(k, v) · patch({ k: v, gone: null }) · remove(k) · all() · on(fn(state, source)) → off
     Outside APX (a published page, a plain preview) it lives in this page only. */
  function localState() {
    var key = 'apx-state:' + location.pathname, data = {}, subs = [];
    try { data = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { data = {}; }
    var copy = function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
    function all() { return copy(data); }
    function patch(p) {
      Object.keys(p || {}).forEach(function (k) { if (p[k] === null || p[k] === undefined) delete data[k]; else data[k] = copy(p[k]); });
      try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* sandboxed: memory only */ }
      subs.slice().forEach(function (f) { f(all(), 'local'); });
    }
    return {
      persistent: false, all: all, patch: patch,
      get: function (k, d) { return k in data ? copy(data[k]) : d; },
      set: function (k, v) { var o = {}; o[k] = v === undefined ? null : v; patch(o); },
      remove: function (k) { var o = {}; o[k] = null; patch(o); },
      on: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; }
    };
  }
  var state = host && host.state ? host.state : localState();
  var persistKey = function (el) { return el && el.getAttribute && el.getAttribute('data-ax-persist'); };
  function remembered(el, fallback) { var k = persistKey(el); var v = k ? state.get(k) : undefined; return v === undefined ? fallback : v; }
  function remember(el, v) { var k = persistKey(el); if (k) state.set(k, v); }
  function restoreField(el) {
    var v = remembered(el); if (v === undefined || el === document.activeElement) return;
    if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'radio') el.checked = el.value === v; else el.value = v;
    if (el.classList.contains('ax-range')) el.style.setProperty('--p', ((el.value - (el.min || 0)) / ((el.max || 100) - (el.min || 0))) * 100 + '%');
  }
  var FIELDS = 'input[data-ax-persist],select[data-ax-persist],textarea[data-ax-persist]';
  function restoreFields(scope) { scope.querySelectorAll(FIELDS).forEach(restoreField); }
  function saveField(e) {
    var el = e.target; if (!el.matches || !el.matches(FIELDS)) return;
    if (el.type === 'radio') { if (el.checked) remember(el, el.value); return; }
    remember(el, el.type === 'checkbox' ? el.checked : el.value);
  }
  document.addEventListener('input', saveField); document.addEventListener('change', saveField);
  state.on(function (s, source) { if (source === 'remote') { restoreFields(document); window.APX && window.APX.refilter && window.APX.refilter(); } });

  /* Memory beyond state, per artifact: APX.store (cached data by key), APX.live (a reading painted from the store at
     once, then refreshed), APX.db (SQL for apps with records) and APX.fetch (an API through the core, with the
     artifact's own secret). Inside APX the host calls the core with this artifact's id; outside, store lives in memory,
     there is no database, and fetch is the browser's own (a secret makes it reject). */
  var call = host && typeof host.call === 'function' ? host.call : null;
  function cloneJson(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function memoryStore() {
    var m = {};
    var done = function (v) { return Promise.resolve(v); };
    return {
      persistent: false,
      get: function (k) { return done(Object.prototype.hasOwnProperty.call(m, k) ? cloneJson(m[k]) : undefined); },
      set: function (k, v) { if (v === undefined || v === null) delete m[k]; else m[k] = cloneJson(v); return done(); },
      remove: function (k) { delete m[k]; return done(); },
      keys: function () { return done(Object.keys(m)); }
    };
  }
  var store = call ? {
    persistent: true,
    get: function (k) { k = String(k); return call('store_get', { keys: [k] }).then(function (r) { var v = r && r.values; return v && Object.prototype.hasOwnProperty.call(v, k) ? v[k] : undefined; }); },
    set: function (k, v) { var p = {}; p[String(k)] = v === undefined ? null : v; return call('store_set', { patch: p }).then(function () {}); },
    remove: function (k) { var p = {}; p[String(k)] = null; return call('store_set', { patch: p }).then(function () {}); },
    keys: function () { return call('store_get', {}).then(function (r) { return Object.keys((r && r.values) || {}); }); }
  } : memoryStore();

  // Shown = the host shows the frame (live pages stay mounted while hidden) and the tab is in front.
  var hostShown = host && typeof host.visible === 'function' ? host.visible() : true, visSubs = [];
  function shown() { return hostShown && document.visibilityState !== 'hidden'; }
  function fireShown() { visSubs.slice().forEach(function (f) { try { f(shown()); } catch (e) { console.error(e); } }); }
  if (host && typeof host.onVisibility === 'function') host.onVisibility(function (v) { hostShown = !!v; fireShown(); });
  document.addEventListener('visibilitychange', fireShown);
  function onShown(f) { visSubs.push(f); return function () { visSubs = visSubs.filter(function (x) { return x !== f; }); }; }

  /* APX.live('btc', () => APX.fetch(url).then(r => r.json()), { every: 60000, render(v, { stale, at, error }) {…} })
     → { refresh(), stop() }. The cached reading paints first (stale: true); refreshes pause while not shown. */
  function live(key, loader, opts) {
    opts = opts || {};
    var render = typeof opts.render === 'function' ? opts.render : function () {};
    var every = opts.every > 0 ? Math.max(1000, Number(opts.every)) : 0;
    var stopped = false, fresh = false, timer = 0, running = null, last = 0, cur, curAt;
    function paint(v, meta) { if (stopped) return; try { render(v, meta); } catch (e) { console.error(e); } }
    store.get(key).then(function (c) {
      if (fresh || !c || typeof c !== 'object' || !('at' in c)) return;
      cur = c.value; curAt = c.at; paint(cur, { stale: true, at: curAt });
    }, function () {});
    function schedule() {
      clearTimeout(timer); timer = 0;
      if (stopped || !every || !shown()) return;
      timer = setTimeout(refresh, Math.max(0, last + every - Date.now()));
    }
    function refresh() {
      if (stopped) return Promise.resolve();
      if (running) return running;
      running = Promise.resolve().then(loader).then(function (v) {
        last = Date.now(); fresh = true; cur = v; curAt = last;
        paint(v, { stale: false, at: last });
        return store.set(key, { value: v, at: last }).catch(function (e) { console.warn('APX.live: not cached', e); });
      }, function (err) {
        last = Date.now();
        paint(cur, { stale: true, at: curAt, error: (err && err.message) || String(err) });
      }).then(function () { running = null; schedule(); });
      return running;
    }
    var off = onShown(function (v) {
      if (!v) { clearTimeout(timer); timer = 0; return; }
      if (every && !running && Date.now() - last >= every) refresh(); else schedule();
    });
    refresh();
    return { refresh: refresh, stop: function () { stopped = true; clearTimeout(timer); off(); } };
  }

  function noDb() { return Promise.reject(new Error('APX.db is only available inside APX')); }
  var db = call ? {
    available: true,
    query: function (sql, params) {
      return call('db_query', { sql: String(sql), params: params || [] }).then(function (r) {
        return r.rows.map(function (row) { var o = {}; r.columns.forEach(function (c, i) { o[c] = row[i]; }); return o; });
      });
    },
    exec: function (sql, params) {
      return call('db_exec', { sql: String(sql), params: params || [] }).then(function (r) { return { changes: r.changes, lastId: r.last_id }; });
    }
  } : { available: false, query: noDb, exec: noDb };

  function reply(status, headers, body) {
    return {
      status: status, ok: status >= 200 && status < 300, headers: headers,
      text: function () { return Promise.resolve(body); },
      json: function () { return Promise.resolve().then(function () { return JSON.parse(body); }); }
    };
  }
  /* APX.fetch(url, { method, headers, body, secret: { name: 'token', in: 'bearer' } }) → { status, ok, headers, text(), json() } */
  function apxFetch(url, o) {
    o = o || {};
    var method = o.method ? String(o.method).toUpperCase() : 'GET', body = o.body == null ? undefined : String(o.body);
    if (call) {
      var p = { url: String(url), method: method };
      if (o.headers) p.headers = o.headers;
      if (body !== undefined) p.body = body;
      if (o.secret) p.secret = o.secret;
      return call('fetch', p).then(function (r) { return reply(r.status, r.headers || {}, r.body || ''); });
    }
    if (o.secret) return Promise.reject(new Error('APX.fetch: a secret only works inside APX'));
    return window.fetch(String(url), { method: method, headers: o.headers, body: body }).then(function (r) {
      var h = {}; r.headers.forEach(function (v, k) { h[k] = v; });
      return r.text().then(function (b) { return reply(r.status, h, b); });
    });
  }

  /* <ax-bars data='[{"label":"Apertura","value":11}]' total="13" tone="brand"> */
  class Bars extends HTMLElement {
    static get observedAttributes() { return ['data', 'total', 'tone']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var rows = json(this, 'data'), total = +this.getAttribute('total') || Math.max.apply(null, rows.map(function (r) { return +r.value || 0; }).concat(1));
      var t = this.getAttribute('tone');
      this.innerHTML = rows.map(function (r) {
        var p = total ? (r.value / total) * 100 : 0;
        return '<div class="ax-bar"><div class="ax-bar__label" title="' + esc(r.label) + '">' + esc(r.label) + '</div><div class="ax-bar__val"><b>' + fmt(r.value, 0) + '</b><span>' + fmt(p) + '%</span></div><div class="ax-progress" role="meter" aria-valuenow="' + r.value + '" aria-valuemax="' + total + '" aria-label="' + esc(r.label) + '"><i style="--v:' + p + ((r.tone || t) ? ';--tone:' + tone(r.tone || t) : '') + '"></i></div></div>';
      }).join('') || '<div class="ax-empty">' + T.empty + '</div>';
    }
  }
  /* <ax-split data='[{"label":"Sí","value":4,"tone":"brand"},{"label":"No","value":6,"tone":"danger"}]'> */
  class Split extends HTMLElement {
    static get observedAttributes() { return ['data']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var rows = json(this, 'data'), sum = rows.reduce(function (a, r) { return a + (+r.value || 0); }, 0) || 1;
      this.innerHTML = '<div class="ax-split__track">' + rows.map(function (r) { return '<i style="flex:' + r.value + ';background:' + tone(r.tone) + '" title="' + esc(r.label) + ': ' + r.value + '"></i>'; }).join('') + '</div><div class="ax-split__legend">' + rows.map(function (r) { return '<span><i style="background:' + tone(r.tone) + '"></i>' + esc(r.label) + ' <b>' + fmt(r.value, 0) + '</b></span>'; }).join('') + '</div>';
    }
  }
  /* <ax-spark values="3,5,4,8,7" tone="info" fill> */
  class Spark extends HTMLElement {
    static get observedAttributes() { return ['values', 'tone']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var v = (this.getAttribute('values') || '').split(',').map(Number).filter(function (n) { return !isNaN(n); });
      if (v.length < 2) { this.innerHTML = ''; return; }
      var mx = Math.max.apply(null, v), mn = Math.min.apply(null, v), r = mx - mn || 1, W = 100, H = 30;
      var pts = v.map(function (n, i) { return [(i / (v.length - 1)) * W, H - ((n - mn) / r) * (H - 2) - 1]; });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' ');
      var c = tone(this.getAttribute('tone'));
      this.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + (this.hasAttribute('fill') ? '<path d="' + d + ' L' + W + ' ' + H + ' L0 ' + H + 'Z" fill="' + c + '" opacity=".12"/>' : '') + '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    }
  }
  /* <ax-ago datetime="2026-10-18T11:53:32-03:00"> → "hace 3 min" */
  class Ago extends HTMLElement {
    connectedCallback() { this.render(); this._t = setInterval(this.render.bind(this), 30000); }
    disconnectedCallback() { clearInterval(this._t); }
    render() {
      var t = new Date(this.getAttribute('datetime')); if (isNaN(t)) return;
      var s = Math.round((Date.now() - t) / 1000), rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
      var out = s < 45 ? T.now : s < 3600 ? rtf.format(-Math.round(s / 60), 'minute') : s < 86400 ? rtf.format(-Math.round(s / 3600), 'hour') : rtf.format(-Math.round(s / 86400), 'day');
      this.textContent = out; this.title = t.toLocaleString(LANG);
    }
  }
  /* <ax-chart type="line|area|bar" labels="L,M,X" data='[{"name":"Inst.","values":[1,2,3],"tone":"brand"}]' height="200"> */
  class Chart extends HTMLElement {
    static get observedAttributes() { return ['data', 'labels', 'type', 'height']; }
    attributeChangedCallback() { this.render(); }
    connectedCallback() { this.render(); if (window.ResizeObserver) { var w = 0, self = this; this._ro = new ResizeObserver(function () { if (self.clientWidth !== w) { w = self.clientWidth; self.render(); } }); this._ro.observe(this); } }
    disconnectedCallback() { this._ro && this._ro.disconnect(); }
    render() {
      var S = json(this, 'data'), L = (this.getAttribute('labels') || '').split(','), type = this.getAttribute('type') || 'line';
      var W = this.clientWidth || 600, H = +this.getAttribute('height') || 200, pl = 32, pb = 22, pt = 8, iw = W - pl, ih = H - pb - pt;
      if (!S.length) { this.innerHTML = '<div class="ax-empty">' + T.empty + '</div>'; return; }
      var n = Math.max.apply(null, S.map(function (s) { return s.values.length; })), all = [].concat.apply([], S.map(function (s) { return s.values; }));
      var mx = Math.max.apply(null, all.concat(0)), step = Math.pow(10, Math.floor(Math.log10(mx || 1))), top = Math.ceil((mx || 1) / step) * step; if (top / step < 3) { step /= 2; top = Math.ceil((mx || 1) / step) * step; }
      var y = function (v) { return pt + ih - (v / top) * ih; }, bw = iw / n, x = function (i) { return type === 'bar' ? pl + bw * i + bw / 2 : pl + (n < 2 ? iw / 2 : (iw * i) / (n - 1)); };
      var g = '', ticks = Math.round(top / step);
      for (var t = 0; t <= ticks; t++) { var v = step * t, yy = y(v).toFixed(1); g += '<line x1="' + pl + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--apx-border)"' + (t ? ' stroke-dasharray="2 3"' : '') + '/><text x="' + (pl - 8) + '" y="' + yy + '" dy="3.5" text-anchor="end">' + fmt(v, 0) + '</text>'; }
      var every = Math.ceil(n / Math.max(1, Math.floor(iw / 56)));
      L.forEach(function (l, i) { if (i % every === 0) g += '<text x="' + x(i) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(l) + '</text>'; });
      S.forEach(function (s, si) {
        var c = tone(s.tone || ['brand', 'info', 'violet', 'warning'][si % 4]);
        if (type === 'bar') { var gw = Math.min(bw * 0.7, 36), w1 = gw / S.length; s.values.forEach(function (v, i) { var h = ih - (y(v) - pt); g += '<rect x="' + (x(i) - gw / 2 + w1 * si + 1).toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + Math.max(1, w1 - 2).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3" fill="' + c + '"/>'; }); }
        else { var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
          if (type === 'area') g += '<path d="' + d + ' L' + x(s.values.length - 1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + 'Z" fill="' + c + '" opacity=".14"/>';
          g += '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dashed ? ' stroke-dasharray="4 4"' : '') + '/>'; }
      });
      g += '<line class="hl" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="var(--apx-border-strong)" opacity="0"/>';
      var leg = S.length > 1 ? '<div class="ax-legend" style="margin-bottom:10px">' + S.map(function (s, si) { return '<span><i style="background:' + tone(s.tone || ['brand', 'info', 'violet', 'warning'][si % 4]) + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' : '';
      this.innerHTML = leg + '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '">' + g + '</svg><div class="ax-chart__tip" hidden></div>';
      var svg = this.querySelector('svg'), tip = this.querySelector('.ax-chart__tip'), hl = svg.querySelector('.hl'), self = this;
      svg.onmousemove = function (e) {
        var r = svg.getBoundingClientRect(), px = e.clientX - r.left, i = type === 'bar' ? Math.floor((px - pl) / bw) : Math.round(((px - pl) / iw) * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
        hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i)); hl.setAttribute('opacity', type === 'bar' ? 0 : 1);
        tip.hidden = false; tip.style.left = Math.min(Math.max(x(i), 70), W - 70) + 'px'; tip.style.top = (svg.offsetTop + Math.min.apply(null, S.map(function (s) { return y(s.values[i] || 0); })) - 8) + 'px';
        tip.innerHTML = '<b>' + esc(L[i] || '') + '</b>' + S.map(function (s, si) { return '<span><span><i class="ax-dot" style="--tone:' + tone(s.tone || ['brand', 'info', 'violet', 'warning'][si % 4]) + '"></i>' + esc(s.name) + '</span><b>' + fmt(s.values[i], 1) + '</b></span>'; }).join('');
      };
      svg.onmouseleave = function () { tip.hidden = true; hl.setAttribute('opacity', 0); };
    }
  }
  /* <ax-donut data='[{"label":"macOS","value":8}]' size="140" label="13" sub="total"> */
  class Donut extends HTMLElement {
    static get observedAttributes() { return ['data', 'label', 'sub', 'size']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var D = json(this, 'data'), sz = +this.getAttribute('size') || 140, sw = Math.max(10, sz * 0.12), r = (sz - sw) / 2, C = 2 * Math.PI * r, sum = D.reduce(function (a, d) { return a + (+d.value || 0); }, 0) || 1, off = 0, gap = D.length > 1 ? 2 : 0;
      var arcs = D.map(function (d, i) { var len = (d.value / sum) * C, s = '<circle r="' + r + '" cx="' + sz / 2 + '" cy="' + sz / 2 + '" fill="none" stroke="' + tone(d.tone || ['brand', 'info', 'violet', 'warning', 'danger', 'neutral'][i % 6]) + '" stroke-width="' + sw + '" stroke-dasharray="' + Math.max(0, len - gap) + ' ' + C + '" stroke-dashoffset="' + -off + '"><title>' + esc(d.label) + ': ' + d.value + '</title></circle>'; off += len; return s; }).join('');
      this.innerHTML = '<svg width="' + sz + '" height="' + sz + '"><circle r="' + r + '" cx="' + sz / 2 + '" cy="' + sz / 2 + '" fill="none" stroke="var(--apx-fill)" stroke-width="' + sw + '"/>' + arcs + '</svg><div class="ax-ring__c" style="--fs:' + Math.round(sz * 0.16) + 'px"><b>' + esc(this.getAttribute('label') || fmt(sum, 0)) + '</b><small>' + esc(this.getAttribute('sub') || '') + '</small></div>';
    }
  }
  /* <ax-ring value="76" max="100" tone="brand" size="72" sub="cobertura"> */
  class Ring extends HTMLElement {
    static get observedAttributes() { return ['value', 'max', 'tone', 'size', 'sub', 'label']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var v = +this.getAttribute('value') || 0, mx = +this.getAttribute('max') || 100, sz = +this.getAttribute('size') || 72, sw = Math.max(5, sz * 0.1), r = (sz - sw) / 2, C = 2 * Math.PI * r, p = Math.max(0, Math.min(1, v / mx));
      this.innerHTML = '<svg width="' + sz + '" height="' + sz + '"><circle r="' + r + '" cx="' + sz / 2 + '" cy="' + sz / 2 + '" fill="none" stroke="var(--apx-fill-strong)" stroke-width="' + sw + '"/><circle r="' + r + '" cx="' + sz / 2 + '" cy="' + sz / 2 + '" fill="none" stroke="' + tone(this.getAttribute('tone')) + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + C * p + ' ' + C + '"/></svg><div class="ax-ring__c" style="--fs:' + Math.round(sz * 0.24) + 'px"><b>' + esc(this.getAttribute('label') || Math.round(p * 100) + '%') + '</b>' + (this.getAttribute('sub') ? '<small>' + esc(this.getAttribute('sub')) + '</small>' : '') + '</div>';
    }
  }
  /* <ax-heat values="0,2,5,…"> — 7 filas (días) × semanas */
  class Heat extends HTMLElement {
    static get observedAttributes() { return ['values']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var v = (this.getAttribute('values') || '').split(',').map(Number), mx = Math.max.apply(null, v.concat(1));
      this.innerHTML = '<div class="ax-heat">' + v.map(function (n) { return '<i data-l="' + (n ? Math.min(4, Math.ceil((n / mx) * 4)) : 0) + '" title="' + n + '"></i>'; }).join('') + '</div>';
    }
  }
  [['ax-chart', Chart], ['ax-donut', Donut], ['ax-ring', Ring], ['ax-heat', Heat]].forEach(function (p) { if (!customElements.get(p[0])) customElements.define(p[0], p[1]); });

  function toast(text, t) {
    var h = document.querySelector('.ax-toasts'); if (!h) { h = document.createElement('div'); h.className = 'ax-toasts'; document.body.appendChild(h); }
    var el = document.createElement('div'); el.className = 'ax-toast'; el.innerHTML = '<i class="ax-dot" style="--tone:' + tone(t) + '"></i>' + esc(text); h.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }
  function wireTabs(scope) {
    var bs = [].slice.call(scope.querySelectorAll('.ax-tabs [data-tab]'));
    function sel(id) { bs.forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === id); }); scope.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== id; }); }
    bs.forEach(function (b) { b.setAttribute('role', 'tab'); b.addEventListener('click', function () { sel(b.dataset.tab); remember(scope, b.dataset.tab); }); });
    var saved = remembered(scope), cur = bs.filter(function (b) { return saved !== undefined ? b.dataset.tab === saved : b.getAttribute('aria-selected') === 'true'; })[0] || bs[0]; if (cur) sel(cur.dataset.tab);
  }
  function wireSort(t) {
    t.querySelectorAll('th').forEach(function (th, ci) {
      th.addEventListener('click', function () {
        var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        t.querySelectorAll('th').forEach(function (o) { o.removeAttribute('aria-sort'); }); th.setAttribute('aria-sort', dir);
        var tb = t.tBodies[0], rows = [].slice.call(tb.rows);
        rows.sort(function (a, b) { var A = a.cells[ci].dataset.v || a.cells[ci].textContent.trim(), B = b.cells[ci].dataset.v || b.cells[ci].textContent.trim(), nA = parseFloat(A.replace(/[^\d.,-]/g, '').replace(',', '.')), nB = parseFloat(B.replace(/[^\d.,-]/g, '').replace(',', '.')); var c = !isNaN(nA) && !isNaN(nB) ? nA - nB : A.localeCompare(B, LANG); return dir === 'ascending' ? c : -c; });
        rows.forEach(function (r) { tb.appendChild(r); });
      });
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var cp = t.closest('[data-ax-copy]'); if (cp) { navigator.clipboard && navigator.clipboard.writeText(cp.getAttribute('data-ax-copy')); toast(T.copied); }
    var op = t.closest('[data-ax-open]'); if (op) { var d = document.querySelector(op.getAttribute('data-ax-open')); d && d.showModal && d.showModal(); }
    var cl = t.closest('[data-ax-close]'); if (cl) { var dd = cl.closest('dialog'); dd && dd.close(); }
    var tt = t.closest('[data-ax-toast]'); if (tt) toast(tt.getAttribute('data-ax-toast'), tt.getAttribute('data-tone'));
    document.querySelectorAll('details.ax-menu[open]').forEach(function (m) { if (!m.contains(t) || t.closest('.ax-menu__list button,.ax-menu__list a')) m.open = false; });
  });
  document.addEventListener('input', function (e) { if (e.target.classList && e.target.classList.contains('ax-range')) { var r = e.target; r.style.setProperty('--p', ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100 + '%'); var o = r.dataset.out && document.querySelector(r.dataset.out); if (o) o.textContent = r.value; } });
  /* <ax-steps value="11101" labels="start,open,…"> · or value="3" total="5" · x = failed */
  class Steps extends HTMLElement {
    static get observedAttributes() { return ['value', 'total', 'labels', 'tone']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() {
      var v = (this.getAttribute('value') || '').trim(), labels = (this.getAttribute('labels') || '').split(',').map(function (s) { return s.trim(); });
      var s = /^[01x]+$/.test(v) && v.length > 1 ? v.split('') : null;
      if (!s) { var n = +this.getAttribute('total') || labels.filter(Boolean).length || 5, k = Math.max(0, Math.min(n, +v || 0)); s = []; for (var i = 0; i < n; i++) s.push(i < k ? '1' : '0'); }
      var t = this.getAttribute('tone'); if (t) this.style.setProperty('--tone', tone(t));
      var done = s.filter(function (c) { return c === '1'; }).length;
      this.setAttribute('role', 'img'); this.setAttribute('aria-label', done + T.of + s.length);
      this.innerHTML = s.map(function (c, i) { var l = labels[i] ? esc(labels[i]) + ' · ' + (c === '1' ? T.yes : c === 'x' ? T.failed : T.no) : ''; return '<i' + (c === '1' ? ' data-on' : c === 'x' ? ' data-fail' : '') + (l ? ' title="' + l + '"' : '') + '></i>'; }).join('');
    }
  }
  [['ax-steps', Steps], ['ax-bars', Bars], ['ax-split', Split], ['ax-spark', Spark], ['ax-ago', Ago]].forEach(function (p) { if (!customElements.get(p[0])) customElements.define(p[0], p[1]); });

  /* Filtros declarativos:
     <div data-ax-filter>  controles: <select data-ax-key="area">, <div class="ax-seg" data-ax-key="estado">, <input data-ax-search>
     ítems: [data-ax-item data-area="…" data-estado="…"]  contador: [data-ax-count] ("{n} de {total}") */
  function wireFilter(scope) {
    var state = {}, q = '';
    var items = function () { return [].slice.call(scope.querySelectorAll('[data-ax-item]')); };
    function apply() {
      var all = items(), n = 0;
      all.forEach(function (it) {
        var ok = Object.keys(state).every(function (k) { var v = state[k]; return !v || v === '*' || (it.dataset[k] || '').split(' ').indexOf(v) >= 0; });
        if (ok && q) ok = it.textContent.toLowerCase().indexOf(q) >= 0;
        it.hidden = !ok; if (ok) n++;
      });
      scope.querySelectorAll('[data-ax-count]').forEach(function (c) { c.textContent = (c.getAttribute('data-ax-count') || '{n} de {total}').replace('{n}', n).replace('{total}', all.length); });
      scope.querySelectorAll('[data-ax-empty]').forEach(function (e) { e.hidden = n > 0; });
    }
    scope.querySelectorAll('select[data-ax-key]').forEach(function (s) { state[s.dataset.axKey] = s.value; s.addEventListener('change', function () { state[s.dataset.axKey] = s.value; apply(); }); });
    scope.querySelectorAll('.ax-seg[data-ax-key]').forEach(function (g) {
      var bs = [].slice.call(g.querySelectorAll('button')), vOf = function (b) { return b.value || b.textContent.trim(); }, saved = remembered(g);
      var cur = bs.filter(function (b) { return saved !== undefined && vOf(b) === saved; })[0] || g.querySelector('[aria-pressed=true]') || bs[0];
      bs.forEach(function (b) { b.setAttribute('aria-pressed', b === cur); b.addEventListener('click', function () { bs.forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); state[g.dataset.axKey] = vOf(b); remember(g, vOf(b)); apply(); }); });
      state[g.dataset.axKey] = cur && vOf(cur);
    });
    scope.querySelectorAll('input[data-ax-search]').forEach(function (i) { q = i.value.trim().toLowerCase(); i.addEventListener('input', function () { q = i.value.trim().toLowerCase(); apply(); }); });
    scope.querySelectorAll('[data-ax-reset]').forEach(function (b) { b.addEventListener('click', function () {
      scope.querySelectorAll('select[data-ax-key]').forEach(function (s) { s.selectedIndex = 0; state[s.dataset.axKey] = s.value; });
      scope.querySelectorAll('input[data-ax-search]').forEach(function (i) { i.value = ''; }); q = ''; apply(); }); });
    apply(); scope._axApply = apply;
  }

  /* Puente con el agente: <button data-ax-ask="Actualizá la lectura">  → el agente recibe el pedido en el chat */
  function ask(text, btn) {
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; setTimeout(function () { btn.removeAttribute('aria-busy'); btn.disabled = false; }, 8000); }
    post('ask', { text: text });
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-ax-ask]'); if (b) ask(b.getAttribute('data-ax-ask'), b); });

  function boot() {
    restoreFields(document);
    document.querySelectorAll('[data-ax-filter]').forEach(wireFilter);
    document.querySelectorAll('[data-ax-tabs]').forEach(wireTabs);
    document.querySelectorAll('table.ax-table[data-ax-sort]').forEach(wireSort);
    document.querySelectorAll('.ax-range').forEach(function (r) { r.style.setProperty('--p', ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100 + '%'); });
    if (inFrame && !host && window.ResizeObserver) { var last = 0; new ResizeObserver(function () { var h = Math.ceil(document.documentElement.scrollHeight); if (h !== last) { last = h; post('resize', { height: h }); } }).observe(document.body); }
    post('ready', { kit: 1, title: document.title });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

  /* Superficie: widget (default, va inline en el chat) | app (ventana aparte, sin padding, layouts completos)
     <meta name="apx-surface" content="app">  o  <html data-ax-surface="app">  o  ?surface=app */
  var meta = document.querySelector('meta[name=apx-surface]');
  var surface = qs.get('surface') || root.getAttribute('data-ax-surface') || (meta && meta.content) || 'widget';
  root.setAttribute('data-ax-surface', surface);
  if (surface === 'app') root.removeAttribute('data-ax-embed');

  var IC = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3', bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    bot: 'M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M9 13v2M15 13v2', plus: 'M12 5v14M5 12h14', filter: 'M3 5h18l-7 8v6l-4 2v-8z',
    more: 'M5 12h.01M12 12h.01M19 12h.01', chevR: 'm9 6 6 6-6 6', chevD: 'm6 9 6 6 6-6', chevL: 'm15 6-6 6 6 6', x: 'M18 6 6 18M6 6l12 12', check: 'M20 6 9 17l-5-5',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
    panelL: 'M4 4h16v16H4zM9 4v16', panelR: 'M4 4h16v16H4zM15 4v16', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    git: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9', pin: 'M12 17v5M9 3h6l-1 6 4 4H6l4-4z',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z', chat: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12z', external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14', calendar: 'M4 5h16v16H4zM16 3v4M8 3v4M4 10h16', alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', kanban: 'M5 3v12M12 3v18M19 3v8',
    sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', star: 'm12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9-5.5 2.9 1-6.1L3 9.5l6.3-.9z'
  };
  class Icon extends HTMLElement {
    static get observedAttributes() { return ['name']; }
    attributeChangedCallback() { this.render(); } connectedCallback() { this.render(); }
    render() { var p = IC[this.getAttribute('name')] || IC.file; this.setAttribute('aria-hidden', 'true'); this.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + p + '"/></svg>'; }
  }
  if (!customElements.get('ax-icon')) customElements.define('ax-icon', Icon);

  /* Vistas de app: [data-ax-views] con disparadores [data-view="x"] (nav, rail) y paneles [data-view-panel="x"].
     Selección de lista: [data-ax-select] con filas [data-id] y detalles [data-detail="id"]. */
  function own(scope, sel, attr) { return [].slice.call(scope.querySelectorAll(sel)).filter(function (n) { return n.closest('[' + attr + ']') === scope; }); }
  function wireViews(scope) {
    var ts = own(scope, '[data-view]', 'data-ax-views'), ps = own(scope, '[data-view-panel]', 'data-ax-views');
    function sel(id) { ts.forEach(function (t) { t.setAttribute('aria-selected', t.dataset.view === id); }); ps.forEach(function (p) { p.hidden = p.dataset.viewPanel !== id; }); scope.querySelectorAll('[data-view-title]').forEach(function (el) { var t = ts.filter(function (x) { return x.dataset.view === id; })[0]; if (t) { var sp = t.querySelector('span'); el.textContent = t.getAttribute('data-label') || (sp ? sp.textContent : t.textContent).trim(); } }); }
    ts.forEach(function (t) { t.addEventListener('click', function () { sel(t.dataset.view); remember(scope, t.dataset.view); }); });
    var saved = remembered(scope), cur = ts.filter(function (t) { return saved !== undefined ? t.dataset.view === saved : t.getAttribute('aria-selected') === 'true'; })[0] || ts[0]; if (cur) sel(cur.dataset.view);
  }
  function wireSelect(scope) {
    var rows = own(scope, '[data-id]', 'data-ax-select'), ds = own(scope, '[data-detail]', 'data-ax-select');
    function sel(id) { rows.forEach(function (r) { r.setAttribute('aria-selected', r.dataset.id === id); }); ds.forEach(function (d) { d.hidden = d.dataset.detail !== id; }); scope.dispatchEvent(new CustomEvent('ax:select', { detail: { id: id }, bubbles: true })); }
    rows.forEach(function (r) { r.addEventListener('click', function () { sel(r.dataset.id); remember(scope, r.dataset.id); }); });
    var saved = remembered(scope), cur = rows.filter(function (r) { return saved !== undefined ? r.dataset.id === saved : r.getAttribute('aria-selected') === 'true'; })[0] || rows[0]; if (cur) sel(cur.dataset.id);
  }
  document.addEventListener('click', function (e) {
    var tg = e.target.closest && e.target.closest('[data-ax-toggle]'); if (!tg) return;
    var el = document.querySelector(tg.getAttribute('data-ax-toggle')); if (!el) return;
    el.toggleAttribute('data-collapsed'); tg.setAttribute('aria-pressed', !el.hasAttribute('data-collapsed'));
  });
  function bootApp() {
    if (root.clientWidth < 1180) document.querySelectorAll('.ax-app>.ax-aside').forEach(function (a) { a.setAttribute('data-collapsed', ''); document.querySelectorAll('[data-ax-toggle="#' + a.id + '"]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); });
    document.querySelectorAll('[data-ax-views]').forEach(wireViews); document.querySelectorAll('[data-ax-select]').forEach(wireSelect); post('surface', { surface: surface }); }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', bootApp) : bootApp();

  window.APX = Object.assign(window.APX || {}, {
    surface: surface, style: axStyle === 'aurora' ? 'aurora' : 'base', icons: Object.keys(IC),
    kit: '1.4.0', ask: ask, state: state, store: store, live: live, visible: shown, onVisible: onShown, db: db, fetch: apxFetch, setMode: setMode, toast: toast, refilter: function (el) { (el || document).querySelectorAll('[data-ax-filter]').forEach(function (s) { s._axApply ? s._axApply() : wireFilter(s); }); },
    fmt: fmt, esc: esc,
    onData: function (fn) { document.addEventListener('apx:data', function (e) { fn(e.detail); }); }
  });
})();

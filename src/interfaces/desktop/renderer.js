// APX Desktop renderer — vanilla port of the v2 floating-capsule design.
//
// The capsule is always visible (a Siri/Spotlight-style bar). When there is
// a conversation in flight (or any past turn) a glass card appears below it
// with the transcript, and a session bar below that. State machine:
//
//   idle          → input ready, mic button, no live wave
//   listening     → mic recording, capsule shows live wave + cancel/send
//   transcribing  → blob being decoded, status "Transcribiendo…"
//   thinking      → super-agent producing tokens, status "Pensando…"
//   speaking      → TTS playing back, status "Superagente está hablando…"
//
// MediaRecorder webm chunks are buffered and the CUMULATIVE blob is sent on
// every tick (live partial) and again on stop (authoritative) — single chunks
// lack the EBML header and are undecodable on their own.

(() => {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────
  let mode = "idle";              // idle | listening | transcribing | thinking | speaking
  let messages = [];              // [{id, role:'user'|'agent', text, t, via, dur?, audio?}]
  let nextId = 1;
  let pendingUserText = "";       // live partial during transcribing
  let isCancelled = false;

  let mediaRecorder = null;
  let audioStream = null;
  let recordedChunks = [];
  let recorderMime = "";
  let recorderFormat = "webm";
  let liveBusy = false;

  // Web Audio analyser — drives the live capsule wave from real mic amplitude
  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let waveRaf = null;

  let streamingAgentEntry = null; // { id, role:'agent', el, ... } during thinking/speaking
  let toolPillsByName = {};       // active tool pills inside the streaming bubble row
  let ttsAudio = null;            // <audio> playing the agent reply

  let history = [];               // [{role:'user'|'assistant', content}] sent to daemon for context
  let theme = "light";
  let position = "right";
  let agentName = "Superagente";  // overwritten from config on first render

  // Guard so a duplicate `done` event from the daemon never spawns a second
  // requestTts / second finalize on the same in-flight bubble.
  let doneHandled = false;
  let ttsTimer = null;

  // ── Inline SVG icons (mirrors the design's I.* set) ──────────────────────
  const SVG = (path, attrs = {}) => {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
    return `<svg ${a} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  };
  const ICON = {
    mic:    () => SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', { width: 18, height: 18, viewBox: "0 0 24 24" }),
    text:   () => SVG('<path d="M5 7h14M5 12h14M5 17h9"/>', { width: 17, height: 17, viewBox: "0 0 24 24" }),
    send:   () => SVG('<path d="M5 12h13M12 5l7 7-7 7"/>', { width: 18, height: 18, viewBox: "0 0 24 24" }),
    x:      () => SVG('<path d="M6 6l12 12M18 6L6 18"/>', { width: 17, height: 17, viewBox: "0 0 24 24", "stroke-width": "1.9" }),
    close:  () => SVG('<path d="M6 6l12 12M18 6L6 18"/>', { width: 15, height: 15, viewBox: "0 0 24 24" }),
    plus:   () => SVG('<path d="M12 5v14M5 12h14"/>', { width: 14, height: 14, viewBox: "0 0 24 24", "stroke-width": "1.9" }),
    person: () => SVG('<circle cx="12" cy="8" r="3.6"/><path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/>', { width: 12, height: 12, viewBox: "0 0 24 24" }),
    refresh:() => SVG('<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/>', { width: 13, height: 13, viewBox: "0 0 24 24", "stroke-width": "1.9" }),
    copy:   () => SVG('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>', { width: 13, height: 13, viewBox: "0 0 24 24" }),
    check:  () => SVG('<path d="M5 12l4.5 4.5L19 7"/>', { width: 13, height: 13, viewBox: "0 0 24 24", "stroke-width": "2" }),
    play:   () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.5-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z"/></svg>`,
    pause:  () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>`,
    stop:   () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>`,
  };

  // ── DOM scaffolding (built once) ─────────────────────────────────────────
  const $root = document.getElementById("root");
  const $connBadge = document.getElementById("conn-badge");

  $root.className = "float-root enter pos-right";
  $root.innerHTML = `
    <div class="cap" id="cap">
      <div class="cap-badge" id="cap-badge" style="display:none">
        <span class="g mic" id="badge-mic"></span>
        <span class="g txt" id="badge-txt"></span>
      </div>
      <div class="center" id="cap-center"></div>
      <div class="cap-actions" id="cap-actions"></div>
    </div>
    <div id="caption-slot"></div>
    <div id="conv-slot"></div>
    <div id="session-slot"></div>
  `;
  const $cap        = $root.querySelector("#cap");
  const $capBadge   = $root.querySelector("#cap-badge");
  const $badgeMic   = $root.querySelector("#badge-mic");
  const $badgeTxt   = $root.querySelector("#badge-txt");
  const $capCenter  = $root.querySelector("#cap-center");
  const $capActions = $root.querySelector("#cap-actions");
  const $captionSlot = $root.querySelector("#caption-slot");
  const $convSlot   = $root.querySelector("#conv-slot");
  const $sessionSlot = $root.querySelector("#session-slot");

  $badgeMic.innerHTML = ICON.mic();
  $badgeTxt.innerHTML = ICON.text();
  $capActions.style.cssText = "display:flex; align-items:center; gap:6px;";

  // ── Initial config from main (theme, position, shortcut, agent name) ─────
  Promise.all([
    window.apx?.getTheme?.()     ?? "light",
    window.apx?.getPosition?.()  ?? "right",
    window.apx?.getShortcut?.()  ?? "CommandOrControl+G",
    window.apx?.getAgentName?.() ?? "Superagente",
  ]).then(([th, pos, shortcut, name]) => {
    theme = th || "light";
    position = pos || "right";
    agentName = (name && String(name).trim()) || "Superagente";
    document.documentElement.setAttribute("data-theme", theme);
    setPosition(position);
    initialCaption(shortcut);
    // Re-render so the placeholder ("Hablá o escribí a <name>…") picks up
    // the resolved agent name on first paint.
    render();
  }).catch(() => {
    document.documentElement.setAttribute("data-theme", "light");
    setPosition("right");
    initialCaption("CommandOrControl+G");
  });

  function setPosition(p) {
    $root.classList.remove("pos-left", "pos-center", "pos-right");
    $root.classList.add("pos-" + p);
  }

  function formatShortcut(s) {
    if (!s) return "⌘G";
    const isMac = (window.apx?.platform || (navigator.platform || "").toLowerCase()).indexOf("mac") >= 0
      || (window.apx?.platform === "darwin");
    return s
      .replace("CommandOrControl", isMac ? "⌘" : "Ctrl")
      .replace("Command", "⌘")
      .replace("Control", "Ctrl")
      .replace("Shift", "⇧")
      .replace("Option", "⌥")
      .replace("Alt", "⌥")
      .replace(/\+/g, "");
  }

  function initialCaption(shortcut) {
    const sc = formatShortcut(shortcut);
    $captionSlot.innerHTML = `
      <div class="caption">Mantené <span class="kbd">${sc}</span> para hablar
        <span class="kbd">⌥ /</span> para escribir</div>
    `;
  }

  // ── Render: capsule center + actions vary by mode ────────────────────────
  //
  // CRITICAL: the idle <input> must NOT be re-created on every keystroke,
  // or it loses focus. We keep the input element across re-renders and only
  // tear it down when mode changes. Badge + right-side actions rebuild
  // freely (they have no focus state to preserve).
  function render() {
    $cap.classList.toggle("listening", mode === "listening");
    $cap.classList.toggle("busy", mode === "transcribing" || mode === "thinking" || mode === "speaking");
    const existingInput = $capCenter.querySelector("input");
    const currentInputText = existingInput ? existingInput.value : "";

    // badge visibility: shown while typing or listening
    const typing = mode === "idle" && currentInputText.trim() !== "";
    const showBadge = typing || mode === "listening";
    $capBadge.style.display = showBadge ? "" : "none";
    if (showBadge) {
      $badgeMic.classList.toggle("show", !typing);
      $badgeMic.classList.toggle("hide", typing);
      $badgeTxt.classList.toggle("show", typing);
      $badgeTxt.classList.toggle("hide", !typing);
    }

    // center — only rebuild when there's a real change
    if (mode === "idle") {
      if (!existingInput) {
        // Mode just transitioned to idle (or first render). Create the input
        // once; subsequent renders will hit the `existingInput` branch and
        // leave focus/selection alone.
        $capCenter.innerHTML = "";
        const el = document.createElement("input");
        el.type = "text";
        el.placeholder = `Hablá o escribí a ${agentName}…`;
        el.addEventListener("input", () => render());
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && el.value.trim()) {
            const text = el.value.trim();
            el.value = "";
            sendText(text);
          }
        });
        $capCenter.appendChild(el);
        if (window._focusOnNext) {
          window._focusOnNext = false;
          setTimeout(() => el.focus(), 30);
        }
      }
      // else: input already there → leave it alone (preserves focus + caret)
    } else if (mode === "listening") {
      // Only rebuild the wave if it's not already there (avoids restarting
      // CSS animations / Web Audio binding every render).
      let wave = $capCenter.querySelector(".cap-wave");
      if (!wave) {
        $capCenter.innerHTML = "";
        wave = document.createElement("div");
        wave.className = "cap-wave reactive";  // JS drives the bar heights from analyser
        for (let i = 0; i < 26; i++) {
          const b = document.createElement("i");
          b.style.height = "4px";
          wave.appendChild(b);
        }
        $capCenter.appendChild(wave);
      }
    } else if (mode === "transcribing" || mode === "thinking" || mode === "speaking") {
      // Only swap innerHTML when the rendered mode actually changes — keeps
      // the shimmer/dots animations from restarting on every render() call.
      if ($capCenter.dataset.mode !== mode) {
        $capCenter.dataset.mode = mode;
        if (mode === "transcribing") {
          $capCenter.innerHTML = `<span class="status"><span class="dots"><i></i><i></i><i></i></span><span class="shimmer">Transcribiendo…</span></span>`;
        } else if (mode === "thinking") {
          $capCenter.innerHTML = `<span class="status"><span class="dots"><i></i><i></i><i></i></span><span class="shimmer">Pensando…</span></span>`;
        } else if (mode === "speaking") {
          $capCenter.innerHTML = `<span class="status"><img class="sa-glyph" src="assets/superagent.png" alt=""/><span class="shimmer">${escapeHtml(agentName)} está hablando…</span></span>`;
        }
      }
    }
    // Clear data-mode when we're back to idle/listening so a future busy mode
    // re-renders correctly.
    if (mode === "idle" || mode === "listening") $capCenter.dataset.mode = "";

    // actions
    $capActions.innerHTML = "";
    const addBtn = (cls, label, icon, onClick) => {
      const b = document.createElement("button");
      b.className = "act" + (cls ? " " + cls : "");
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = icon;
      b.addEventListener("click", onClick);
      $capActions.appendChild(b);
      return b;
    };
    if (mode === "idle") {
      if (currentInputText.trim()) {
        addBtn("", "Enviar", ICON.send(), () => {
          const text = $capCenter.querySelector("input")?.value.trim();
          if (text) { $capCenter.querySelector("input").value = ""; sendText(text); }
        });
      } else {
        addBtn("", "Hablar", ICON.mic(), () => startListening());
      }
    } else if (mode === "listening") {
      addBtn("ghost", "Cancelar", ICON.x(), () => cancel());
      addBtn("", "Enviar", ICON.send(), () => stopListening(/* commit */ true));
    } else if (mode === "transcribing") {
      addBtn("ghost", "Cancelar", ICON.x(), () => cancel());
    } else if (mode === "thinking") {
      addBtn("ghost", "Cancelar", ICON.x(), () => cancel());
    } else if (mode === "speaking") {
      addBtn("ghost", "Detener", ICON.stop(), () => stopSpeaking());
    }

    // caption visible only when idle AND no messages yet
    $captionSlot.style.display = (mode === "idle" && messages.length === 0) ? "" : "none";

    // session bar visible when there are messages
    if (messages.length > 0 || mode !== "idle") {
      renderSessionBar();
    } else {
      $sessionSlot.innerHTML = "";
    }

    // conv card visible when there's any content
    const wantConv = messages.length > 0 || mode === "transcribing" || mode === "thinking" || mode === "speaking";
    if (wantConv) ensureConv();
    else $convSlot.innerHTML = "";

    requestWindowResize();
  }

  function renderSessionBar() {
    if ($sessionSlot.querySelector(".session-bar")) return; // keep DOM stable
    $sessionSlot.innerHTML = `
      <div class="session-bar">
        <button class="sbtn new" id="btn-new"><span class="ic">${ICON.plus()}</span> Nueva sesión</button>
        <button class="sbtn close" id="btn-close"><span class="ic">${ICON.close()}</span> Cerrar</button>
      </div>
    `;
    $sessionSlot.querySelector("#btn-new").addEventListener("click", newSession);
    $sessionSlot.querySelector("#btn-close").addEventListener("click", closeWindow);
  }

  // ── Conversation card ────────────────────────────────────────────────────
  let $convScroll = null;
  function ensureConv() {
    if (!$convSlot.firstChild) {
      $convSlot.innerHTML = `<div class="conv"><div class="conv-scroll" id="conv-scroll"></div></div>`;
      $convScroll = $convSlot.querySelector("#conv-scroll");
      // Re-render all existing turns
      messages.forEach((m, i) => appendTurn(m, i === messages.length - 1));
      if (mode === "transcribing") renderPendingUserPartial();
      if (mode === "thinking" || mode === "speaking") ensureStreamingAgentBubble();
    }
  }

  function appendTurn(m, isLast) {
    if (!$convScroll) return;
    const t = document.createElement("div");
    t.className = "turn" + (isLast ? " last" : "");
    t.dataset.id = m.id;
    if (m.role === "user") {
      const viaIcon = m.via === "voice" ? `<span class="via-mic" title="Mensaje de voz">${ICON.mic()}</span>` : "";
      t.innerHTML = `
        <div class="role user">
          <span class="ava">${ICON.person()}</span>
          <span class="who">Vos</span>
          <span class="time">${m.t}</span>
        </div>
        <div class="bubble-user">${escapeHtml(m.text)}${viaIcon}</div>
      `;
    } else {
      t.innerHTML = `
        <div class="role agent">
          <span class="ava sa"><img src="assets/superagent.png" alt=""/></span>
          <span class="who">${escapeHtml(agentName)}</span>
          <span class="time">${m.t || ""}</span>
        </div>
        <div class="msg-agent">${formatWordsHtml(m.text)}</div>
        ${m.audio ? "" /* scrubber added separately */ : ""}
        <div class="turn-actions">
          <button class="chip btn-regen">${ICON.refresh()} Regenerar</button>
          <button class="chip btn-copy">${ICON.copy()} Copiar</button>
        </div>
      `;
      if (m.audio && m.dur) {
        // Insert scrubber before turn-actions
        const scrubberHtml = buildScrubberHtml(m);
        const actions = t.querySelector(".turn-actions");
        actions.insertAdjacentHTML("beforebegin", scrubberHtml);
        wireScrubber(t, m);
      }
      // copy
      t.querySelector(".btn-copy")?.addEventListener("click", (e) => {
        navigator.clipboard?.writeText(m.text).catch(() => {});
        const btn = e.currentTarget;
        btn.classList.add("done");
        btn.innerHTML = `${ICON.check()} Copiado`;
        setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = `${ICON.copy()} Copiar`; }, 1400);
      });
      // regen: ask the daemon to retry the last user turn
      t.querySelector(".btn-regen")?.addEventListener("click", () => {
        const lastUser = [...messages].reverse().find((x) => x.role === "user");
        if (!lastUser) return;
        // drop this agent message and re-send
        messages = messages.filter((x) => x.id !== m.id);
        rebuildConvFromState();
        sendToDaemon(lastUser.text);
      });
    }
    $convScroll.appendChild(t);
    scrollConvToBottom();
  }

  function rebuildConvFromState() {
    if (!$convScroll) return;
    $convScroll.innerHTML = "";
    streamingAgentEntry = null;
    toolPillsByName = {};
    messages.forEach((m, i) => appendTurn(m, i === messages.length - 1));
  }

  function renderPendingUserPartial() {
    if (!$convScroll) return;
    const existing = $convScroll.querySelector("[data-pending='user']");
    if (existing) {
      const bub = existing.querySelector(".bubble-user");
      bub.innerHTML = `${escapeHtml(pendingUserText)}<span class="caret"></span>`;
      return;
    }
    const t = document.createElement("div");
    t.className = "turn last";
    t.dataset.pending = "user";
    t.innerHTML = `
      <div class="role user">
        <span class="ava">${ICON.person()}</span>
        <span class="who">Vos</span>
        <span class="time">${nowHHMM()}</span>
      </div>
      <div class="bubble-user">${escapeHtml(pendingUserText)}<span class="caret"></span></div>
    `;
    $convScroll.appendChild(t);
    scrollConvToBottom();
  }
  function removePendingUserPartial() {
    $convScroll?.querySelector("[data-pending='user']")?.remove();
  }

  function ensureStreamingAgentBubble() {
    if (!$convScroll) return;
    if (streamingAgentEntry?.el && document.body.contains(streamingAgentEntry.el)) return;
    const id = nextId++;
    const t = document.createElement("div");
    t.className = "turn last";
    t.dataset.id = id;
    // Placeholder while we wait for the first token: just the dots — the
    // word "Pensando" already appears in the capsule, no need to repeat it
    // inside the bubble. See feedback on doble-"Pensando" in 2026-05-30.
    t.innerHTML = `
      <div class="role agent">
        <span class="ava sa"><img src="assets/superagent.png" alt=""/></span>
        <span class="who">${escapeHtml(agentName)}</span>
      </div>
      <div class="msg-agent">
        <span class="status-line"><span class="dots"><i></i><i></i><i></i></span></span>
      </div>
    `;
    $convScroll.appendChild(t);
    streamingAgentEntry = { id, el: t, msgEl: t.querySelector(".msg-agent"), text: "", started: false };
    scrollConvToBottom();
  }

  function appendStreamingToken(chunk) {
    ensureStreamingAgentBubble();
    if (!streamingAgentEntry.started) {
      streamingAgentEntry.started = true;
      streamingAgentEntry.msgEl.innerHTML = ""; // clear the dots placeholder
    }
    streamingAgentEntry.text += chunk;
    // Re-render with the word-in animation: split into spans on word boundaries.
    streamingAgentEntry.msgEl.innerHTML = formatWordsHtml(streamingAgentEntry.text) + `<span class="caret"></span>`;
    scrollConvToBottom();
  }

  function finalizeStreamingAgent({ audio, dur } = {}) {
    if (!streamingAgentEntry) return;
    const m = {
      id: streamingAgentEntry.id,
      role: "agent",
      text: streamingAgentEntry.text || "",
      t: nowHHMM(),
      audio: audio || null,
      dur: dur || null,
      fresh: true,
    };
    messages.push(m);
    history.push({ role: "assistant", content: m.text });
    // Replace the streaming placeholder with the finished turn
    streamingAgentEntry.el.remove();
    streamingAgentEntry = null;
    appendTurn(m, true);
  }

  function addToolPill(name) {
    ensureStreamingAgentBubble();
    if (toolPillsByName[name]) return;
    const pill = document.createElement("div");
    pill.className = "tool-pill";
    pill.innerHTML = `<div class="spinner"></div><span>${escapeHtml(name)}</span>`;
    $convScroll.insertBefore(pill, streamingAgentEntry.el);
    toolPillsByName[name] = pill;
    scrollConvToBottom();
  }
  function updateToolPill(name) {
    const pill = toolPillsByName[name];
    if (!pill) return;
    pill.innerHTML = `<span class="check">✓</span><span>${escapeHtml(name)}</span>`;
  }

  // ── Audio scrubber ───────────────────────────────────────────────────────
  function buildScrubberHtml(m) {
    const N = 38;
    const bars = waveShape(N, 13);
    const dur = m.dur || 0;
    const fmt = (s) => `0:${String(Math.round(s)).padStart(2, "0")}`;
    return `
      <div class="audio" data-bars="${N}">
        <button class="play" aria-label="Reproducir respuesta">${ICON.play()}</button>
        <div class="wavebar">
          ${bars.map((h) => `<i style="height:${Math.round(h * 24)}px"></i>`).join("")}
        </div>
        <span class="dur">${fmt(dur)}</span>
      </div>
    `;
  }
  function wireScrubber(turnEl, m) {
    const N = 38;
    const audioEl = turnEl.querySelector(".audio");
    if (!audioEl || !m.audio) return;
    const $play = audioEl.querySelector(".play");
    const $bar  = audioEl.querySelector(".wavebar");
    const bars  = $bar.querySelectorAll("i");
    const $dur  = audioEl.querySelector(".dur");
    const dur   = m.dur || 1;
    const fmt   = (s) => `0:${String(Math.round(s)).padStart(2, "0")}`;
    const audio = new Audio(m.audio);
    let raf = null;
    let progress = 0;

    const setProgress = (p) => {
      progress = Math.max(0, Math.min(1, p));
      const cur = Math.floor(progress * N);
      bars.forEach((b, i) => {
        b.classList.toggle("on", i <= cur);
        b.classList.toggle("cur", i === cur && !audio.paused);
      });
      $dur.textContent = progress > 0 || !audio.paused ? fmt(progress * dur) : fmt(dur);
    };

    const tick = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
      raf = requestAnimationFrame(tick);
    };
    audio.addEventListener("play",   () => { $play.innerHTML = ICON.pause(); raf = requestAnimationFrame(tick); mode = "speaking"; render(); });
    audio.addEventListener("pause",  () => { $play.innerHTML = ICON.play();  if (raf) cancelAnimationFrame(raf); if (mode === "speaking") { mode = "idle"; render(); } });
    audio.addEventListener("ended",  () => { setProgress(1); if (mode === "speaking") { mode = "idle"; render(); } });

    $play.addEventListener("click", () => audio.paused ? audio.play() : audio.pause());
    $bar.addEventListener("click", (e) => {
      const r = $bar.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (audio.duration > 0) audio.currentTime = p * audio.duration;
      setProgress(p);
    });

    // If the audio errors out (404, decode error, autoplay block, etc) make
    // sure the capsule doesn't stay stuck in "está hablando…".
    audio.addEventListener("error", () => {
      if (mode === "speaking") { mode = "idle"; render(); }
    });

    // autoplay if it's the fresh reply
    if (m.fresh) {
      m.fresh = false;
      ttsAudio?.pause?.();
      ttsAudio = audio;
      audio.play().catch(() => {
        // Autoplay block (rare in Electron with user-gesture but possible
        // when the window has never been focused). Bail out so the capsule
        // returns to idle and the user can still tap "play" on the scrubber.
        if (mode === "speaking" || mode === "thinking") { mode = "idle"; render(); }
      });
    }
  }

  function waveShape(n, seed = 7) {
    const out = []; let s = seed;
    for (let i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      const env = Math.sin((i / n) * Math.PI);
      out.push(0.25 + (0.35 + r * 0.65) * (0.55 + env * 0.6));
    }
    return out;
  }

  // ── Recording flow ───────────────────────────────────────────────────────
  function startListening() {
    if (mode !== "idle") return;
    isCancelled = false;
    mode = "listening";
    render();
    startMic();
  }

  // commit=true → stop and send the recording; false → cancel
  function stopListening(commit) {
    if (mode !== "listening") return;
    isCancelled = !commit;
    if (!commit) {
      mode = "idle";
      stopMic();
      render();
      return;
    }
    mode = "transcribing";
    render();
    stopMic(); // onstop will resolve, send to daemon
  }

  function cancel() {
    isCancelled = true;
    if (mode === "listening") { stopMic(); }
    if (mode === "thinking" || mode === "speaking") { window.apx?.cancel?.(); }
    removePendingUserPartial();
    if (streamingAgentEntry) {
      streamingAgentEntry.el.remove();
      streamingAgentEntry = null;
    }
    mode = "idle";
    render();
  }

  function stopSpeaking() {
    try { ttsAudio?.pause?.(); } catch {}
    if (mode === "speaking") { mode = "idle"; render(); }
  }

  // ── Mic capture (buffer chunks, cumulative blob = always has header) ─────
  async function startMic() {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Web Audio analyser → real-time amplitude for the capsule wave.
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(audioStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;                       // → 64 frequency bins
        analyser.smoothingTimeConstant = 0.72;        // analyser-side temporal smoothing
        analyser.minDecibels = -85;                   // floor (silence)
        analyser.maxDecibels = -15;                   // ceiling (loud speech)
        src.connect(analyser);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        startWaveLoop();
      } catch (e) {
        console.warn("desktop renderer: AnalyserNode init failed", e);
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/ogg;codecs=opus";
      recorderFormat = mimeType.includes("webm") ? "webm" : "ogg";
      recorderMime   = mimeType;
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(audioStream, { mimeType, audioBitsPerSecond: 32000 });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        runLivePartial();
      };
      mediaRecorder.onstop = async () => {
        if (isCancelled) { recordedChunks = []; if (mode !== "idle") { mode = "idle"; render(); } return; }
        const raw = await transcribeBuffered();
        const text = (raw || "").trim();
        recordedChunks = [];
        // Guard with .trim() — whisper occasionally returns a single space or
        // newline for very short clips, which used to commit an empty bubble.
        if (!text || isCancelled) {
          mode = "idle";
          pendingUserText = "";
          removePendingUserPartial();
          render();
          return;
        }
        pendingUserText = text;
        commitUserMessage(text, /* via */ "voice");
      };
      mediaRecorder.start(2000);
    } catch (e) {
      console.error("desktop renderer: mic error", e);
      mode = "idle";
      render();
    }
  }
  function stopMic() {
    try { mediaRecorder?.stop(); } catch {}
    try { audioStream?.getTracks().forEach((t) => t.stop()); } catch {}
    mediaRecorder = null;
    audioStream = null;
    stopWaveLoop();
    try { audioCtx?.close(); } catch {}
    audioCtx = null;
    analyser = null;
    freqData = null;
  }

  // ── Reactive wave: amplitude-driven bar heights (runs while mode === listening)
  function startWaveLoop() {
    stopWaveLoop();
    // Per-bar smoothed amplitude so heights don't twitch frame-to-frame.
    let smoothed = null;
    const tick = () => {
      if (mode !== "listening" || !analyser) { waveRaf = null; return; }
      analyser.getByteFrequencyData(freqData);
      const wave = $capCenter.querySelector(".cap-wave");
      if (wave) {
        const bars = wave.children;
        const n = bars.length;
        if (!smoothed || smoothed.length !== n) smoothed = new Float32Array(n);
        // Only use the lower ~60% of the spectrum — voice energy lives there;
        // upper bins are mostly noise hiss that would make bars jiggle uselessly.
        const usable = Math.floor(freqData.length * 0.6);
        const binsPerBar = Math.max(1, Math.floor(usable / n));
        for (let i = 0; i < n; i++) {
          let sum = 0;
          const start = i * binsPerBar;
          const end = Math.min(start + binsPerBar, usable);
          for (let j = start; j < end; j++) sum += freqData[j];
          const raw = sum / Math.max(1, (end - start)) / 255;   // 0..1
          // ease curve — small inputs stay small, loud inputs reach ~1
          const v = Math.pow(raw, 0.65);
          // exponential smoothing: snappy attack, slower decay (feels punchier)
          const k = v > smoothed[i] ? 0.55 : 0.18;
          smoothed[i] = smoothed[i] + (v - smoothed[i]) * k;
          // map to height: 3px floor (silence) → 28px peak
          const h = 3 + smoothed[i] * 25;
          bars[i].style.height = h.toFixed(1) + "px";
        }
      }
      waveRaf = requestAnimationFrame(tick);
    };
    waveRaf = requestAnimationFrame(tick);
  }
  function stopWaveLoop() {
    if (waveRaf != null) cancelAnimationFrame(waveRaf);
    waveRaf = null;
  }
  async function transcribeBuffered() {
    if (!recordedChunks.length) return "";
    const blob = new Blob(recordedChunks, { type: recorderMime });
    const buf  = await blob.arrayBuffer();
    try {
      const r = await window.apx.transcribeChunk(buf, recorderFormat, "auto");
      if (r?.ok && r.text?.trim()) return r.text.trim();
    } catch {}
    return "";
  }
  async function runLivePartial() {
    if (liveBusy || mode !== "listening" || !recordedChunks.length) return;
    liveBusy = true;
    try {
      const text = await transcribeBuffered();
      if (text && mode === "listening") {
        pendingUserText = text;
        // No visible live preview in the capsule wave mode; update is mostly
        // useful for the conv pending-user partial during transcribing.
      }
    } finally { liveBusy = false; }
  }

  // ── Send: text path + post-transcription commit path ─────────────────────
  function sendText(text) {
    const t = (text || "").trim();
    if (!t) return;
    commitUserMessage(t, /* via */ "text");
  }
  function commitUserMessage(text, via) {
    const clean = (text || "").trim();
    if (!clean) { console.warn("desktop renderer: refused to commit empty user message"); return; }
    const m = { id: nextId++, role: "user", text: clean, t: nowHHMM(), via };
    // Reset per-turn flags so the next streaming agent reply starts fresh.
    doneHandled = false;
    if (ttsTimer) { clearTimeout(ttsTimer); ttsTimer = null; }
    messages.push(m);
    history.push({ role: "user", content: clean });
    pendingUserText = "";
    removePendingUserPartial();
    ensureConv();
    appendTurn(m, true);
    mode = "thinking";
    render();
    ensureStreamingAgentBubble();
    sendToDaemon(clean);
  }

  function sendToDaemon(text) {
    const prev = history.slice(0, -1).slice(-20);
    window.apx?.sendMessage?.(text, prev).catch?.((e) => {
      finalizeStreamingAgentError(e?.message || String(e));
    });
  }

  function finalizeStreamingAgentError(message) {
    if (!streamingAgentEntry) ensureStreamingAgentBubble();
    streamingAgentEntry.text = "Error: " + message;
    streamingAgentEntry.msgEl.innerHTML = `<span style="color:oklch(0.6 0.2 22)">${escapeHtml(streamingAgentEntry.text)}</span>`;
    finalizeStreamingAgent();
    mode = "idle"; render();
  }

  function newSession() {
    cancel();
    messages = [];
    history = [];
    streamingAgentEntry = null;
    toolPillsByName = {};
    pendingUserText = "";
    $convSlot.innerHTML = "";
    $sessionSlot.innerHTML = "";
    mode = "idle";
    render();
  }
  function closeWindow() { window.apx?.close?.(); }

  // ── Daemon event router ──────────────────────────────────────────────────
  window.apx?.onDaemonEvent?.((msg) => {
    switch (msg.type) {
      case "thinking":
        if (mode !== "thinking" && mode !== "speaking") { mode = "thinking"; render(); }
        ensureStreamingAgentBubble();
        break;
      case "token":
        appendStreamingToken(msg.text || "");
        break;
      case "tool_start":  addToolPill(msg.name); break;
      case "tool_done":   updateToolPill(msg.name); break;
      case "done": {
        // Daemon may emit `done` twice (retry/race). Process only once per turn.
        if (doneHandled) break;
        doneHandled = true;
        const finalText = msg.text || streamingAgentEntry?.text || "";
        if (streamingAgentEntry) streamingAgentEntry.text = finalText;
        // Ask main for TTS; if no answer arrives within 6s, give up so the
        // capsule never stays stuck in "Pensando…" / "está hablando…".
        const handled = window.apx?.requestTts?.(finalText);
        if (handled) {
          if (ttsTimer) clearTimeout(ttsTimer);
          ttsTimer = setTimeout(() => {
            if (!streamingAgentEntry) return;
            console.warn("desktop renderer: TTS timed out — finalizing without audio");
            finalizeStreamingAgent();
            mode = "idle"; render();
          }, 6000);
        } else {
          finalizeStreamingAgent();
          mode = "idle"; render();
        }
        break;
      }
      case "tts-ready": {
        if (ttsTimer) { clearTimeout(ttsTimer); ttsTimer = null; }
        finalizeStreamingAgent({ audio: msg.url, dur: msg.duration });
        // mode stays "thinking" until the <audio> actually plays — the
        // scrubber's `play` event flips us to "speaking". If autoplay is
        // blocked, the audio.error handler in wireScrubber returns to idle.
        mode = "thinking"; render();
        break;
      }
      case "tts-failed":
        if (ttsTimer) { clearTimeout(ttsTimer); ttsTimer = null; }
        finalizeStreamingAgent();
        mode = "idle"; render();
        break;
      case "error":
        finalizeStreamingAgentError(msg.message || "Unknown error");
        break;
      case "cancelled":
        if (streamingAgentEntry) {
          if (!streamingAgentEntry.text) streamingAgentEntry.el.remove();
          else finalizeStreamingAgent();
          streamingAgentEntry = null;
        }
        mode = "idle"; render();
        break;
    }
  });

  window.apx?.onDaemonConnected?.(()    => $connBadge.classList.remove("show"));
  window.apx?.onDaemonDisconnected?.(() => $connBadge.classList.add("show"));

  // ── Main-process IPC: recording-start/stop (global hotkey), focus-input ──
  window.apx?.onRecordingStart?.(() => { if (mode === "idle") startListening(); });
  window.apx?.onRecordingStop?.(()  => { if (mode === "listening") stopListening(true); });
  window.apx?.onFocusInput?.(() => {
    if (mode !== "idle") return;
    window._focusOnNext = true;
    render();
  });

  // ── Keyboard ─────────────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "listening" || mode === "transcribing" || mode === "thinking" || mode === "speaking") cancel();
      else closeWindow();
    }
  });

  // ── Window-size hint to main (collapse to capsule when empty) ────────────
  // ResizeObserver fires whenever the rendered height of #root changes —
  // more reliable than a setTimeout poll (used to under-report by one frame
  // and clip the session bar). 24px bottom padding so the buttons breathe.
  let lastH = 0;
  function requestWindowResize() {
    if (!$root) return;
    const h = Math.ceil($root.getBoundingClientRect().height) + 24;
    if (h !== lastH) {
      lastH = h;
      window.apx?.resize?.(h);
    }
  }
  try {
    const ro = new ResizeObserver(() => requestWindowResize());
    ro.observe($root);
  } catch {
    // Older runtimes without ResizeObserver: fall back to a 250ms poll.
    setInterval(requestWindowResize, 250);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function nowHHMM() {
    const d = new Date();
    return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Wrap each word in a span.w so wordIn animates fresh tokens
  function formatWordsHtml(text) {
    const escaped = escapeHtml(text);
    // Split on spaces but keep newlines as <br>
    return escaped
      .split("\n")
      .map((line) => line.split(/(\s+)/).map((tok) => tok.match(/^\s+$/) ? tok : `<span class="w">${tok}</span>`).join(""))
      .join("<br>");
  }
  function scrollConvToBottom() {
    if (!$convScroll) return;
    requestAnimationFrame(() => { $convScroll.scrollTop = $convScroll.scrollHeight; });
  }

  // ── First paint ──────────────────────────────────────────────────────────
  render();
})();

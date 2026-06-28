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

  // Mic is async to open (getUserMedia + recorder warm-up). Until it's actually
  // capturing we show a "Cargando…" state instead of the wave, so the user
  // doesn't talk into the dead gap before the recorder starts.
  let micReady = false;

  // Dead-mic detection: track the loudest RMS seen this session. If it stays
  // near zero for DEAD_MIC_MS the stream is silent (no permission / muted /
  // wrong device) and we surface a notice instead of hanging in "listening".
  let listenStartTs = 0;
  let micPeakRms = 0;
  const DEAD_MIC_MS = 3500;
  const DEAD_MIC_RMS = 0.004;

  // Silence auto-send: once speech has been heard, SILENCE_MS of quiet
  // auto-commits the recording. RMS (time-domain) is the voice/silence gate.
  // Both are overridable from config.json (desktop.silence_ms / voice_rms).
  let speechSeen = false;
  let lastVoiceTs = 0;
  let SILENCE_MS = 1200;        // quiet after speech → send on its own
  let VOICE_RMS  = 0.025;       // RMS above this counts as voice (0 = silence)
  const PAUSE_PREVIEW_MS = 600; // a short pause kicks ONE decode (reused on send)

  // When a pause triggers a preview decode, that decode already covers all the
  // speech (the tail is just trailing silence), so the auto-send reuses it
  // instead of paying a second full decode. These coordinate that handoff.
  let pausePreviewed = false;   // a preview decode fired for the current pause
  let reuseLiveOnStop = false;  // commit should reuse pendingUserText, not re-decode
  let livePromise = null;       // in-flight preview decode (awaited on reuse)

  // Web Audio analyser — drives the live capsule wave from real mic amplitude
  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let timeData = null;
  let waveRaf = null;

  let streamingAgentEntry = null; // legacy single-bubble streaming (kept dormant)
  let toolPillsByName = {};       // active tool pills, by tool name, for the live turn
  let ttsAudio = null;            // <audio> currently playing

  // ── Per-segment turn rendering ──────────────────────────────────────────
  // A turn is now N agent message bubbles (intro, post-tool answer, …), each
  // with its own audio. `currentTurn` tags every bubble of a turn so regen can
  // drop the whole turn. The audio queue plays segment audios in seq order
  // (gapless auto-play), waiting at the cursor for each segment's TTS to land.
  let currentTurn = 0;
  let turnAudios = [];            // [{ m, ready, failed, played }] ordered by seq
  let audioCursor = 0;            // index of the next segment to play
  let queuePlaying = false;       // a segment audio is currently playing
  let turnDone = false;           // `done` received for the active turn
  let turnWatchdog = null;        // flushes the queue if a segment's TTS hangs

  let history = [];               // [{role:'user'|'assistant', content}] sent to daemon for context
  let theme = "light";
  let position = "right";
  let agentName = "Superagente";  // overwritten from config on first render

  // Guard so a duplicate `done` event from the daemon never spawns a second
  // requestTts / second finalize on the same in-flight bubble.
  let doneHandled = false;
  let ttsTimer = null;
  // Which agent turn (by message id) is waiting for its TTS audio to attach.
  // We finalize the bubble immediately on `done`, then post-attach the
  // scrubber when (or if) tts-ready arrives.
  let pendingTtsTurnId = null;

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
  // Don't render() before this resolves — otherwise the first paint creates
  // the input with the default "Hablá o escribí a Superagente…" placeholder
  // and the render() guard ("if (!existingInput)") never recreates it, so
  // the agent name stays wrong until the user changes mode.
  let configReady = false;
  Promise.all([
    window.apx?.getTheme?.()     ?? "light",
    window.apx?.getPosition?.()  ?? "right",
    window.apx?.getShortcut?.()  ?? "CommandOrControl+G",
    window.apx?.getAgentName?.() ?? "Superagente",
    window.apx?.getVoiceTiming?.() ?? null,
  ]).then(([th, pos, shortcut, name, timing]) => {
    theme = th || "light";
    position = pos || "right";
    agentName = (name && String(name).trim()) || "Superagente";
    if (timing) {
      if (typeof timing.silence_ms === "number") SILENCE_MS = timing.silence_ms;
      if (typeof timing.voice_rms === "number")  VOICE_RMS  = timing.voice_rms;
    }
    document.documentElement.setAttribute("data-theme", theme);
    setPosition(position);
    initialCaption(shortcut);
    configReady = true;
    // If render() already fired the bootstrap paint (because the IPC was
    // slow), the existing input has the stale placeholder. Patch it in
    // place so the user sees the real agent name on the very first frame
    // they can interact with.
    const input = $capCenter.querySelector("input");
    if (input) input.placeholder = `Hablá o escribí a ${agentName}…`;
    render();
  }).catch(() => {
    document.documentElement.setAttribute("data-theme", "light");
    setPosition("right");
    initialCaption("CommandOrControl+G");
    configReady = true;
    render();
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
    // Empty-idle state has no other affordance to dismiss the floating window
    // (the session bar's "Cerrar" only shows once a conversation exists, and
    // the window doesn't auto-hide on blur). Pair the hint with a translucent
    // "Cerrar ventana" pill in the same glass language so the user can always
    // close it without hunting for the tray icon.
    $captionSlot.innerHTML = `
      <div class="caption">Mantené <span class="kbd">${sc}</span> para hablar
        <span class="kbd">⌥ /</span> para escribir</div>
      <button class="cap-pill" id="btn-close-idle" title="Cerrar ventana">${ICON.close()}<span>Cerrar ventana</span></button>
    `;
    $captionSlot.querySelector("#btn-close-idle")?.addEventListener("click", closeWindow);
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
    } else if (mode === "listening" && !micReady) {
      // Mic still opening (getUserMedia + recorder warm-up). Show a loading
      // status so the user waits for capture instead of talking into the gap.
      if ($capCenter.dataset.mode !== "loading") {
        $capCenter.dataset.mode = "loading";
        $capCenter.innerHTML = `<span class="status"><span class="dots"><i></i><i></i><i></i></span><span class="shimmer">Cargando…</span></span>`;
      }
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
    // Clear data-mode when we're back to idle, or once the live wave is up, so
    // a future busy mode re-renders correctly. While the mic is still warming
    // up we keep the "loading" marker so "Cargando…" isn't rebuilt every frame.
    if (mode === "idle" || (mode === "listening" && micReady)) $capCenter.dataset.mode = "";

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
      // No "Enviar" until the recorder is live — nothing to send mid-warm-up.
      if (micReady) addBtn("", "Enviar", ICON.send(), () => stopListening(/* commit */ true));
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
    }
  }

  function appendTurn(m, isLast) {
    if (!$convScroll) return;
    if (isLast) clearLastClass();
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
      // Consecutive agent messages (intro + post-tool answer …) read as one
      // continued reply: only the FIRST shows the "Roby" header — the rest skip
      // it so a tool turn isn't a stack of repeated "Roby" labels. A new header
      // only appears when something (a user message) breaks the run.
      const idx = messages.indexOf(m);
      const prevMsg = idx > 0 ? messages[idx - 1] : null;
      const agentCont = !!(prevMsg && prevMsg.role === "agent");
      if (agentCont) t.classList.add("cont");
      const header = agentCont ? "" : `
        <div class="role agent">
          <span class="ava sa"><img src="assets/superagent.png" alt=""/></span>
          <span class="who">${escapeHtml(agentName)}</span>
          <span class="time">${m.t || ""}</span>
        </div>`;
      // Copy is an inline icon at the end of the text, hover-only, so it never
      // reserves an empty row. Regenerate lives in turn-actions and CSS shows it
      // only on the last turn.
      t.innerHTML = `
        ${header}
        <div class="msg-agent">${formatWordsHtml(m.text)}<button class="btn-copy" aria-label="Copiar" title="Copiar">${ICON.copy()}</button></div>
        <div class="turn-actions">
          <button class="chip btn-regen">${ICON.refresh()} Regenerar</button>
        </div>
      `;
      if (m.audio && m.dur) {
        // Insert scrubber before turn-actions
        const scrubberHtml = buildScrubberHtml(m);
        const actions = t.querySelector(".turn-actions");
        actions.insertAdjacentHTML("beforebegin", scrubberHtml);
        wireScrubber(t, m);
      }
      // copy (inline icon → swaps to a check briefly)
      t.querySelector(".btn-copy")?.addEventListener("click", (e) => {
        navigator.clipboard?.writeText(m.text).catch(() => {});
        const btn = e.currentTarget;
        btn.classList.add("done");
        btn.innerHTML = ICON.check();
        setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = ICON.copy(); }, 1400);
      });
      // regen: only the LAST agent turn can be regenerated. Past turns
      // can't because we'd have to re-issue the user prompt that came right
      // before THEM, then re-thread the entire suffix of the conversation,
      // and that gets semantically confusing fast. CSS hides .btn-regen on
      // older turns; this guard catches anyone who routes around the CSS.
      t.querySelector(".btn-regen")?.addEventListener("click", () => {
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg || lastMsg.id !== m.id) {
          console.warn("desktop renderer: regen only works on the last turn");
          return;
        }
        const lastUser = [...messages].reverse().find((x) => x.role === "user");
        if (!lastUser) return;
        // Drop the matching assistant entry from `history` so the daemon
        // gets the same conversation it had right before producing `m`.
        if (history.length && history[history.length - 1].role === "assistant") {
          history.pop();
        }
        // A turn can be several agent bubbles (intro + post-tool answer…); drop
        // them all so regen replaces the whole turn, not just the last segment.
        const turnId = m.turn;
        messages = messages.filter((x) => !(x.role === "agent" && turnId != null && x.turn === turnId) && x.id !== m.id);
        rebuildConvFromState();
        startAgentTurn();
        sendToDaemon(lastUser.text);
      });
    }
    $convScroll.appendChild(t);
    scrollConvToBottom();
  }

  // Strip the `last` modifier from every turn currently in the scroll. Called
  // right before we mount a new "last" turn so the previous one stops being
  // styled as the freshest reply (and its Regenerate button hides).
  function clearLastClass() {
    if (!$convScroll) return;
    $convScroll.querySelectorAll(".turn.last").forEach((el) => el.classList.remove("last"));
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
    clearLastClass();
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
    // Force resize so the window grows to fit the agent reply right away.
    requestWindowResize();
  }

  function addToolPill(name) {
    ensureConv();
    if (!$convScroll || toolPillsByName[name]) return;
    const pill = document.createElement("div");
    pill.className = "tool-pill";
    pill.innerHTML = `<div class="spinner"></div><span>${escapeHtml(name)}</span>`;
    // Append at the end of the conversation flow — pills sit between the
    // segment bubbles in the order tools actually run.
    $convScroll.appendChild(pill);
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
    m._audioEl = audio;          // the audio queue drives sequential playback
    let raf = null;

    const setProgress = (p) => {
      p = Math.max(0, Math.min(1, p));
      const cur = Math.floor(p * N);
      bars.forEach((b, i) => {
        b.classList.toggle("on", i <= cur);
        b.classList.toggle("cur", i === cur && !audio.paused);
      });
      $dur.textContent = p > 0 || !audio.paused ? fmt(p * dur) : fmt(dur);
    };
    const tick = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
      raf = requestAnimationFrame(tick);
    };
    audio.addEventListener("play",  () => { $play.innerHTML = ICON.pause(); raf = requestAnimationFrame(tick); if (mode !== "speaking") { mode = "speaking"; render(); } });
    audio.addEventListener("pause", () => { $play.innerHTML = ICON.play();  if (raf) cancelAnimationFrame(raf); });
    audio.addEventListener("ended", () => { $play.innerHTML = ICON.play(); if (raf) cancelAnimationFrame(raf); setProgress(1); onSegmentEnded(m); });
    // 404 / decode error / autoplay block: don't hang — advance the queue.
    audio.addEventListener("error", () => onSegmentEnded(m));

    $play.addEventListener("click", () => {
      if (audio.paused) {
        // Manual play takes control — stop the auto-sequence so we don't fight it.
        queuePlaying = false;
        try { if (ttsAudio && ttsAudio !== audio && !ttsAudio.ended) ttsAudio.pause(); } catch {}
        ttsAudio = audio;
        audio.play().catch(() => { if (mode === "speaking") { mode = "idle"; render(); } });
      } else {
        audio.pause();
        if (mode === "speaking") { mode = "idle"; render(); }
      }
    });
    $bar.addEventListener("click", (e) => {
      const r = $bar.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (audio.duration > 0) audio.currentTime = p * audio.duration;
      setProgress(p);
    });
  }

  // Post-finalize hook: add a scrubber to an already-rendered agent turn
  // when its TTS audio arrives. Called from the `tts-ready` daemon event.
  function attachAudioToTurn(turnId, { url, dur }) {
    const m = messages.find((x) => x.id === turnId);
    if (!m) return;
    m.audio = url;
    m.dur   = dur || 0;
    const turnEl = $convScroll?.querySelector(`[data-id="${turnId}"]`);
    if (turnEl && !turnEl.querySelector(".audio")) {
      // Insert the scrubber HTML just before turn-actions (matches appendTurn).
      const actions = turnEl.querySelector(".turn-actions");
      const html = buildScrubberHtml(m);
      if (actions) actions.insertAdjacentHTML("beforebegin", html);
      else turnEl.insertAdjacentHTML("beforeend", html);
      wireScrubber(turnEl, m); // sets m._audioEl
    }
    // Audio is ready → let the sequential queue play it when it's this
    // segment's turn (gapless auto-play across the turn's bubbles).
    queueMarkReady(m);
    scrollConvToBottom();
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

  // ── Per-turn setup + sequential audio queue ──────────────────────────────
  // Each turn renders N agent bubbles (segments), each with its own audio. We
  // play those audios in `seq` order, gaplessly: the cursor waits at a segment
  // until its TTS lands, plays it, then advances. So Roby "speaks" its messages
  // one after another even though they synthesize at different speeds.
  function beginAgentTurn() {
    currentTurn++;
    resetTurnAudio();
    doneHandled = false;
    pendingTtsTurnId = null;
    if (ttsTimer) { clearTimeout(ttsTimer); ttsTimer = null; }
  }
  function resetTurnAudio() {
    try { ttsAudio?.pause?.(); } catch {}
    ttsAudio = null;
    turnAudios = [];
    audioCursor = 0;
    queuePlaying = false;
    turnDone = false;
    if (turnWatchdog) { clearTimeout(turnWatchdog); turnWatchdog = null; }
  }
  function queueRegisterSegment(m) {
    if (!turnAudios.some((e) => e.m === m)) {
      turnAudios.push({ m, ready: false, failed: false, played: false });
      turnAudios.sort((a, b) => (a.m.seq || 0) - (b.m.seq || 0));
    }
  }
  function queueMarkReady(m) {
    const e = turnAudios.find((x) => x.m === m);
    if (e) e.ready = true;
    pumpAudioQueue();
  }
  function queueMarkFailed(m) {
    const e = turnAudios.find((x) => x.m === m);
    if (e) { e.ready = true; e.failed = true; e.played = true; }
    pumpAudioQueue();
  }
  function pumpAudioQueue() {
    if (queuePlaying) return;
    while (audioCursor < turnAudios.length) {
      const e = turnAudios[audioCursor];
      if (!e.ready) return;                           // wait for this segment's TTS
      if (e.played || e.failed || !e.m._audioEl) { audioCursor++; continue; }
      const audio = e.m._audioEl;
      queuePlaying = true;
      try { if (ttsAudio && ttsAudio !== audio && !ttsAudio.ended) ttsAudio.pause(); } catch {}
      ttsAudio = audio;
      audio.play().catch(() => {                       // autoplay blocked / decode error
        queuePlaying = false;
        e.played = true;
        audioCursor++;
        pumpAudioQueue();
      });
      return;
    }
    // Drained. Once the turn is done and nothing's left, return to idle.
    if (turnDone) {
      if (turnWatchdog) { clearTimeout(turnWatchdog); turnWatchdog = null; }
      if (mode === "speaking" || mode === "thinking") { mode = "idle"; render(); }
    }
  }
  // Called from a segment audio's `ended` (or `error`). Advances the queue.
  function onSegmentEnded(m) {
    const e = turnAudios.find((x) => x.m === m);
    if (e) { if (e.played) return; e.played = true; }
    if (queuePlaying && ttsAudio === m._audioEl) {
      queuePlaying = false;
      audioCursor++;
      pumpAudioQueue();
    } else if (mode === "speaking") {
      mode = "idle"; render();
    }
  }

  // ── Recording flow ───────────────────────────────────────────────────────
  function startListening() {
    if (mode !== "idle") return;
    isCancelled = false;
    micReady = false;      // show "Cargando…" until the recorder is actually live
    speechSeen = false;
    lastVoiceTs = 0;
    listenStartTs = 0;
    micPeakRms = 0;
    pausePreviewed = false;
    reuseLiveOnStop = false;
    livePromise = null;
    pendingUserText = "";
    // Warm the whisper model now (overlaps the mic warm-up), so the decode at
    // the end of this utterance doesn't pay a cold start.
    window.apx?.warmupStt?.();
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
    resetTurnAudio();   // stop any playing/queued segment audio
    if (streamingAgentEntry) {
      streamingAgentEntry.el.remove();
      streamingAgentEntry = null;
    }
    mode = "idle";
    render();
  }

  function stopSpeaking() {
    // Halt the auto-sequence and the current segment.
    queuePlaying = false;
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
        timeData = new Uint8Array(analyser.fftSize);
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
        // Just buffer. We deliberately do NOT decode on every chunk anymore —
        // re-decoding the growing clip every 2s serialized on the single
        // whisper thread and the final decode queued behind it (the old ~10s
        // stall). Transcription now happens once, on a pause / on stop.
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        if (isCancelled) { recordedChunks = []; if (mode !== "idle") { mode = "idle"; render(); } return; }
        let text = "";
        // Auto-send after a pause: the pause already kicked a full decode that
        // covers all the speech (the only thing after it is trailing silence),
        // so reuse it instead of decoding the same audio again. Await the
        // in-flight preview if it hasn't settled yet.
        if (reuseLiveOnStop) {
          if (livePromise) { try { await livePromise; } catch {} }
          text = (pendingUserText || "").trim();
        }
        // Manual send (Enviar / ⌘G release) or no preview yet → one fresh decode.
        if (!text) text = (await transcribeBuffered()).trim();
        recordedChunks = [];
        reuseLiveOnStop = false;
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
      // 1s timeslice: chunks land often enough that a pause-preview decode has
      // audio to work with even for short utterances. We no longer decode per
      // chunk (just buffer), so a smaller slice is essentially free.
      mediaRecorder.start(1000);
      // Recorder is now live → swap "Cargando…" for the reactive wave and let
      // silence detection arm. lastVoiceTs starts now so a fully silent open
      // won't auto-send (speechSeen gates that).
      micReady = true;
      lastVoiceTs = Date.now();
      listenStartTs = Date.now();
      micPeakRms = 0;
      if (mode === "listening") render();
    } catch (e) {
      // getUserMedia failed → classify and tell the user, instead of silently
      // bailing to idle (which looks like "it just doesn't work").
      console.error("desktop renderer: mic error", e);
      micReady = false;
      mode = "idle";
      const name = e?.name || "";
      let notice;
      if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied/i.test(e?.message || "")) {
        notice = "Roby no tiene permiso para el micrófono. Activalo en Ajustes del sistema › Privacidad y seguridad › Micrófono, y volvé a intentar.";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
        notice = "No encontré ningún micrófono conectado. Revisá el dispositivo de entrada y reintentá.";
      } else {
        notice = "No pude abrir el micrófono (" + (name || e?.message || "error") + "). Reintentá o revisá los permisos.";
      }
      showMicNotice(notice);
      render();
    }
  }
  // Visual-only system notice in the conversation (not a message, not history).
  function showMicNotice(text) {
    ensureConv();
    if ($convScroll) {
      // Replace any prior notice so they don't stack.
      $convScroll.querySelector(".sys-notice")?.remove();
      const el = document.createElement("div");
      el.className = "sys-notice";
      el.innerHTML = `<span class="ic">${ICON.mic()}</span><span>${escapeHtml(text)}</span>`;
      $convScroll.appendChild(el);
      scrollConvToBottom();
    }
    requestWindowResize();
  }
  function stopMic() {
    try { mediaRecorder?.stop(); } catch {}
    try { audioStream?.getTracks().forEach((t) => t.stop()); } catch {}
    mediaRecorder = null;
    audioStream = null;
    micReady = false;
    speechSeen = false;
    lastVoiceTs = 0;
    pausePreviewed = false;
    stopWaveLoop();
    try { audioCtx?.close(); } catch {}
    audioCtx = null;
    analyser = null;
    freqData = null;
    timeData = null;
  }

  // ── Reactive wave: amplitude-driven bar heights (runs while mode === listening)
  function startWaveLoop() {
    stopWaveLoop();
    // Per-bar smoothed amplitude so heights don't twitch frame-to-frame.
    let smoothed = null;
    const tick = () => {
      if (mode !== "listening" || !analyser) { waveRaf = null; return; }
      analyser.getByteFrequencyData(freqData);

      // ── Silence auto-send ──────────────────────────────────────────────
      // Time-domain RMS is a reliable voice/silence gate (unlike the freq
      // bars, it's independent of the analyser's dB scaling). Once we've heard
      // speech, SILENCE_MS of quiet commits the recording on its own.
      if (micReady && timeData) {
        analyser.getByteTimeDomainData(timeData);
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / timeData.length);
        const now = Date.now();
        if (rms > micPeakRms) micPeakRms = rms;
        // Dead-mic guard: a real mic always has a noise floor (rms ≳ 0.005). If
        // after DEAD_MIC_MS the signal is essentially flat zero, the stream is
        // muted / wrong device / OS-blocked — tell the user instead of sitting
        // in "listening" forever waiting for speech that can't arrive.
        if (!speechSeen && listenStartTs && now - listenStartTs > DEAD_MIC_MS && micPeakRms < DEAD_MIC_RMS) {
          waveRaf = null;
          stopMic();
          mode = "idle";
          showMicNotice("No me está llegando audio del micrófono. Revisá que Roby tenga permiso (Ajustes del sistema › Privacidad y seguridad › Micrófono) y que esté seleccionado el micrófono correcto.");
          render();
          return;
        }
        if (rms > VOICE_RMS) {
          speechSeen = true;
          lastVoiceTs = now;
          pausePreviewed = false;            // new speech → allow a fresh preview
        } else if (speechSeen && lastVoiceTs) {
          const silentFor = now - lastVoiceTs;
          // A short pause kicks ONE decode of everything said so far. It doubles
          // as the final transcription, so the auto-send below is instant
          // instead of paying a decode after stop.
          if (!pausePreviewed && silentFor >= PAUSE_PREVIEW_MS && !liveBusy) {
            pausePreviewed = true;
            runLivePartial();
          }
          // Sustained silence → auto-send, reusing the pause decode.
          if (silentFor >= SILENCE_MS) {
            waveRaf = null;
            reuseLiveOnStop = true;
            stopListening(/* commit */ true);
            return;
          }
        }
      }

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
  // Decode what's been recorded so far (fired once per speech pause). The
  // result is stashed in pendingUserText and reused by the auto-send on stop,
  // so the same audio is never decoded twice. livePromise lets onstop await an
  // in-flight decode before reading the text.
  function runLivePartial() {
    if (liveBusy || mode !== "listening" || !recordedChunks.length) return;
    liveBusy = true;
    livePromise = (async () => {
      try {
        const text = await transcribeBuffered();
        if (text && mode === "listening") pendingUserText = text;
      } finally { liveBusy = false; }
    })();
    return livePromise;
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
    messages.push(m);
    history.push({ role: "user", content: clean });
    pendingUserText = "";
    removePendingUserPartial();
    ensureConv();
    appendTurn(m, true);
    startAgentTurn();
    sendToDaemon(clean);
  }

  // Begin a fresh agent turn: reset per-turn flags, switch to thinking,
  // mount the placeholder bubble, and ask main to grow the window now (not
  // one ResizeObserver tick later). Shared by commitUserMessage + regen so
  // both paths set up the daemon-event pipeline identically.
  function startAgentTurn() {
    beginAgentTurn();      // bump currentTurn + reset the audio queue/guards
    mode = "thinking";
    render();
    ensureConv();          // segments will mount their own bubbles
    requestWindowResize();
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
        // Marks the start of a turn. For locally-initiated turns startAgentTurn
        // already ran beginAgentTurn() (mode is already "thinking"); for turns
        // NOT initiated in this window (injected / broadcast from another client)
        // we set them up here so currentTurn/queue/doneHandled are correct and
        // the turn doesn't hang.
        if (mode !== "thinking" && mode !== "speaking") {
          beginAgentTurn();
          mode = "thinking";
          render();
        } else {
          doneHandled = false;
        }
        ensureConv();
        break;
      case "token":
        // Legacy path (backend no longer streams tokens for desktop). Kept so a
        // mixed-version daemon doesn't break — accumulate into a single bubble.
        appendStreamingToken(msg.text || "");
        break;
      case "tool_start":  addToolPill(msg.name); break;
      case "tool_done":   updateToolPill(msg.name); break;
      case "segment": {
        // Each segment is its own agent message bubble + its own audio.
        ensureConv();
        const text = (msg.text || "").trim();
        if (!text) break;
        const id = nextId++;
        const m = { id, seq: msg.seq || 0, turn: currentTurn, role: "agent", text, t: nowHHMM(), audio: null, dur: null };
        messages.push(m);
        appendTurn(m, true);
        queueRegisterSegment(m);
        // Synthesize THIS segment; tts-ready(seg=id) attaches its audio + queues
        // it for gapless sequential playback.
        window.apx?.requestTts?.(text, id);
        requestWindowResize();
        scrollConvToBottom();
        break;
      }
      case "done": {
        if (doneHandled) break;
        doneHandled = true;
        turnDone = true;
        // Record the whole turn as one assistant entry for conversation context.
        const full = (msg.text || "").trim();
        if (full) history.push({ role: "assistant", content: full });
        // Safety net: if some segment's TTS never resolves, flush after 12s so
        // the capsule can't get stuck in "Pensando…".
        if (turnWatchdog) clearTimeout(turnWatchdog);
        turnWatchdog = setTimeout(() => {
          turnAudios.forEach((e) => { if (!e.ready) { e.ready = true; e.failed = true; e.played = true; } });
          pumpAudioQueue();
        }, 12000);
        // Play whatever audio is already ready; flip to idle if there's nothing
        // left to play (e.g. a turn that produced no audio).
        pumpAudioQueue();
        if (!queuePlaying && audioCursor >= turnAudios.length && mode !== "speaking") {
          mode = "idle"; render();
        }
        break;
      }
      case "tts-ready":
        if (msg.seg != null) attachAudioToTurn(msg.seg, { url: msg.url, dur: msg.duration });
        break;
      case "tts-failed": {
        // No audio for this segment — skip it in the queue so playback advances.
        const m = (msg.seg != null) ? messages.find((x) => x.id === msg.seg) : null;
        if (m) queueMarkFailed(m);
        break;
      }
      case "error": {
        ensureConv();
        const id = nextId++;
        const m = { id, seq: 9999, turn: currentTurn, role: "agent", text: "Error: " + (msg.message || "Unknown error"), t: nowHHMM(), isError: true };
        messages.push(m);
        appendTurn(m, true);
        turnDone = true;
        if (mode !== "speaking") { mode = "idle"; render(); }
        break;
      }
      case "cancelled":
        resetTurnAudio();
        turnDone = true;
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
      // Escape cancels whatever is in flight (recording / transcribing /
      // thinking / speaking). If nothing is in flight, a half-typed draft is
      // cleared first; only an empty idle capsule closes the window.
      if (mode === "listening" || mode === "transcribing" || mode === "thinking" || mode === "speaking") {
        cancel();
        return;
      }
      const input = $capCenter.querySelector("input");
      if (input && input.value.trim()) {
        input.value = "";
        render();
      } else {
        closeWindow();
      }
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

  // ── Keep STT warm ────────────────────────────────────────────────────────
  // The whisper server idles out after ~10 min. While the desktop window is
  // running we ping it every 4 min (and once now) so it stays loaded — the
  // user's first utterance never pays the cold-load cost.
  window.apx?.warmupStt?.();
  setInterval(() => { window.apx?.warmupStt?.(); }, 4 * 60 * 1000);

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
  // Wait briefly for the config Promise (theme/position/shortcut/agentName).
  // If it doesn't resolve in 400ms, paint anyway so the window doesn't stay
  // blank on a wedged daemon — the .then() will patch the placeholder when
  // it finally resolves.
  setTimeout(() => { if (!configReady) render(); }, 400);
})();

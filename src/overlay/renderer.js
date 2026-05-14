// APX Overlay renderer — chat UI logic.
// Runs in the Electron BrowserWindow (renderer process).
// Communicates with main process via window.apx (contextBridge).

(() => {
  "use strict";

  // ── DOM refs ──────────────────────────────────────────────────────────
  const $messages   = document.getElementById("messages");
  const $emptyState = document.getElementById("empty-state");
  const $liveBar    = document.getElementById("live-bar");
  const $liveText   = document.getElementById("live-text");
  const $statusText = document.getElementById("status-text");
  const $connBadge  = document.getElementById("conn-badge");
  const $btnClose   = document.getElementById("btn-close");
  const $hintBar    = document.getElementById("hint-bar");

  // Show the actual configured shortcut in the hint bar and empty state
  window.apx?.getShortcut?.().then(shortcut => {
    if (!shortcut) return;
    const label = shortcut
      .replace("CommandOrControl", window.apx.platform === "darwin" ? "⌘" : "Ctrl")
      .replace("Command", "⌘")
      .replace("Control", "Ctrl")
      .replace("Shift", "⇧")
      .replace("Option", "⌥")
      .replace("Alt", "Alt")
      .replace(/\+/g, "");
    const hint = document.getElementById("shortcut-hint");
    if (hint) hint.textContent = label;
    const emptyHint = document.getElementById("empty-shortcut-hint");
    if (emptyHint) emptyHint.textContent = label;
  }).catch(() => {});

  // ── State ─────────────────────────────────────────────────────────────
  let isRecording    = false;
  let isStreaming    = false;
  let isCancelled    = false;
  let liveAccum      = "";       // accumulated live transcription
  let mediaRecorder  = null;
  let audioStream    = null;
  let streamingBubble = null;   // current streaming agent bubble element
  let currentExchangeStart = 0; // index in allMessages for current exchange
  let allMessages    = [];       // { role, content, el }
  let whisperPollTimer = null;  // timer for model-loading poll

  // ── Recording ─────────────────────────────────────────────────────────

  window.apx?.onRecordingStart(async () => {
    isRecording = true;
    isCancelled = false;
    liveAccum   = "";
    setStatus("Recording…");
    showLiveBar(true);

    // Check if whisper model is loaded; if not, show loading state while mic starts
    let whisperReady = false;
    try {
      const status = await window.apx.checkWhisperReady();
      whisperReady = status?.ready === true;
    } catch {}

    if (!whisperReady) {
      setLiveText("Cargando modelo…");
      // Poll until model is loaded, then switch to Listening...
      whisperPollTimer = setInterval(async () => {
        if (!isRecording) { clearInterval(whisperPollTimer); whisperPollTimer = null; return; }
        try {
          const s = await window.apx.checkWhisperReady();
          if (s?.ready) {
            clearInterval(whisperPollTimer);
            whisperPollTimer = null;
            if (isRecording) setLiveText("Listening…");
          }
        } catch {}
      }, 1500);
    }

    startMic();
  });

  window.apx?.onRecordingStop(() => {
    isRecording = false;
    if (whisperPollTimer) { clearInterval(whisperPollTimer); whisperPollTimer = null; }
    stopMic();
    // liveAccum already contains the transcription — send it
    const text = liveAccum.trim();
    if (text && !isCancelled) {
      commitUserMessage(text);
    } else {
      showLiveBar(false);
      setStatus("Ready");
    }
  });

  // ── Mic capture ───────────────────────────────────────────────────────

  async function startMic() {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/ogg;codecs=opus";
      const format = mimeType.includes("webm") ? "webm" : "ogg";

      mediaRecorder = new MediaRecorder(audioStream, { mimeType, audioBitsPerSecond: 32000 });

      mediaRecorder.ondataavailable = async (e) => {
        if (!e.data || e.data.size < 200) return; // skip nearly-empty chunks
        if (!isRecording && !liveAccum) return;

        const buf = await e.data.arrayBuffer();
        const result = await window.apx.transcribeChunk(buf, format, "auto");
        if (result?.ok && result.text?.trim()) {
          liveAccum = (liveAccum + " " + result.text).trim();
          $liveText.textContent = liveAccum || "Listening…";
        }
      };

      // Send a chunk every 2.5 seconds while recording
      mediaRecorder.start(2500);
    } catch (e) {
      setStatus("Mic error: " + e.message);
      showLiveBar(false);
      isRecording = false;
    }
  }

  function stopMic() {
    try { mediaRecorder?.stop(); } catch {}
    try { audioStream?.getTracks().forEach(t => t.stop()); } catch {}
    mediaRecorder = null;
    audioStream   = null;
  }

  // ── Send message flow ─────────────────────────────────────────────────

  async function commitUserMessage(text) {
    showLiveBar(false);
    hideEmptyState();

    // Record where this exchange begins
    currentExchangeStart = allMessages.length;

    // Render user bubble
    const userBubble = addBubble("user", text);
    allMessages.push({ role: "user", content: text, el: userBubble });

    // Start streaming agent bubble
    streamingBubble = addBubble("agent", "");
    streamingBubble.classList.add("streaming");
    const agentEntry = { role: "agent", content: "", el: streamingBubble };
    allMessages.push(agentEntry);

    isStreaming = true;
    setStatus("Thinking…");
    scrollToBottom();

    // Send to daemon via IPC
    try {
      const history = buildHistory();
      await window.apx.sendMessage(text, history);
    } catch (e) {
      finalizeAgentBubble("Error: " + e.message, true);
    }
  }

  function buildHistory() {
    // Last N turns excluding the current in-progress exchange
    return allMessages
      .slice(0, currentExchangeStart)
      .slice(-20)
      .map(m => ({ role: m.role === "agent" ? "assistant" : m.role, content: m.content }));
  }

  // ── Daemon events ─────────────────────────────────────────────────────

  window.apx?.onDaemonEvent((msg) => {
    switch (msg.type) {
      case "thinking":
        setStatus("Thinking…");
        break;

      case "token":
        if (streamingBubble && !isCancelled) {
          const entry = allMessages[allMessages.length - 1];
          if (entry) entry.content += msg.text;
          appendToken(streamingBubble, msg.text);
          scrollToBottom();
        }
        break;

      case "tool_start":
        addToolPill(msg.name, false);
        setStatus(`Running ${msg.name}…`);
        break;

      case "tool_done":
        updateToolPill(msg.name, true);
        setStatus("Thinking…");
        break;

      case "done": {
        const finalText = msg.text || streamingBubble?.dataset.content || "";
        finalizeAgentBubble(finalText);
        setStatus("Ready");
        break;
      }

      case "error":
        finalizeAgentBubble(msg.message || "Unknown error", true);
        setStatus("Error");
        break;

      case "cancelled":
        if (streamingBubble) {
          streamingBubble.classList.remove("streaming");
          if (!streamingBubble.dataset.content) {
            streamingBubble.closest(".bubble-row")?.remove();
            allMessages.pop();
          }
        }
        streamingBubble = null;
        isStreaming = false;
        setStatus("Cancelled");
        setTimeout(() => setStatus("Ready"), 2000);
        break;
    }
  });

  window.apx?.onDaemonConnected(() => {
    $connBadge.classList.remove("show");
  });
  window.apx?.onDaemonDisconnected(() => {
    $connBadge.classList.add("show");
  });

  // ── Bubble helpers ────────────────────────────────────────────────────

  function addBubble(role, text) {
    const row = document.createElement("div");
    row.className = `bubble-row ${role}`;

    const bub = document.createElement("div");
    bub.className = "bubble";
    bub.dataset.content = text;
    if (text) bub.textContent = text;

    row.appendChild(bub);
    $messages.appendChild(row);
    return bub;
  }

  function appendToken(bubbleEl, token) {
    bubbleEl.dataset.content = (bubbleEl.dataset.content || "") + token;
    // Re-render full text (handles whitespace/newlines correctly)
    bubbleEl.textContent = bubbleEl.dataset.content;
  }

  function finalizeAgentBubble(text, isError = false) {
    if (!streamingBubble) return;
    streamingBubble.classList.remove("streaming");
    if (isError) streamingBubble.classList.add("error");
    const finalContent = text || streamingBubble.dataset.content || "";
    streamingBubble.textContent = finalContent;
    streamingBubble.dataset.content = finalContent;

    // Update allMessages entry
    const entry = allMessages[allMessages.length - 1];
    if (entry && entry.role === "agent") entry.content = finalContent;

    streamingBubble = null;
    isStreaming = false;
    scrollToBottom();
  }

  // Tool pills appear between bubbles
  let activePills = {}; // name → pill element

  function addToolPill(name, done) {
    const pill = document.createElement("div");
    pill.className = "tool-pill";
    pill.dataset.tool = name;
    pill.innerHTML = done
      ? `<span class="check">✓</span><span>${name}</span>`
      : `<div class="spinner"></div><span>${name}</span>`;
    // Insert before the streaming agent bubble row
    if (streamingBubble) {
      const row = streamingBubble.closest(".bubble-row");
      $messages.insertBefore(pill, row);
    } else {
      $messages.appendChild(pill);
    }
    activePills[name] = pill;
    scrollToBottom();
  }

  function updateToolPill(name, done) {
    const pill = activePills[name];
    if (!pill) return;
    if (done) {
      pill.innerHTML = `<span class="check">✓</span><span>${name}</span>`;
    }
  }

  // ── Live bar ──────────────────────────────────────────────────────────

  function showLiveBar(show) {
    if (show) {
      $liveBar.classList.add("active");
      $liveText.textContent = "Listening…";
    } else {
      $liveBar.classList.remove("active");
      $liveText.textContent = "Listening…";
    }
  }

  function setLiveText(text) {
    $liveText.textContent = text;
  }

  // ── Misc UI ───────────────────────────────────────────────────────────

  function hideEmptyState() {
    $emptyState?.remove();
  }

  function setStatus(text) {
    if ($statusText) $statusText.textContent = text;
  }

  function scrollToBottom() {
    $messages.scrollTop = $messages.scrollHeight;
  }

  // ── Keyboard handling ─────────────────────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (isRecording) {
        // Cancel recording without sending
        isCancelled = true;
        isRecording = false;
        stopMic();
        showLiveBar(false);
        setStatus("Cancelled");
        setTimeout(() => setStatus("Ready"), 1500);
        window.apx?.cancel();
      } else if (isStreaming) {
        // Interrupt agent response (keeps user bubble, clears streaming)
        isCancelled = true;
        window.apx?.cancel();
        // finalizeAgentBubble called on "cancelled" event from daemon
      } else {
        // Close overlay
        window.apx?.close();
      }
    }
  });

  // Close button
  $btnClose?.addEventListener("click", () => {
    if (isStreaming) {
      isCancelled = true;
      window.apx?.cancel();
    }
    window.apx?.close();
  });

})();

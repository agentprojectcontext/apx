(() => {
  globalThis.apxInstagramDraft = async function apxInstagramDraft(options = {}) {
    const { recipient, threadId, text, conversationSelector, messagesSelector, send = false, confirmSend } = options;
    if (!/^[a-z0-9._]+$/i.test(recipient ?? "") || !/^\d+$/.test(threadId ?? "") || !text?.trim())
      throw new Error("Supply recipient, numeric threadId and nonempty text");
    if (location.hostname !== "www.instagram.com" && location.hostname !== "instagram.com")
      throw new Error("Not an Instagram tab");
    const expectedPath = `/direct/t/${threadId}/`;
    if (location.pathname !== expectedPath) throw new Error("Wrong conversation URL");
    if (!conversationSelector || !messagesSelector)
      throw new Error("Supply exact conversation and message-bubble selectors from this page");
    const roots = document.querySelectorAll(conversationSelector);
    if (roots.length !== 1) throw new Error("Conversation selector must match exactly one element");
    const root = roots[0];
    const visible = (el) => Boolean(el.getClientRects().length);
    const editors = [...root.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible);
    if (editors.length !== 1) throw new Error("Expected exactly one visible composer");
    const editor = editors[0];
    const assertRecipient = () => {
      const headerLinks = [...root.querySelectorAll('header a[href], [role="banner"] a[href]')];
      const recipients = new Set(
        headerLinks
          .map((link) => {
            const url = new URL(link.href, location.href);
            if (url.origin !== location.origin) return undefined;
            return /^\/([a-z0-9._]+)\/$/i.exec(url.pathname)?.[1]?.toLowerCase();
          })
          .filter(Boolean),
      );
      if (recipients.size !== 1 || !recipients.has(recipient.toLowerCase()))
        throw new Error("Header does not identify exactly the expected recipient");
    };
    assertRecipient();
    const exact = (el) => (el.innerText ?? el.textContent ?? "").replace(/\r\n/g, "\n");
    const bubbles = () =>
      [...root.querySelectorAll(messagesSelector)].filter(
        (el) => !el.contains(editor) && !editor.contains(el) && visible(el),
      );
    const matching = () => bubbles().filter((el) => exact(el) === text);
    const key = `apx-ig-send:${JSON.stringify([threadId, recipient.toLowerCase(), text])}`;
    if (matching().length) return { status: "already_present", recipient, threadId, sent: false };
    if (sessionStorage.getItem(key))
      throw new Error("An earlier send is uncertain or complete; inspect the conversation, do not retry");
    const existing = exact(editor);
    if (existing && existing !== text) throw new Error("Composer has another draft; nothing changed");
    if (existing !== text) {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("insertText", false, text)) throw new Error("Composer refused insertText");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (exact(editor) !== text) throw new Error("Composer text is not exactly one copy; nothing sent");
    if (send !== true) return { status: "composed", recipient, threadId, text, sent: false };
    if (confirmSend !== `SEND ${recipient}`)
      throw new Error("Sending requires send:true and confirmSend: SEND <recipient>");
    if (location.pathname !== expectedPath || !editor.isConnected || !root.isConnected)
      throw new Error("Conversation changed; nothing sent");
    assertRecipient();
    if (matching().length || sessionStorage.getItem(key))
      throw new Error("Message already present or claimed; nothing sent");
    const buttons = [...root.querySelectorAll('button, [role="button"]')].filter((el) => {
      const label = (el.getAttribute("aria-label") ?? el.innerText ?? "").trim().toLowerCase();
      return (
        visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" && ["send", "enviar"].includes(label)
      );
    });
    if (buttons.length !== 1) throw new Error("Expected exactly one enabled send button");
    sessionStorage.setItem(key, "uncertain");
    buttons[0].click();
    const end = performance.now() + 3000;
    while (performance.now() < end) {
      if (location.pathname !== expectedPath || !root.isConnected)
        throw new Error("Conversation changed after send; verify manually");
      if (matching().length === 1 && exact(editor) === "") {
        sessionStorage.setItem(key, "verified");
        return { status: "bubble_verified", recipient, threadId, text, sent: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Send not verified by one exact bubble and empty composer; do not retry automatically");
  };
  return { installed: "apxInstagramDraft", default: "compose only; sending requires explicit options" };
})();

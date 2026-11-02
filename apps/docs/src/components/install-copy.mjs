export function bindInstallationCopy(win, button) {
  const label = button.querySelector(".cmd__copy");
  const original = label?.textContent;
  let resetTimer;
  button.addEventListener("click", async () => {
    if (!win.navigator.clipboard?.writeText) return;
    try {
      await win.navigator.clipboard.writeText(button.dataset.copy ?? "");
    } catch {
      return;
    }
    if (!label) return;
    if (resetTimer !== undefined) win.clearTimeout(resetTimer);
    label.textContent = button.dataset.done ?? "✓";
    resetTimer = win.setTimeout(() => {
      label.textContent = original;
      resetTimer = undefined;
    }, 1500);
  });
}

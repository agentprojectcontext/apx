export function bindInstallationCopy(win, button) {
  const label = button.querySelector(".cmd__copy");
  const original = label?.textContent;
  let resetTimer;
  button.addEventListener("click", async () => {
    if (!(await copyInstallation(win, button)) || !label) return;
    if (resetTimer !== undefined) win.clearTimeout(resetTimer);
    label.textContent = button.dataset.done ?? "✓";
    resetTimer = win.setTimeout(() => {
      label.textContent = original;
      resetTimer = undefined;
    }, 1500);
  });
}

export async function copyInstallation(win, button) {
  if (!win.navigator.clipboard?.writeText) return false;
  try {
    await win.navigator.clipboard.writeText(button.dataset.copy ?? "");
    button.dispatchEvent(new win.CustomEvent("apx:install-copied", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

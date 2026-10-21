import type { Frame, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** A kit page with one of each overlay, logging what the page hears. */
const page = `<script src="/_apx/kit@1.js"></script>
<main class="ax-page">
  <div id="clip" style="overflow:hidden;width:70px;height:34px"><button id="tipped" class="ax-btn" data-ax-tip="Archive this item for later">Tip</button></div>
  <div class="ax-dropdown"><button class="ax-btn" data-ax-dropdown>Actions</button>
    <div class="ax-dropdown__menu" role="menu">
      <div class="ax-dropdown__label">Edit</div>
      <button class="ax-dropdown__item" value="copy">Copy<kbd>C</kbd></button>
      <button class="ax-dropdown__item" value="rename">Rename</button>
      <hr>
      <button class="ax-dropdown__item" role="menuitemcheckbox" value="pin">Pinned</button>
      <button class="ax-dropdown__item ax-dropdown__item--danger" value="delete" disabled>Delete</button>
    </div>
  </div>
  <button class="ax-btn" id="filters" data-ax-popover="#pop">Filters</button>
  <div class="ax-pop" id="pop"><div class="ax-pop__head">Filters</div><input class="ax-input" id="name" aria-label="Name"></div>
  <button class="ax-btn" data-ax-open="#sheet">Details</button>
  <dialog class="ax-sheet" id="sheet"><div class="ax-sheet__head"><h2 class="ax-h2">Order</h2><button class="ax-btn" data-ax-close>Close</button></div><div class="ax-sheet__body">Body</div></dialog>
  <label class="ax-field"><span>Country</span><select class="ax-select" id="country" data-ax-combobox><option value="ar">Argentina</option><option value="br">Brasil</option><option value="cl">Chile</option></select></label>
  <button class="ax-btn" id="remove">Remove</button>
  <output id="log"></output>
</main>
<script>
const log = (s) => { document.getElementById("log").textContent += s + ";"; };
document.addEventListener("ax:select", (e) => log(e.detail.value + ":" + e.detail.checked));
document.getElementById("remove").onclick = async () =>
  log("confirm=" + (await APX.confirm("Delete the order?", { confirm: "Yes", cancel: "No" })));
document.getElementById("country").addEventListener("change", (e) => log("country=" + e.target.value));
</script>`;

const frames = (p: Page): Frame[] => p.frames().filter((f) => f.url().startsWith("about:srcdoc"));
const focused = (f: Frame) => f.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
const logged = (f: Frame) => f.evaluate(() => document.getElementById("log")?.textContent ?? "");

test("the kit's overlays open, pick and close from the keyboard and the pointer", async ({ page: p }) => {
  await rpc("setup.finish", {});
  const shown = await rpc<{ id: string }>("surfaces.show", {
    name: "kit-overlays",
    title: "Overlays",
    html: page,
    app: true,
  });
  await open(p, `#app=${shown.id}`);
  await expect.poll(() => frames(p).length).toBeGreaterThan(0);
  const f = frames(p)[0] as Frame;
  await expect(f.getByRole("button", { name: "Actions" })).toBeVisible();

  // Dropdown: Enter opens on the first item, arrows skip labels, separators and disabled items, Esc returns focus.
  const actions = f.getByRole("button", { name: "Actions" });
  await actions.focus();
  await p.keyboard.press("Enter");
  await expect(f.getByRole("menu")).toBeVisible();
  await expect(actions).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => focused(f)).toBe("CopyC");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowDown");
  await expect.poll(() => focused(f)).toBe("Pinned");
  await p.keyboard.press("Enter");
  await expect(f.getByRole("menuitemcheckbox", { name: "Pinned" })).toHaveAttribute("aria-checked", "true");
  await expect(f.getByRole("menu")).toBeVisible();
  await p.keyboard.press("ArrowDown");
  await expect.poll(() => focused(f)).toBe("CopyC");
  await p.keyboard.press("Escape");
  await expect(f.getByRole("menu")).toBeHidden();
  await expect.poll(() => focused(f)).toBe("Actions");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  await expect(f.getByRole("menu")).toBeHidden();
  await expect.poll(() => logged(f)).toBe("pin:true;rename:undefined;");

  // Tooltip: shown at once on focus, outside the clipping box, inside the view; Esc hides it.
  await f.locator("#tipped").focus();
  await expect(f.getByRole("tooltip")).toHaveText("Archive this item for later");
  const box = await f.evaluate(() => {
    const tip = document.querySelector(".ax-tooltip") as HTMLElement;
    const t = tip.getBoundingClientRect();
    const c = (document.getElementById("clip") as HTMLElement).getBoundingClientRect();
    return {
      inView: t.left >= 0 && t.top >= 0 && t.right <= innerWidth && t.bottom <= innerHeight,
      escapes: t.top < c.top || t.bottom > c.bottom || t.left < c.left || t.right > c.right,
      clipped: tip.closest("#clip") !== null,
    };
  });
  expect(box).toEqual({ inView: true, escapes: true, clipped: false });
  await p.keyboard.press("Escape");
  await expect(f.getByRole("tooltip")).toBeHidden();

  // Popover: focus moves in; Esc closes it and returns focus to its trigger.
  await f.getByRole("button", { name: "Filters" }).click();
  await expect(f.locator("#pop")).toBeVisible();
  await expect.poll(() => f.evaluate(() => document.activeElement?.id)).toBe("name");
  await p.keyboard.press("Escape");
  await expect(f.locator("#pop")).toBeHidden();
  await expect.poll(() => f.evaluate(() => document.activeElement?.id)).toBe("filters");

  // Sheet: opens from data-ax-open, closes from data-ax-close and from its backdrop.
  await f.getByRole("button", { name: "Details" }).click();
  await expect(f.getByRole("dialog", { name: "Order" })).toBeVisible();
  await f.getByRole("button", { name: "Close" }).click();
  await expect(f.locator("#sheet")).toBeHidden();
  await f.getByRole("button", { name: "Details" }).click();
  await expect(f.locator("#sheet")).toBeVisible();
  const frameBox = await p.locator(".surfaceframe__iframe").first().boundingBox();
  if (!frameBox) throw new Error("no frame");
  await p.mouse.click(frameBox.x + 30, frameBox.y + frameBox.height / 2);
  await expect(f.locator("#sheet")).toBeHidden();

  // Combobox: typing filters, Enter picks, and the select holds the value and fires change.
  const combo = f.getByRole("combobox", { name: "Country" });
  await expect(combo).toHaveValue("Argentina");
  await combo.click();
  await expect(f.getByRole("listbox")).toBeVisible();
  await expect(f.getByRole("option")).toHaveCount(3);
  await combo.pressSequentially("chi");
  await expect(f.getByRole("option")).toHaveText(["Chile"]);
  await p.keyboard.press("Enter");
  await expect(f.getByRole("listbox")).toBeHidden();
  await expect(combo).toHaveValue("Chile");
  expect(await f.evaluate(() => (document.getElementById("country") as HTMLSelectElement).value)).toBe("cl");
  await expect.poll(() => logged(f)).toContain("country=cl;");

  // APX.confirm, asked from a click as pages do, resolves true on confirm and false on Esc.
  await f.getByRole("button", { name: "Remove" }).click();
  await f.getByRole("alertdialog", { name: "Delete the order?" }).getByRole("button", { name: "Yes" }).click();
  await expect.poll(() => logged(f)).toContain("confirm=true;");
  await f.getByRole("button", { name: "Remove" }).click();
  await expect(f.getByRole("alertdialog")).toBeVisible();
  await expect.poll(() => focused(f)).toBe("No");
  await p.keyboard.press("Escape");
  await expect.poll(() => logged(f)).toContain("confirm=false;");
  await expect(f.getByRole("alertdialog")).toHaveCount(0);
});

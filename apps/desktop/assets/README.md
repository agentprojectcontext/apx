# APX desktop icons

The five paths trace the original logo's alpha silhouette. They preserve its proportions, rounded corners and internal cuts. All variants share those paths; no gradients or embedded raster images.

The web favicon (`apps/web/src/assets/favicon.svg`) uses the transparent green glyph. Only the desktop/Dock icon has a black tile. Keep the favicon and menu-bar backgrounds transparent.

- `logo-green.svg`: flat green (`#80ff00`), transparent.
- `logo-white.svg`: flat white, transparent.
- `logo-dock.svg`: green on a rounded black tile; source for `icon.png` (1024 × 1024).
- `trayTemplate.svg`: black, transparent; macOS tints its PNG representations to match the menu bar.
- `tray-color.svg`: green, transparent, for Windows and Linux.
- `*-attention.svg`: the same glyph with an orange (`#ff9500`) notification dot inside its upper-right silhouette, separated from the strokes by a transparent cutout. macOS uses a black glyph in `trayTemplate-attention` for light mode and a white glyph in `tray-white-attention` for dark mode. These pending images are not templates, so the orange survives system tinting; the icon refreshes when the native theme changes.

Tray PNGs are rasterized at 22 × 22 and 44 × 44 (`@2x`). Electron uses these native representations; SVGs remain the editable vector sources. Regenerate with `node scripts/tray-icons.ts` (uses the existing Playwright Chromium). The desktop build copies all icon assets into `dist`. Notification state selects the normal or attention image. On macOS, the native tray title places the count beside the icon in the system's color, using monospaced digits. The title and Dock badge cap at `99+` and clear at zero; the tooltip keeps the full count.

## File icons

`file-apxart.webp`, `file-apxapp.webp` and `file-apxext.webp` are the document icons for the files APX opens: an open box for artifacts (blue-green), a page with an app grid for marketplace apps (violet), a page with a puzzle piece for extensions (green). They are the editable sources (1254 × 1254, transparent). `electron-builder.json` registers the three types with them (`fileAssociations`, plus `UTExportedTypeDeclarations` on macOS). Regenerate the `.png`, `.ico` and `.icns` with `node scripts/file-icons.ts` (the `.icns` needs macOS's `iconutil`).

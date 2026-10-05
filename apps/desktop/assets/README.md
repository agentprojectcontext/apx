# APX desktop icons

The five paths trace the original logo's alpha silhouette. They preserve its proportions, rounded corners and internal cuts. All variants share those paths; no gradients or embedded raster images.

The web favicon (`apps/web/src/assets/favicon.svg`) uses the transparent green glyph. Only the desktop/Dock icon has a black tile. Keep the favicon and menu-bar backgrounds transparent.

- `logo-green.svg`: flat green (`#80ff00`), transparent.
- `logo-white.svg`: flat white, transparent.
- `logo-dock.svg`: green on a rounded black tile; source for `icon.png` (1024 × 1024).
- `trayTemplate.svg`: black, transparent; macOS tints its PNG representations to match the menu bar.
- `tray-color.svg`: green, transparent, for Windows and Linux.
- `*-attention.svg`: the same glyph with a separated notification dot.

Tray PNGs are rasterized at 22 × 22 and 44 × 44 (`@2x`). Electron uses these native representations; SVGs remain the editable vector sources. The desktop build copies all icon assets into `dist`. Notification state selects the normal or attention image, while the tooltip and macOS title/Dock badge show the unread count.

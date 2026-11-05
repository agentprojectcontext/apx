# APX extension icons

The PNGs are rasterizations of the official transparent green logo in `apps/web/src/assets/favicon.svg`, with no redraw, tile or color change. Transparent backgrounds follow the browser favicon and menu-bar branding. Chrome requires raster extension icons; the manifest declares 16, 32, 48 and 128 px for the toolbar, side-panel header and extension management screens.

Regenerate using the existing Playwright Chromium dependency:

```bash
node apps/chrome-extension/generate-icons.ts
```

The generated PNGs are versioned and copied into the unpacked bundle, so building or loading the extension needs no image tooling.

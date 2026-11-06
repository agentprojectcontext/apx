---
category: Display
---
# FileTile

A file as a square, all the same size: a picture fills it, any other file shows an icon, its name (two lines at most)
and its size. The whole square opens the file; `actions` (IconButtons: download, remove) sit in the corner on hover or
focus, and always on touch screens. `loading` shows a moving icon of its kind while the picture arrives.

Lay tiles out in `FileTileGrid`: as many across as the width holds, more rows below. `--apx-filetile-size` sets the
smallest tile (104px by default).

```tsx
<FileTileGrid label="Attachments">
  <FileTile name="brief.png" src="/brief.png" onOpen={open} actions={<IconButton size="sm" label="Download" icon={<Icons.Download size={14} />} />} />
  <FileTile name="verification.md" meta="4 KB" onOpen={open} />
</FileTileGrid>
```

# Comparison marks

These marks identify the products being discussed. They are not APX branding and do not imply affiliation or endorsement.

Retrieved October 30, 2026 from each product's own site:

- `hermes.png`: https://web-assets.nousresearch.com/marketing/2c549338f0004543670ff266cad1c18725fa8067/assets/hermes-agent/icon.png (linked by https://hermes-agent.nousresearch.com/).
- `openclaw.svg`: https://openclaw.ai/favicon.svg.
- `openbot.png`: https://openbot.run/apple-touch-icon.png.
- `claude-cowork.svg`: https://claude.com/icon.svg (linked by https://claude.com/download).
- `chatgpt-dots.svg`: https://chatgpt.com/cdn/assets/favicon-l4nq08hd.svg (linked by https://chatgpt.com/features/dots/); kept in its black fill; the site inverts it in the dark theme, as that file does for a dark system theme.
- `manus.png`: https://manus.im/apple-icon.png?apple-icon.153es_5lvwth1.png (linked by https://manus.im/).
- `devin.png`: https://devin.ai/apple-icon.png (linked by https://devin.ai/).
- `paperclip.png`: https://paperclip.ing/brand/favicon.png (linked by https://paperclip.ing/brand/).
- `viktor.png`: https://viktor.com/webclip.png?v=2 (linked by https://viktor.com/).
- `grok-bot.png`: https://x.ai/icon.png?icon.2jebtfdg6783w.png?dpl=164eb0c95701ec5c03b4f10eed243d2946fdb93d (linked by https://x.ai/bot).
- `muse.svg`: https://muse.ai/images/favicon/app-squiggle.svg (linked by https://muse.ai/).
- `instinct.png`: https://instinct.com/apple-touch-icon.png (linked by https://instinct.com/).
- `cursor.png`: https://cursor.com/marketing-static/apple-touch-icon-light.png (linked by https://cursor.com/).
- `antigravity.png`: https://antigravity.google/apple-touch-icon.png (linked by https://antigravity.google/).

Use only for identifying the respective products in the comparison pages. Product names and marks belong to their respective owners. Recording their provenance does not establish permission to reproduce the marks; trademark permissions have not been verified.

## Marks drawn inline

These are drawn as SVG paths in the page (one colour, in the text colour, unless noted), not served from this folder.
Retrieved October 30, 2026:

- Apple, Android and Linux (`src/components/OsIcon.astro`): Simple Icons 15.0.0 (CC0),
  https://cdn.jsdelivr.net/npm/simple-icons@15.0.0/icons/apple.svg, `…/android.svg` and `…/linux.svg`.
- Windows (`src/components/OsIcon.astro`): Simple Icons 11.0.0 (CC0), the last release that carries Microsoft's mark,
  https://cdn.jsdelivr.net/npm/simple-icons@11.0.0/icons/windows.svg.
- GitHub and YouTube (`src/components/web/SocialIcon.astro`): Simple Icons 15.0.0 (CC0),
  https://cdn.jsdelivr.net/npm/simple-icons@15.0.0/icons/github.svg and `…/youtube.svg`.
- Discord (`src/components/web/SocialIcon.astro`): the panel's own mark, `packages/ui/src/channel-marks.ts` (Simple
  Icons, CC0); the Discord buttons use Discord's brand colour, #5865F2.
- OpenAI (ChatGPT), Claude (Claude and Claude Code), Gemini, Codex and Ollama (`src/components/BrandMark.astro`): the
  panel's own marks, `packages/ui/src/engine-marks.ts` (path data from @lobehub/icons-static-svg, MIT), drawn as the
  panel draws them.

The interface icons (folder, clock, check…) are Lucide's (ISC), the set `packages/ui` uses, in
`src/data/ui-icons.ts`.

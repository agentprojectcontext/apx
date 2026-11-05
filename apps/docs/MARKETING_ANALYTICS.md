# Website measurement

Status: implementation branch; not deployed. The website uses one direct Google tag after opt-in. Do not add a second tag in Google Tag Manager or enable enhanced measurement: either would duplicate events and can disclose query strings or link details. GTM would be justified only when multiple independently managed tags need a reviewed publishing workflow. It is not required for GA4 events.

## Event contract

Every event uses the built page path, no query or fragment, an empty referrer and the fixed title `APX website`. No command, link label, target URL, form value, account identifier or arbitrary campaign value is included.

| Event | Meaning | Additional parameters |
| --- | --- | --- |
| `page_view` | One opted-in page load | None |
| `download_click` | Click on an official release asset, not a completed download or install | `os`, `architecture`, `placement` |
| `install_copy` | Clipboard write succeeded; not an installation | `placement` |
| `cta_click` | Download section, installation guide, release list, source or community | `action`, `placement` |
| `comparison_open` | Click to the comparison index or an article | `destination`, `placement` |
| `navigation_click` | Other internal header/footer navigation | `destination`, `placement` |
| `article_complete` | At least half the end marker is visible, once per opted-in page load; not proof of reading | `content_type` |

One click produces at most one event. Download takes priority over CTA, comparison and navigation. Placements are `header`, `footer`, `hero`, `downloads`, `docs`, `final`, `content`. OS and architecture describe the clicked file, not the visitor's hardware. Fallback release links are CTA clicks, not asset downloads. Actions before acceptance are not replayed. Withdrawal removes the interaction listeners and reading observer, in addition to the existing Google disable flag and cookie cleanup.

## Campaign links

Only these exact lower-case UTM values are passed as campaign parameters after consent:

- `utm_source`: `youtube`, `github`, `discord`, `newsletter`, `linkedin`, `instagram`, `google`, `bing`.
- `utm_medium`: `organic`, `social`, `video`, `email`, `referral`.
- `utm_campaign`: `launch`, `documentation`, `comparisons`.

Example: `https://apxagent.app/?utm_source=youtube&utm_medium=video&utm_campaign=launch`.

Other parameters, including `utm_content` and `utm_term`, are discarded. Unsupported values are omitted, not hashed. There is no pre-consent campaign storage or cross-page query propagation. GA handles subsequent attribution after consent through its own first-party cookies. Ad click identifiers and paid campaigns are outside this contract.

## Property setup and verification

These are recommendations, not claims about settings already applied:

1. Register event-scoped custom dimensions for `os`, `architecture`, `placement`, `action`, `destination` and `content_type` if reporting needs them. Confirm GA limits before adding dimensions.
2. Consider `download_click` and `install_copy` as separate key events. Label them as download intent and installation-command copy, never successful installations. Keep reading, navigation and page views out of conversion totals.
3. Keep enhanced measurement, Google signals and user-provided data collection disabled. Do not enable automated outbound-link/download/form tracking alongside this contract.
4. After publishing, test a declined browser (no Google requests), an accepted browser (one page view), one download and one successful clipboard write. Inspect requests for absent PII and correlate time, page and event with Realtime/DebugView. A queue entry or HTTP 204 does not prove property reception.
5. Check acquisition by the approved campaign vocabulary and event counts after normal reporting latency. Do not promise retroactive custom-dimension reporting.

## SEO and deployment checklist

- Verify 200 responses, canonical host/path, title/description, language alternates, robots and the sitemap against the actual deployment. Historical static redirects must have the current canonical destination and must stay out of the sitemap.
- Confirm Search Console ownership, submit `https://apxagent.app/sitemap-index.xml`, inspect the homepage and comparison routes, and review indexing exclusions. These administrative steps need access to the real property.
- `/best-ai-agent-apps/` returns 404: the existing article is `/compare/best-ai-agent-apps/` (and `/es/compare/best-ai-agent-apps/`). Use the canonical comparison route in marketing links; do not advertise the root alias.
- Build and check the standalone docs workspace with the production base `/`, run the analytics browser checks, and review the final diff. Deploy via the repository's Pages workflow only after authorization; no app release is needed for this website-only change.

Docs impact: updated — website privacy in English/Spanish describes interaction measurement and the finite campaign vocabulary; this document records event semantics, consent, configuration and deployment boundaries.

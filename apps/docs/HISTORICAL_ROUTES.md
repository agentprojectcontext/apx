# Historical documentation route inventory

Current documentation takes precedence at `/docs/` when historical addresses collide. Historical documentation remains at `/v1/`. This is the approved routing policy, not permission to publish.

The real v1 build contains 80 documentation pages: the 40 relative addresses below in English and the same 40 prefixed with `es/`. All 80 remain available unchanged at `/v1/<relative-address>`. For legacy `/docs/<relative-address>` addresses, the table shows the destination for English. All 40 Spanish legacy `/docs/es/<relative-address>` addresses retain their historical `/v1/es/<relative-address>` destination. The new current Spanish namespace is `/es/docs/`, not `/docs/es/`.

`Historical` means the equivalent `/v1/` page. `Current` means the existing `/docs/` page takes precedence. The root current-introduction alias predates this change; five English content addresses change meaning. In total, 74 historical aliases keep their v1 destination, five give current documentation, and one root alias continues to give the current introduction.

| Relative address | English legacy destination |
| --- | --- |
| `/` | Current introduction (pre-existing alias) |
| `capabilities/agent-vault/` | Historical |
| `capabilities/calendar/` | Historical |
| `capabilities/discord/` | Historical |
| `capabilities/images/` | Historical |
| `capabilities/integrations/` | Historical |
| `capabilities/mcp/` | Historical |
| `capabilities/memory-system/` | Historical |
| `capabilities/milestones/` | Historical |
| `capabilities/profiles/` | Historical |
| `capabilities/routines/` | Historical |
| `capabilities/skills/` | Historical |
| `capabilities/super-agent/` | Historical |
| `capabilities/tasks/` | Historical |
| `capabilities/telegram/` | Historical |
| `capabilities/whatsapp/` | Historical |
| `concepts/agents/` | Current |
| `concepts/configuration/` | Historical |
| `concepts/memory/` | Current |
| `concepts/messages/` | Historical |
| `concepts/projects/` | Current |
| `concepts/sessions/` | Historical |
| `engine/engines/` | Historical |
| `engine/runtimes/` | Historical |
| `reference/cli-cheatsheet/` | Historical |
| `reference/troubleshooting/` | Current |
| `start/architecture/` | Historical |
| `start/installation/` | Historical |
| `start/introduction/` | Current |
| `start/quick-start/` | Historical |
| `surfaces/acp/` | Historical |
| `surfaces/android/` | Historical |
| `surfaces/cli/` | Historical |
| `surfaces/daemon/` | Historical |
| `surfaces/deck/` | Historical |
| `surfaces/desktop/` | Historical |
| `surfaces/install-android/` | Historical |
| `surfaces/tui/` | Historical |
| `surfaces/voice/` | Historical |
| `surfaces/web/` | Historical |

The assembled-site browser suite enumerates the actual v1 build and requires exactly these totals. For every page it verifies `/v1/` HTML bytes against the original build, browser destinations for `/docs/`, `/apx/docs/` and `/docs/…/index.html`, preserved queries/fragments and visible content. It writes the complete expanded inventory as `historical-route-inventory.json` in the Playwright report. The root and `index.html` forms use their normal static-file resolution; compatibility aliases relying on the 404 script require JavaScript. Unknown pages remain 404. Non-page resources are copied with the complete v1 build, outside the documentation-page inventory.

## Resumen en español

La documentación actual tiene prioridad en `/docs/` ante colisiones; v1 se conserva en `/v1/`. El inventario cubre 80 páginas: las 40 direcciones de la tabla en inglés y sus 40 equivalentes con prefijo `es/`. La columna indica el destino inglés: `Historical` conserva v1; `Current` sirve documentación actual. Las 40 direcciones españolas antiguas `/docs/es/…` conservan `/v1/es/…`; la documentación española actual usa `/es/docs/…`.

Cinco URLs inglesas cambian de significado y la raíz mantiene su alias previo a la introducción actual. Las otras 74 URLs conservan v1. La suite comprueba cada página original byte a byte, las tres formas de acceso históricas, query/fragmento y contenido visible en desktop y teléfono; adjunta el inventario expandido completo. Esta decisión de rutas no autoriza publicar.

Docs impact: updated — complete bilingual historical scope, approved precedence and verification boundaries.

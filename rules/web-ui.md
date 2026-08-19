# Web UI (`src/interfaces/web`, React 19 + Vite + Tailwind v4)

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read before touching the web admin
> panel. The always-read rule is **11 / 11b** in the hub; this is the how-to.
> Known violations and their fixes are tracked in
> [`SURVEY-2026-08-17`](../spec/repair-and-refactoring-code/SURVEY-2026-08-17.md).

- **Run/verify**: `pnpm dev` (port 7431, proxies daemon 7430) hot-reloads; `pnpm build` regenerates `dist/`, which the daemon serves. Verify with `npx tsc --noEmit` — `vite build` does NOT type-check.
- **i18n is es-typed**: `t()` keys derive from `i18n/es.ts` (`TKey = DeepKeys<EsStrings>`). Add every key to BOTH `es.ts` and `en.ts` or `tsc` fails. No hardcoded user-facing literals — not even as prop defaults in shared components.
- **Labels are Capitalised, fragments are not** (AGENTS.md rule 11a). Anything that names something on screen — nav item, row, sub-label, chip, button, tab, column, empty state, toast, dialog title — starts with a capital, in sentence case: `"Memoria interna"`, `"En el repo"`. A string the UI composes into a running sentence (`"en {amount}"`, `"cada {n} horas…"`) follows its sentence. A slug, path, filename or command keeps its real spelling. Group headings stay Capitalised in the string even when the CSS uppercases them. Same rule per key in both locales — a translation may reword, but it may not change the case class.
- **Tooltips**: wrap the element in `<Tip content={…}>` (`components/ui/tip`), never native `title`. Provider is global in `App.tsx` (delay 0). Leave `<img alt>` alone — that's a11y, not a tooltip.
- **Confirm before acting**: any button that triggers an execution or a destructive change opens `<ConfirmDialog>` (`components/common/ConfirmDialog.tsx` — it already handles the busy state) or a `<Dialog>` with Cancel + action footer. **Never native `confirm()`/`alert()`/`prompt()`** — 13 legacy `confirm()` sites are queued for migration; do not add a 14th. Show a loading state while the action runs and revalidate the affected SWR keys after.
- **Componentize screens**: thin screen in `screens/`, its own parts under `components/<feature>/`. A reusable widget with two consumers does not live in `screens/`. A screen never imports from a sibling screen — shared form fields/constants go to `components/<feature>/`.
- **Full-height tabs**: `TabLayout` content is `flex-1 min-h-0 overflow-y-auto`, so use `h-full` + per-pane `overflow-y-auto` (see `ChatTab`, `RoutinesTab`). Tab bars use `components/common/TabNav.tsx` — don't hand-roll `border-b-2` buttons.
- **The web is a GUI over the system — reuse, don't re-implement.** A web feature must call the SAME core/daemon function the CLI uses. If the logic lives only inside a CLI command, extract it to `core/` so both surfaces call one implementation (rule 8). **If no daemon function exists for what's asked, stop and say so** — never invent a web-only version (and never shell out via `/run` to fake one: `ProjectFiles.read`/`.tree` exist precisely so no screen ever runs `cat`/`find`). `/run` has exactly one legitimate consumer: the terminal component.

## Screen anatomy (list screens — rule 11b)

Wrap in `<Section>` and respect the slots: `title` + `description`; the ONE
primary action in `action` (top-right); **every** filter/segment/tab in
`filters` — its own row underneath, labels through `<FilterChips>` (which
capitalizes; raw storage values like `in review` must never render). Never put
filters or secondary buttons in `action`. Reference implementations:
`GlobalTasksTab`, `CommitmentsTab`.

**Nothing to show is a state, not a blank.** Every empty pane renders
`<Empty>` from the barrel — never a bare `<p className="text-muted-fg">` or a
naked `<div>`. Pass the screen's own lucide `icon` (the APX mark stands in
without one), and add `fill` whenever the state owns a pane with a height (the
empty half of a master-detail, an empty chat): `fill` centres in the whole
pane, while the default is an inline dashed card for the gap where the list
would have been. A master-detail with nothing to pick hides the whole
box — one message, not an empty list beside an empty pane.

## Data layer

- **All requests through `src/lib/api/*`** — one module per resource, uniform
  `export const Resource = { list, get, add, remove, … }`, routed through the
  typed client in `lib/http.ts` (bearer auto-fetched from
  `/api/admin/web-token`; `HttpError` carries `status` + `body`). Never call
  `fetch()` or `http.post` raw from a screen/component (`useTokenBootstrap` is
  the sanctioned exception).
- Prefer new imports from the per-resource modules over the legacy `lib/api.ts`
  umbrella.
- **SWR keys**: one resource = one key. Use the typed hooks
  (`hooks/useProjects.ts`, `useEngines.ts`, `useInbox.ts`, …) and add a hook
  when a resource is fetched from more than one place — hand-written key
  strings for the same resource fork the cache and break cross-screen
  `mutate()`.
- No N+1 fan-out components (a child that renders `null` to run one `useSWR`
  per row is an anti-pattern; ask for a daemon aggregate endpoint instead).
- Error handling: `(e as Error).message` is the current idiom; never
  `catch (e: any)`.

## Primitives (`components/ui/*`)

Curated Base UI primitives adapted behind the `components/ui.tsx` barrel —
import from the barrel, not from `ui/<x>` directly. No Radix, no shadcn
installer runs: `components.json` and the dead registry output were deleted
(2026-08) and stay deleted — don't resurrect them or add registry components;
extend the barrel by hand. Only add a primitive when a real consumer lands
with it.

## Checklist for a new screen/module

1. Reuse an existing daemon function (grep `lib/api/*`, `api/*.js`,
   `core/stores/*`) — or stop and ask (rule 11 last clause).
2. Thin screen + `components/<feature>/` parts; `<Section>` slots respected.
3. Strings in BOTH `es.ts` and `en.ts`; tooltips via `<Tip>`; destructive
   actions via `<ConfirmDialog>`.
4. Typed SWR hook if the resource is shared; revalidate after mutations.
5. Playwright spec in `e2e/`.
6. `npx tsc --noEmit` clean.

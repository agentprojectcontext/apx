import useSWR from "swr";
import { RefreshCw, Construction } from "lucide-react";
import { Deck } from "../../lib/api/deck";
import { Section } from "../../components/Section";
import { Button, Empty, Loading } from "../../components/ui";
import { Tip } from "../../components/ui/tip";
import { useToast } from "../../components/Toast";
import { DaemonCard } from "../../components/deck/DaemonCard";
import { DesktopGroup } from "../../components/deck/DesktopGroup";
import type { DeckWidget } from "../../lib/api/deck";
import { t } from "../../i18n";

// Deck module — configure the companion "Deck" app: enable/disable widgets,
// view desktops, inspect the daemon manifest.
// Endpoints: GET /deck/manifest · PATCH /deck/widgets/:id
export function DeckScreen() {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useSWR(
    "/deck/manifest",
    () => Deck.manifest(),
    { refreshInterval: 30_000 }
  );

  // ── Deck is NOT released yet ───────────────────────────────────────────
  // The whole module is shown behind a non-dismissable "coming soon" modal
  // (see the overlay at the bottom of this component) and the UI underneath is
  // made inert. As defense-in-depth, the real widget mutation is disabled here
  // too: if someone forces the modal out of the DOM, toggling a widget does
  // NOTHING — no request ever hits the daemon, so nothing breaks.
  // 👉 Re-enable the body below (remove this guard) when Deck ships in a stable
  //    release. The original implementation is kept intact, just unreachable.
  const handleToggle = async (widgetId: string, enabled: boolean) => {
    return; // no-op while Deck is pre-release — see note above.
    // eslint-disable-next-line no-unreachable
    try {
      await Deck.setWidget(widgetId, { enabled });
      // Optimistically update local data so the switch flips immediately.
      await mutate(
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            deck: {
              ...prev.deck,
              widgets: prev.deck.widgets.map((w) =>
                w.id === widgetId
                  ? {
                      ...w,
                      user_enabled: enabled,
                      status: ((): DeckWidget["status"] => {
                        if (!enabled) return "disabled";
                        // If there's daemon_status, it's available; otherwise configured.
                        return w.daemon_status ? "available" : "configured";
                      })(),
                    }
                  : w
              ),
            },
          };
        },
        { revalidate: false }
      );
      toast.success(
        enabled
          ? t("modules_ui.deck_widget_enabled", { id: widgetId })
          : t("modules_ui.deck_widget_disabled", { id: widgetId })
      );
      // Re-validate after a short delay to get the server's persisted state.
      setTimeout(() => mutate(), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("modules_ui.deck_save_error");
      toast.error(msg);
    }
  };

  const desktops = data?.deck.desktops ?? [];
  const widgets = data?.deck.widgets ?? [];

  // Group widgets by desktop.
  const widgetsByDesktop = desktops.map((d) => ({
    desktop: d,
    widgets: widgets.filter((w) => w.desktop === d.id),
  }));

  // External widget counts for the section description.
  const externalWidgets = widgets.filter((w) => w.source === "external");
  const enabledCount = externalWidgets.filter((w) => w.user_enabled === true).length;

  return (
    <div className="relative min-h-full" data-testid="screen-deck">
      {/* ── Underlying Deck UI ──────────────────────────────────────────────
          Shown for context only while Deck is pre-release. It is made fully
          inert (no focus, no pointer events) and blurred behind the overlay
          below. All real actions are also neutralized in code (see
          handleToggle), so nothing runs even if this layer is re-enabled by
          hand. Remove the `inert`/blur wrapper when Deck ships. */}
    <div
      className="mx-auto max-w-4xl space-y-6 p-6 pointer-events-none select-none blur-[2px] opacity-60"
      aria-hidden
      inert
    >
      {/* Daemon info card */}
      {data && <DaemonCard manifest={data} />}

      {/* Widgets section */}
      <Section
        title={t("deck_screen.widgets_title")}
        description={
          isLoading
            ? t("modules_ui.deck_loading_manifest")
            : error
            ? t("modules_ui.deck_manifest_error")
            : t("modules_ui.deck_widgets_summary", { count: widgets.length, enabled: enabledCount })
        }
        action={
          <Tip content={t("deck_screen.reload_manifest")}>
            <Button size="sm" variant="ghost" onClick={() => mutate()} disabled={isLoading} aria-label={t("deck_screen.reload_manifest")}>
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            </Button>
          </Tip>
        }
      >
        {isLoading && <Loading label={t("modules_ui.deck_loading_manifest_full")} />}

        {!isLoading && error && (
          <Empty>
            {t("modules_ui.deck_manifest_load_failed")}{" "}
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => mutate()}
            >
              {t("modules_ui.deck_retry")}
            </button>
          </Empty>
        )}

        {!isLoading && !error && widgets.length === 0 && (
          <Empty>{t("modules_ui.deck_no_widgets")}</Empty>
        )}

        {!isLoading && !error && widgets.length > 0 && (
          <div className="space-y-5" data-testid="deck-desktop-list">
            {widgetsByDesktop
              .filter((g) => g.widgets.length > 0)
              .map((g) => (
                <DesktopGroup
                  key={g.desktop.id}
                  desktop={g.desktop}
                  widgets={g.widgets}
                  onToggle={handleToggle}
                />
              ))}
          </div>
        )}
      </Section>

      {/* Active project + stats (read-only context) */}
      {data?.apx && (
        <Section title={t("deck_screen.context_title")} description={t("modules_ui.deck_context_desc")}>
          <div className="space-y-2 text-sm" data-testid="deck-apx-context">
            <div className="flex items-center gap-2">
              <span className="text-muted-fg">{t("modules_ui.deck_active_project")}</span>
              <span className="font-medium">
                {data.apx.active_project
                  ? data.apx.active_project.name
                  : t("modules_ui.deck_none")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-fg">{t("modules_ui.deck_registered_projects")}</span>
              <span className="font-medium">{data.apx.projects.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-fg">{t("modules_ui.deck_active_plugins")}</span>
              <span className="font-medium">
                {Object.keys(data.apx.plugins).join(", ") || "—"}
              </span>
            </div>
          </div>
        </Section>
      )}
    </div>

      {/* ── "Coming soon" overlay ───────────────────────────────────────────
          Non-dismissable: there is no close button and clicking the backdrop
          does nothing. It floats over the inert Deck UI above. Remove this
          whole block (and the inert wrapper / handleToggle guard) when Deck is
          released. */}
      <div
        className="absolute inset-0 z-10 flex items-center justify-center p-6 backdrop-blur-[1px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-coming-soon-title"
        data-testid="deck-coming-soon"
      >
        <div className="w-full max-w-md rounded-2xl border border-border bg-card/95 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Construction className="size-6 text-muted-fg" />
          </div>
          <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-fg">
            {t("deck_screen.preview_badge")}
          </span>
          <h2 id="deck-coming-soon-title" className="mt-3 text-lg font-semibold">
            {t("deck_screen.preview_title")}
          </h2>
          <p className="mt-2 text-sm text-muted-fg">{t("deck_screen.preview_body")}</p>
        </div>
      </div>
    </div>
  );
}

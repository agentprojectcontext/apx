import type { SurfaceSummary } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { EmptyState, Icons, Skeleton, useApx } from "@apx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { usePack, useT } from "../i18n/index.ts";
import { PageEdit } from "../panel/BrowserEdit.tsx";
import { type EditTarget, stopEditing } from "../panel/browserEdit.ts";
import { themeCss } from "./srcdoc.ts";

/**
 * Edit mode on a widget: the core runs it in a page of its own browser, apart from the panel and from the network,
 * and the owner points at it like at a browser tab. Nothing the widget does reaches the panel.
 */
export function WidgetEdit({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  usePack("browserEdit");
  const { mode } = useApx();
  const box = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<{ id: string } | { error: "unavailable" | "failed" }>();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    let opened: string | undefined;
    // The page is drawn as wide as the picture the owner sees, so it reads at its real size.
    const width = Math.round(Math.min(2400, Math.max(240, el.clientWidth - 22)));
    client
      .call("surfaces.edit_open", { surface: surface.id, width, theme: themeCss(el), mode })
      .then(({ page: id }) => {
        opened = id;
        if (alive) setPage({ id });
        else void client.call("surfaces.edit_close", { page: id }).catch(() => {});
      })
      .catch((e: unknown) => {
        if (alive) setPage({ error: e instanceof ApxError && e.code === "unavailable" ? "unavailable" : "failed" });
      });
    return () => {
      alive = false;
      if (opened) void client.call("surfaces.edit_close", { page: opened }).catch(() => {});
    };
  }, [surface.id, mode]);

  const id = page && "id" in page ? page.id : undefined;
  const target = useMemo<EditTarget | undefined>(
    () =>
      id
        ? {
            key: `widget:${surface.id}`,
            inspect: async (x, y) => (await client.call("surfaces.edit_inspect", { page: id, x, y })).element,
            show: (edits) => client.call("surfaces.edit_preview", { page: id, edits }),
            shot: async () => {
              const r = await client.call("surfaces.edit_shot", { page: id });
              return `data:${r.mime};base64,${r.data}`;
            },
            header: (tr) => tr("bedit.request.widget", { title: surface.title, name: surface.name }),
            // Closing the page (when this view goes) drops the edits it showed.
            leave: async () => stopEditing(),
          }
        : undefined,
    [id, surface.id, surface.title, surface.name],
  );

  return (
    <div ref={box} className="widget-edit">
      {target ? (
        <PageEdit target={target} />
      ) : page && "error" in page ? (
        <EmptyState icon={<Icons.TriangleAlert />} title={t("bedit.widgetFailed")}>
          {page.error === "unavailable" ? t("bedit.widgetUnavailable") : null}
        </EmptyState>
      ) : (
        <Skeleton shape="block" height="100%" />
      )}
    </div>
  );
}

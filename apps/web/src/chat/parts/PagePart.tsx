import type { SurfaceSummary } from "@apx/protocol";
import { CodeFrame, IconButton, Icons, Menu, Skeleton } from "@apx/ui";
import { Suspense, useMemo } from "react";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { CodeView } from "../../lazy.ts";
import { PageFrame } from "../../surfaces/PageFrame.tsx";
import { openPage, pageMenu } from "../../surfaces/pageActions.tsx";

/** How tall a page shows in the chat; past it, it scrolls inside, and Expand shows it whole. */
const PAGE_IN_CHAT = 420;

/**
 * A web page an agent made, in the chat as the code frames its HTML blocks use: the page as a browser shows it, its
 * code, Copy, Expand to a screen of its own, and Edit.
 */
export function PagePart({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  const html = useData((s) => s.surfaceDocs[surface.id]?.html);
  const labels = useMemo(
    () => ({
      preview: t("md.preview"),
      source: t("md.source"),
      showAs: t("md.showAs"),
      copy: t("msg.copy"),
      copied: t("msg.copied"),
      expand: t("md.expand"),
      close: t("common.close"),
    }),
    [t],
  );
  return (
    <CodeFrame
      language="HTML"
      title={surface.title}
      code={html ?? ""}
      preview={<PageFrame surfaceId={surface.id} maxHeight={PAGE_IN_CHAT} />}
      labels={labels}
      onExpand={() => openPage(surface.id)}
      className="pagepart"
      actions={
        <>
          <IconButton
            size="sm"
            label={t("browser.edit")}
            icon={<Icons.Pencil size={14} />}
            onClick={() => openPage(surface.id, true)}
          />
          <Menu
            align="end"
            items={pageMenu(surface, t)}
            trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={14} />} />}
          />
        </>
      }
    >
      {html === undefined ? (
        <Skeleton shape="block" height={160} />
      ) : (
        <Suspense fallback={<Skeleton shape="block" height={160} />}>
          <CodeView path="page.html" text={html} editable={false} snippet />
        </Suspense>
      )}
    </CodeFrame>
  );
}

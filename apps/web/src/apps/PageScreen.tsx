import type { SurfaceSummary } from "@apx/protocol";
import { AgentAvatar, Button, IconButton, Icons, Menu, SegmentedControl, Skeleton } from "@apx/ui";
import { Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useSlice } from "../data/createStore.ts";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { CodeView } from "../lazy.ts";
import { browserEdit, startEditing, stopEditing } from "../panel/browserEdit.ts";
import { go, nav } from "../shell/nav.ts";
import { KindTile } from "../surfaces/artifactKind.tsx";
import { PageFrame } from "../surfaces/PageFrame.tsx";
import { pageMenu } from "../surfaces/pageActions.tsx";
import { ShareMenu } from "../surfaces/ShareMenu.tsx";
import { WidgetEdit } from "../surfaces/WidgetEdit.tsx";

/** A phone's width; on a computer the page takes the room it has, beside the edit panel while editing. */
const PHONE = 390;
/** The edit panel's width beside the page, from where the screen is wide enough for both (browser-edit.css). */
const PANEL = { width: 320, from: 768 };
type Width = "desktop" | "phone";
const WIDTH_KEY = "apx.pageWidth";

/** The width last chosen; the first time, the one of the screen it is seen on. */
function savedWidth(): Width {
  try {
    const saved = localStorage.getItem(WIDTH_KEY);
    if (saved === "phone" || saved === "desktop") return saved;
  } catch {}
  return window.matchMedia("(max-width: 767px)").matches ? "phone" : "desktop";
}

/**
 * A web page on a screen of its own: seen as a browser shows it at a computer's or a phone's width, its code, and edit
 * mode, where the whole page scrolls at that width beside a panel that stays put.
 */
export function PageScreen({ page }: { page: SurfaceSummary }) {
  const t = useT();
  const author = useData((s) => s.agents[page.created_by]);
  const project = useData((s) => projectName(s.projects, page.project_id));
  const html = useData((s) => s.surfaceDocs[page.id]?.html);
  const editing = useSlice(browserEdit, (s) => s.target === `widget:${page.id}`);
  const [width, setWidth] = useState<Width>(savedWidth);
  const [code, setCode] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // Measured as edit mode starts: the page is drawn as wide as it shows, so the picture reads like the page itself.
  const [room, setRoom] = useState<number>();
  useLayoutEffect(() => {
    const w = body.current?.clientWidth;
    if (editing && w) setRoom(Math.round(Math.min(2400, Math.max(320, w >= PANEL.from ? w - PANEL.width : w))));
  }, [editing]);
  const editWidth = width === "phone" ? PHONE : room;
  // Until edit mode has its picture, the page stays on screen as it is, so opening it never shows an empty screen.
  const [shown, setShown] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new edit page (on, or another width) starts unshown
  useLayoutEffect(() => setShown(false), [editing, editWidth]);
  const onShown = useCallback(() => setShown(true), []);
  const back = () => {
    stopEditing();
    nav.set({ view: "inbox" });
  };
  // A request for the agent waits in the page's own chat: the owner goes there to send it.
  const asked = useCallback((thread: string) => go.thread(thread), []);
  const pick = (w: Width) => {
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, w);
    } catch {}
  };
  return (
    <section className="appscreen pagescreen" aria-label={page.title}>
      <header className="appscreen__head">
        <IconButton label={t("common.back")} icon={<Icons.ArrowLeft size={16} />} onClick={back} />
        <span className="pagescreen__tile">
          <KindTile kind="page" size={28} />
        </span>
        <div className="appscreen__titles">
          <div className="appscreen__title">{page.title}</div>
          <div className="appscreen__sub">
            {author && <AgentAvatar name={author.name} blob={blobOf(author)} size={14} animated={false} />}
            {t("page.sub", { project, author: author?.name ?? page.created_by })}
          </div>
        </div>
        <SegmentedControl
          size="sm"
          label={t("page.width")}
          value={width}
          onValueChange={(v) => pick(v === "phone" ? "phone" : "desktop")}
          className="pagescreen__widths"
          options={[
            {
              value: "desktop",
              label: <span className="pagescreen__label">{t("page.desktop")}</span>,
              icon: <Icons.Monitor size={14} />,
            },
            {
              value: "phone",
              label: <span className="pagescreen__label">{t("page.phone")}</span>,
              icon: <Icons.Smartphone size={14} />,
            },
          ]}
        />
        <Button
          size="sm"
          variant={code ? "secondary" : "ghost"}
          aria-pressed={code}
          leadingIcon={<Icons.Code size={14} />}
          onClick={() => {
            setCode(!code);
            if (!code) stopEditing();
          }}
        >
          {t("md.source")}
        </Button>
        <Button
          size="sm"
          variant={editing ? "primary" : "secondary"}
          aria-pressed={editing}
          leadingIcon={<Icons.Pencil size={14} />}
          onClick={() => {
            if (editing) stopEditing();
            else {
              setCode(false);
              startEditing(`widget:${page.id}`);
            }
          }}
        >
          {t("browser.edit")}
        </Button>
        <ShareMenu surface={page} variant="icon" />
        <Menu
          align="end"
          items={pageMenu(page, t, { share: false })}
          trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={16} />} />}
        />
      </header>
      <div ref={body} className="appscreen__body pagescreen__body">
        {code ? (
          html === undefined ? (
            <Skeleton shape="block" height="100%" />
          ) : (
            <div className="pagescreen__code">
              <Suspense fallback={<Skeleton shape="block" height="100%" />}>
                <CodeView path="page.html" text={html} editable={false} />
              </Suspense>
            </div>
          )
        ) : editing ? (
          <>
            {!shown && (
              <div className={`pagescreen__view pagescreen__view--${width}`}>
                <div className="pagescreen__preparing" role="status">
                  {t("page.preparing")}
                </div>
                <PageFrame surfaceId={page.id} fit="fill" {...(width === "phone" ? { width: PHONE } : {})} />
              </div>
            )}
            {editWidth ? (
              <div className={shown ? "pagescreen__edit" : "pagescreen__edit pagescreen__edit--hidden"}>
                <WidgetEdit key={editWidth} surface={page} width={editWidth} asked={asked} ready={onShown} />
              </div>
            ) : null}
          </>
        ) : (
          <div className={`pagescreen__view pagescreen__view--${width}`}>
            <PageFrame surfaceId={page.id} fit="fill" {...(width === "phone" ? { width: PHONE } : {})} />
          </div>
        )}
      </div>
    </section>
  );
}

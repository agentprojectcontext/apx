import "../styles/browser-edit.css";
import type { PickedElement, TabInfo } from "@apx/protocol";
import { Button, EmptyState, Field, IconButton, Icons, Input, Skeleton, Textarea } from "@apx/ui";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { screenshot } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { useSlice } from "../data/createStore.ts";
import { draftOf, keepDraft } from "../data/drafts.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { t as tr, usePack, useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import {
  browserEdit,
  changeItem,
  type EditItem,
  type EditStyle,
  type EditTarget,
  editRequest,
  editsOf,
  elementLabel,
  hexOf,
  isChanged,
  pageHeader,
  pick,
  removeItem,
  select,
  stopEditing,
} from "./browserEdit.ts";

const POLL_MS = 1500;
const SHOW_DELAY_MS = 250;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Point = { x: number; y: number };

/** Leaves edit mode on a tab; the page goes back to what its own code shows. */
export async function leaveEditing(tab: string): Promise<void> {
  stopEditing();
  await client.call("browser.preview_edits", { tab, edits: [] }).catch(() => {});
}

/** Edit mode on a browser tab: its page through the browser node. */
export function BrowserEdit({ tab }: { tab: TabInfo }) {
  const id = tab.tab;
  const url = tab.url;
  const target = useMemo<EditTarget>(
    () => ({
      key: id,
      inspect: async (x, y) => (await client.call("browser.inspect", { tab: id, x, y })).element,
      show: (edits) => client.call("browser.preview_edits", { tab: id, edits }),
      shot: () => screenshot(id),
      header: (t) => pageHeader(url, t),
      leave: () => leaveEditing(id),
    }),
    [id, url],
  );
  return <PageEdit target={target} />;
}

/**
 * Edit mode: the page as a picture the owner points at (an element lights up under the pointer, a click picks it),
 * and beside it the panel where they change its text and look, seen live, then ask the chat's agent for it.
 */
export function PageEdit({ target }: { target: EditTarget }) {
  const ready = usePack("browserEdit");
  const items = useSlice(browserEdit, (s) => s.items);
  const selected = useSlice(browserEdit, (s) => s.selected);
  const [shot, refresh] = useShot(target);
  const [hover, setHover] = useState<PickedElement | null>(null);
  const inspect = useInspector(target);
  const item = items.find((i) => i.element.node === selected);
  const changed = items.filter(isChanged);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void target.leave();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  // Every change shows in the page a moment after the owner stops typing; the picture follows.
  const edits = JSON.stringify(editsOf(items));
  const shown = useRef("[]");
  useEffect(() => {
    if (edits === shown.current) return;
    const timer = setTimeout(() => {
      target
        .show(JSON.parse(edits))
        .then(() => {
          shown.current = edits;
          refresh();
        })
        .catch((e) => notify(tr("bedit.failed", { error: errText(e) })));
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [edits, target, refresh]);

  if (!ready) return <Skeleton shape="block" height="100%" />;
  const at = (e: MouseEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  return (
    <div className="bedit-host">
      <div className="bedit">
        <div className="bedit__page">
          <div className="bedit__hint" role="status">
            {tr("bedit.pickHint")}
          </div>
          {shot ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: picking by pointer over a picture of the page; the panel holds the keyboard path
            // biome-ignore lint/a11y/useKeyWithClickEvents: Escape leaves; the picked elements are listed in the panel
            <div
              className="bedit__shot"
              onMouseMove={(e) => inspect(at(e)).then(setHover)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) =>
                void inspect(at(e), true).then((el) => {
                  if (el) pick(el);
                })
              }
            >
              <img src={shot} alt={tr("bedit.page")} draggable={false} />
              {hover?.box && <span className="bedit__box is-hover" style={boxStyle(hover.box)} />}
              {changed.map((i, n) =>
                i.element.box ? (
                  <span
                    key={i.element.node}
                    className={i.element.node === selected ? "bedit__box is-selected" : "bedit__box"}
                    style={boxStyle(i.element.box)}
                  >
                    <span className="bedit__num">{n + 1}</span>
                  </span>
                ) : null,
              )}
              {item?.element.box && !isChanged(item) && (
                <span className="bedit__box is-selected" style={boxStyle(item.element.box)} />
              )}
            </div>
          ) : (
            <Skeleton shape="block" height="100%" />
          )}
        </div>
        <EditPanel target={target} changed={changed} item={item} />
      </div>
    </div>
  );
}

function EditPanel({ target, changed, item }: { target: EditTarget; changed: EditItem[]; item: EditItem | undefined }) {
  const t = useT();
  const threadId = useNav((s) => s.threadId);
  const agentName = useData((s) => {
    const id = threadId ? s.threads[threadId]?.agent_ids[0] : undefined;
    return id ? s.agents[id]?.name : undefined;
  });
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const picked = item?.element.node;
  // A newly picked element shows its fields from the top.
  useEffect(() => {
    if (picked !== undefined) panel.current?.scrollTo({ top: 0 });
  }, [picked]);
  // Where the page can be saved, what the owner changed goes straight into it; the agent gets only what they wrote.
  const direct = target.save ? editsOf(changed) : [];
  const forAgent = target.save ? changed.filter((i) => i.note.trim()) : changed;
  const canFinish = changed.length > 0 && !busy && (threadId !== undefined || !forAgent.length);
  const finish = async () => {
    if (!canFinish) return;
    let left = forAgent;
    let saved = 0;
    if (target.save && direct.length) {
      setBusy(true);
      try {
        const r = await target.save(direct);
        const done = new Set(r.saved);
        saved = done.size;
        // A part its code draws when it runs is not in the page's HTML: its agent changes it.
        left = changed
          .filter((i) => i.note.trim() || !done.has(i.element.node))
          .map((i) => (done.has(i.element.node) ? { ...i, text: undefined, style: {} } : i));
      } catch (e) {
        notify(tr("bedit.saveFailed", { error: errText(e) }));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (left.length && threadId) {
      const request = editRequest(target.header(tr), left, tr);
      const draft = draftOf(threadId).trim();
      keepDraft(threadId, draft ? `${request}\n\n${draft}` : `${request}\n\n`);
    }
    void target.leave();
    // On a phone the panel covers the chat: go back to it, where the request waits to be sent.
    if (left.length && window.matchMedia("(max-width: 767px)").matches) nav.set({ panel: null });
    notify(tr(left.length ? (saved ? "bedit.savedAsked" : "bedit.asked") : "bedit.saved"), "info");
  };
  const name = agentName ?? "";
  const label = target.save
    ? forAgent.length
      ? direct.length
        ? agentName
          ? t("bedit.saveAsk", { name })
          : t("bedit.saveAskAgent")
        : agentName
          ? t("bedit.ask", { name })
          : t("bedit.askAgent")
      : t("bedit.save")
    : agentName
      ? changed.length > 1
        ? t("bedit.askCount", { name, n: changed.length })
        : t("bedit.ask", { name })
      : t("bedit.askAgent");
  return (
    <aside ref={panel} className="bedit__panel" aria-label={t("browser.edit")}>
      {item ? (
        <ItemForm key={item.element.node} item={item} saves={Boolean(target.save)} />
      ) : (
        <EmptyState icon={<Icons.Pencil />} title={t("bedit.emptyTitle")}>
          {t("bedit.emptyBody")}
        </EmptyState>
      )}
      {changed.length > 0 && (
        <section className="bedit__list" aria-label={t("bedit.list")}>
          <h4 className="bedit__listtitle">{t("bedit.list")}</h4>
          {changed.map((i, n) => (
            <div key={i.element.node} className="bedit__row">
              <button
                type="button"
                className={item?.element.node === i.element.node ? "bedit__rowpick is-selected" : "bedit__rowpick"}
                onClick={() => select(i.element.node)}
              >
                <span className="bedit__rownum">{n + 1}</span>
                <span className="bedit__rowname">{elementLabel(i.element) || t("bedit.request.unnamed")}</span>
                <span className="bedit__rowstate">{t("bedit.changed")}</span>
              </button>
              <IconButton
                size="sm"
                label={t("bedit.remove")}
                icon={<Icons.X size={13} />}
                onClick={() => removeItem(i.element.node)}
              />
            </div>
          ))}
        </section>
      )}
      <footer className="bedit__actions">
        {!threadId && forAgent.length > 0 && <p className="bedit__muted">{t("bedit.noChat")}</p>}
        <Button disabled={!canFinish} onClick={() => void finish()}>
          {label}
        </Button>
        <Button variant="secondary" onClick={() => void target.leave()}>
          {t("bedit.discard")}
        </Button>
      </footer>
    </aside>
  );
}

function ItemForm({ item, saves }: { item: EditItem; saves: boolean }) {
  const t = useT();
  const { element } = item;
  const node = element.node;
  const setStyle = (change: Partial<EditStyle>) => changeItem(node, { style: { ...item.style, ...change } });
  return (
    <div className="bedit__form">
      <header>
        <h3 className="bedit__title">{elementLabel(element) || t("bedit.request.unnamed")}</h3>
      </header>
      {element.sensitive ? (
        <p className="bedit__muted">{t("bedit.sensitive")}</p>
      ) : (
        <>
          {element.text !== null && (
            <Field label={t("bedit.text")}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={item.text ?? element.text ?? ""}
                  onChange={(e) => changeItem(node, { text: e.currentTarget.value })}
                />
              )}
            </Field>
          )}
          <div className="bedit__pair">
            <ColorField
              label={t("bedit.color")}
              value={item.style.color}
              page={element.style.color}
              onChange={(color) => setStyle({ color })}
            />
            <ColorField
              label={t("bedit.background")}
              value={item.style.background}
              page={element.style.background}
              onChange={(background) => setStyle({ background })}
            />
          </div>
          <div className="bedit__pair">
            <PxField
              label={t("bedit.size")}
              value={item.style.font_size}
              page={element.style.font_size}
              min={6}
              onChange={(font_size) => setStyle({ font_size })}
            />
            <PxField
              label={t("bedit.padding")}
              value={item.style.padding}
              page={element.style.padding}
              min={0}
              onChange={(padding) => setStyle({ padding })}
            />
          </div>
        </>
      )}
      <Field label={t("bedit.note")} hint={saves ? t("bedit.noteHint") : undefined}>
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            placeholder={t("bedit.notePlaceholder")}
            value={item.note}
            onChange={(e) => changeItem(node, { note: e.currentTarget.value })}
          />
        )}
      </Field>
      {!element.sensitive && <p className="bedit__muted">{t(saves ? "bedit.liveSave" : "bedit.live")}</p>}
    </div>
  );
}

function ColorField(props: {
  label: string;
  value: string | undefined;
  page: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const t = useT();
  return (
    <Field label={props.label}>
      {(id) => (
        <span className="bedit__color">
          <input
            id={id}
            type="color"
            className="bedit__swatch"
            value={props.value ?? hexOf(props.page)}
            onChange={(e) => props.onChange(e.currentTarget.value)}
          />
          <span className="bedit__hex">{(props.value ?? hexOf(props.page)).toUpperCase()}</span>
          {props.value && (
            <IconButton
              size="sm"
              label={t("bedit.reset")}
              icon={<Icons.RotateCcw size={12} />}
              onClick={() => props.onChange(undefined)}
            />
          )}
        </span>
      )}
    </Field>
  );
}

function PxField(props: {
  label: string;
  value: number | undefined;
  page: number | undefined;
  min: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Field label={props.label}>
      {(id) => (
        <Input
          id={id}
          type="number"
          min={props.min}
          max={200}
          trailing="px"
          value={String(props.value ?? props.page ?? "")}
          onChange={(e) => {
            const n = Math.round(Number(e.currentTarget.value));
            props.onChange(
              e.currentTarget.value === "" || !Number.isFinite(n) ? undefined : Math.min(200, Math.max(props.min, n)),
            );
          }}
        />
      )}
    </Field>
  );
}

/** A picture of the tab, taken again every few seconds and right after `refresh()`. */
function useShot(target: EditTarget): [string | undefined, () => void] {
  const [src, setSrc] = useState<string>();
  const now = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const take = async () => {
      clearTimeout(timer);
      const next = await target.shot().catch(() => undefined);
      if (!alive) return;
      if (next) setSrc(next);
      clearTimeout(timer);
      timer = setTimeout(take, POLL_MS);
    };
    now.current = () => void take();
    void take();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [target]);
  return [src, useCallback(() => now.current(), [])];
}

/**
 * Asks the page what lies under a point. Hover asks one at a time and only for the latest point; a click always asks.
 * Nothing under the point, or a failed ask, answers null.
 */
function useInspector(target: EditTarget) {
  const busy = useRef(false);
  const last = useRef<PickedElement | null>(null);
  return useCallback(
    async (p: Point, force = false): Promise<PickedElement | null> => {
      if (busy.current && !force) return last.current;
      busy.current = true;
      try {
        const element = await target.inspect(p.x, p.y);
        last.current = element;
        return element;
      } catch {
        return null;
      } finally {
        busy.current = false;
      }
    },
    [target],
  );
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

function boxStyle(b: NonNullable<PickedElement["box"]>) {
  return { left: pct(b.x), top: pct(b.y), width: pct(b.width), height: pct(b.height) };
}

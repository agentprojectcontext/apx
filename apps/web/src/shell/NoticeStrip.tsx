import "../styles/corner.css";
import { Button, IconButton, Icons, ProjectTile } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { useNotices } from "./notices.tsx";

/**
 * The notices with the full sidebar: one at a time in a strip over the page (never over the sidebar), tinted by its
 * tone, its action at the right, and ‹ 1 of N › to step through the rest.
 */
export function NoticeStrip() {
  const t = useT();
  const notices = useNotices();
  const [at, setAt] = useState(0);
  const n = notices.length;
  if (!n) return null;
  const i = ((at % n) + n) % n;
  const notice = notices[i];
  if (!notice) return null;
  return (
    <aside className={`noticestrip is-${notice.tone}`} aria-label={t("corner.label")} data-card={notice.id}>
      <ProjectTile tone={notice.tone} size={22} icon={notice.icon(12)} />
      <div className="noticestrip__text" title={notice.description}>
        <span className="noticestrip__title">{notice.title}</span>
        <span className="noticestrip__desc" role={notice.alert ? "alert" : undefined}>
          {notice.description}
          {notice.link && (
            <>
              {" "}
              <a href={notice.link.href} target="_blank" rel="noopener noreferrer">
                {notice.link.label}
              </a>
            </>
          )}
        </span>
      </div>
      {notice.extra}
      {notice.secondary && (
        <Button size="sm" variant="ghost" className="noticestrip__btn" onClick={notice.onClose}>
          {notice.secondary}
        </Button>
      )}
      {notice.action && (
        <Button
          size="sm"
          className="noticestrip__btn"
          loading={notice.busy}
          onClick={() => {
            notice.onAction?.();
            if (!notice.keep) notice.onClose();
          }}
        >
          {notice.action}
        </Button>
      )}
      <span className="noticestrip__sep" aria-hidden="true" />
      {n > 1 && (
        <div className="noticestrip__pager">
          <IconButton
            size="sm"
            label={t("notice.prev")}
            icon={<Icons.ChevronLeft size={14} />}
            onClick={() => setAt(i - 1)}
          />
          <span className="noticestrip__pos">{t("notice.pos", { i: i + 1, n })}</span>
          <IconButton
            size="sm"
            label={t("notice.next")}
            icon={<Icons.ChevronRight size={14} />}
            onClick={() => setAt(i + 1)}
          />
        </div>
      )}
      <IconButton
        size="sm"
        label={t("notice.dismiss")}
        icon={<Icons.X size={14} />}
        onClick={() => {
          notice.onClose();
          setAt(i);
        }}
      />
    </aside>
  );
}

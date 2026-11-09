import "../chat/EmailCard.css";
import { Button, Icons, ProjectTile } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

/** Height of a long mail before "Show all". */
const FOLDED_PX = 420;

/**
 * The frame's own rules: nothing loads from outside but pictures, and those only once the owner asks (a remote
 * picture tells the sender the mail was opened). Links open outside the panel.
 */
const frameDoc = (html: string, images: boolean) =>
  [
    "<!doctype html><html><head><meta charset='utf-8'>",
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: cid:${images ? " https: http:" : ""}">`,
    "<base target='_blank'>",
    "<style>html{color-scheme:light;background:Canvas;color:CanvasText;overflow-y:hidden}body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>",
    "</head><body>",
    html,
    "</body></html>",
  ].join("");

/**
 * A mail someone sent to an Email account, as their mail app showed it: its subject, sender and date, then its
 * formatted body in a closed frame (no scripts run in it) with pictures off until the owner shows them.
 */
export function ReceivedMail({
  from,
  subject,
  at,
  htmlId,
}: {
  from: string;
  subject: string;
  at: string;
  htmlId: string;
}) {
  const t = useT();
  const [html, setHtml] = useState<string>();
  const [images, setImages] = useState(false);
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(160);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let stop = false;
    void client.call("media.get", { id: htmlId }).then(
      ({ data }) => {
        if (stop) return;
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        setHtml(new TextDecoder().decode(bytes));
      },
      () => !stop && setHtml(""),
    );
    return () => {
      stop = true;
    };
  }, [htmlId]);
  // Same origin without scripts: the panel can measure the mail, the mail cannot reach the panel.
  const measure = () => {
    const doc = frame.current?.contentDocument;
    const page = doc?.documentElement;
    if (!doc?.body || !page) return;
    // A mail laid out wider than the card (a 600 px newsletter on a phone) is shrunk to fit, as mail apps do.
    doc.body.style.zoom = "";
    if (page.scrollWidth > page.clientWidth + 1) doc.body.style.zoom = String(page.clientWidth / page.scrollWidth);
    setHeight(page.scrollHeight);
  };
  const tall = height > FOLDED_PX;
  return (
    <div className="mailcard mailview">
      <div className="mailcard__head">
        <ProjectTile tone="neutral" size={28} icon={<Icons.Mail size={15} />} />
        <div className="mailcard__title">{subject || t("mail.noSubject")}</div>
      </div>
      <dl className="mailcard__fields">
        <dt>{t("mail.from")}</dt>
        <dd>{from}</dd>
        <dt>{t("mail.date")}</dt>
        <dd>{shortWhen(at)}</dd>
      </dl>
      {!images && (
        <div className="mailview__images">
          <span>{t("mail.imagesOff")}</span>
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Image size={14} />} onClick={() => setImages(true)}>
            {t("mail.showImages")}
          </Button>
        </div>
      )}
      {html === undefined ? null : (
        <iframe
          ref={frame}
          title={subject || t("mail.noSubject")}
          className="mailview__frame"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={frameDoc(html, images)}
          onLoad={measure}
          style={{ height: open || !tall ? height : FOLDED_PX }}
        />
      )}
      {tall && (
        <Button variant="link" size="sm" className="mailcard__more" onClick={() => setOpen(!open)}>
          {open ? t("mail.less") : t("mail.more")}
        </Button>
      )}
    </div>
  );
}

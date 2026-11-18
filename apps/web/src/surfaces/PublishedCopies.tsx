import type { SurfaceSummary } from "@apx/protocol";
import { Button, Dialog, Select, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { formatBytes } from "../common/format.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, usePack, useT } from "../i18n/index.ts";
import { publicError } from "./publicErrors.ts";
import { openPublicCopy } from "./publicRequest.ts";
import "../styles/public-copies.css";

type List = Awaited<ReturnType<typeof listCopies>>;
const listCopies = () => client.call("surfaces.public_list", {});
type Copy = List["items"][number];

export function PublishedCopies() {
  const ready = usePack("publicCopies");
  return ready ? <CopyList /> : <Skeleton width="100%" height={60} />;
}

function CopyList() {
  const t = useT();
  const [list, setList] = useState<List>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<MessageKey>();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Copy>();
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("apx-public-copies-changed", refresh);
    return () => window.removeEventListener("apx-public-copies-changed", refresh);
  }, []);
  useEffect(() => {
    let live = true;
    if (revision === 0) setList(undefined);
    setBusy(true);
    setError(undefined);
    void listCopies()
      .then((value) => {
        if (live) setList(value);
      })
      .catch((e: unknown) => {
        if (live) setError(publicError(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <section aria-label={t("public.list")}>
      <h3>{t("public.list")}</h3>
      <p>{t("public.local")}</p>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => setRevision((n) => n + 1)}>
        {t("public.refresh")}
      </Button>
      {busy && !list && <Skeleton width="100%" height={60} />}
      {busy && list && <p role="status">{t("public.refreshing")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      {list?.items.length === 0 && <p>{t("public.empty")}</p>}
      {list?.items.map((item) => (
        <div key={item.code} className="public-copies__row public-copy">
          <strong>{item.title}</strong>
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.url}
          </a>
          <span>
            <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleString()}</time> ·{" "}
            {formatBytes(item.bytes)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setSelected(item)}>
            {t("public.manage")}
          </Button>
        </div>
      ))}
      {selected && <ManageCopy copy={selected} onClose={() => setSelected(undefined)} />}
    </section>
  );
}

function ManageCopy({ copy, onClose }: { copy: Copy; onClose: () => void }) {
  const t = useT();
  const [sources, setSources] = useState<SurfaceSummary[]>();
  const [source, setSource] = useState("");
  const [error, setError] = useState<MessageKey>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    if (revision > 0) setError(undefined);
    void client
      .call("surfaces.list", {})
      .then((value) => {
        if (live) {
          setSources(value.surfaces);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(publicError(e));
      });
    return () => {
      live = false;
    };
  }, [revision]);
  const launch = (action: "update" | "revoke") => {
    onClose();
    openPublicCopy({ action, code: copy.code, ...(action === "update" ? { surface: source } : {}) });
  };
  return (
    <Dialog
      open
      title={copy.title}
      size="md"
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && onClose()}
    >
      <div className="public-copy">
        <a href={copy.url} target="_blank" rel="noreferrer">
          {copy.url}
        </a>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(copy.url).then(
              () => notify(t("share.copied"), "info"),
              () => notify(t("share.copyFailed")),
            )
          }
        >
          {t("share.copy")}
        </Button>
        <p>{t("public.local")}</p>
        <p>{t("public.missing")}</p>
        {!sources && !error && <Skeleton width="100%" height={32} />}
        {error && (
          <p role="alert">
            {t(error)}{" "}
            <Button variant="link" onClick={() => setRevision((n) => n + 1)}>
              {t("public.retry")}
            </Button>
          </p>
        )}
        {sources && (
          <Select
            label={t("public.source")}
            value={source}
            placeholder={t("public.source")}
            onValueChange={(value) => setSource(value ?? "")}
            options={sources.map((item) => ({ value: item.id, label: item.title }))}
          />
        )}
        <p>{t("public.replace")}</p>
        <div className="public-copies__actions">
          <Button disabled={!source} onClick={() => launch("update")}>
            {t("public.update")}…
          </Button>
          <Button variant="secondary" onClick={() => launch("revoke")}>
            {t("public.revoke")}…
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

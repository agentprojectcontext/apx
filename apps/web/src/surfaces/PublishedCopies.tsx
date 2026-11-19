import type { SurfaceSummary } from "@apx/protocol";
import { Button, Card, Dialog, IconButton, Icons, Select, Skeleton } from "@apx/ui";
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
    <section aria-label={t("public.list")} className="public-copies">
      <div className="public-copies__head">
        <h3>{t("public.list")}</h3>
        <IconButton
          size="sm"
          label={t("public.refresh")}
          icon={<Icons.RefreshCw size={14} />}
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        />
      </div>
      {busy && !list && <Skeleton width="100%" height={60} />}
      {busy && list && <p role="status">{t("public.refreshing")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      {list?.items.length === 0 && <p className="public-copy__muted">{t("public.empty")}</p>}
      {list && list.items.length > 0 && (
        <div className="public-copies__grid">
          {list.items.map((item) => (
            <CopyCard key={item.code} item={item} onChoose={() => setSelected(item)} />
          ))}
        </div>
      )}
      {selected && <ManageCopy copy={selected} onClose={() => setSelected(undefined)} />}
    </section>
  );
}

/** One published copy: what it is, its link, and each thing the owner can do with it in view. */
function CopyCard({ item, onChoose }: { item: Copy; onChoose: () => void }) {
  const t = useT();
  const copy = () =>
    void navigator.clipboard.writeText(item.url).then(
      () => notify(t("share.copied"), "info"),
      () => notify(t("share.copyFailed")),
    );
  return (
    <Card
      variant="outline"
      padding="sm"
      className="public-copies__card"
      title={item.title}
      description={
        <>
          <time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleDateString()}</time> ·{" "}
          {formatBytes(item.bytes)}
        </>
      }
    >
      <a className="public-copies__url" href={item.url} target="_blank" rel="noreferrer">
        {item.url.replace(/^https:\/\//, "")}
      </a>
      <div className="public-copies__actions">
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Copy size={14} />} onClick={copy}>
          {t("public.copyLink")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.RefreshCw size={14} />}
          onClick={() =>
            item.surface ? openPublicCopy({ action: "update", code: item.code, surface: item.surface }) : onChoose()
          }
        >
          {t("share.update")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.EyeOff size={14} />}
          className="public-copies__stop"
          onClick={() => openPublicCopy({ action: "revoke", code: item.code })}
        >
          {t("share.stop")}
        </Button>
      </div>
    </Card>
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
        </div>
      </div>
    </Dialog>
  );
}

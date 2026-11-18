import { publicPreviewDocument } from "@apx/surfaces/public-preview";
import { Button, Checkbox, Dialog, SettingRow, Spinner } from "@apx/ui";
import { useMemo } from "react";
import { formatBytes } from "../common/format.ts";
import { useT } from "../i18n/index.ts";
import { closePublicCopy, type usePublicRequest } from "./publicRequest.ts";
import { usePublicCopy } from "./usePublicCopy.ts";
import "../styles/public-copies.css";

type Request = NonNullable<ReturnType<typeof usePublicRequest>>;

export function PublicCopyDialog({ request }: { request: Request }) {
  const t = useT();
  const { source, account, keys, setKeys, review, busy, error, invalid, setReload, prepare, commit, back } =
    usePublicCopy(request);
  const preview = useMemo(
    () => review?.bundle && publicPreviewDocument(review.bundle.html, review.bundle.state),
    [review],
  );
  const action = review?.action ?? request.action;
  const actionKey = action === "revoke" ? "public.revoke" : action === "update" ? "public.update" : "public.publish";
  return (
    <Dialog
      open
      size="lg"
      title={t(review ? "public.reviewTitle" : actionKey)}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && !busy && closePublicCopy()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={closePublicCopy}>
            {t("common.cancel")}
          </Button>
          {review && source && (
            <Button variant="secondary" disabled={busy} onClick={() => void back()}>
              {t("public.back")}
            </Button>
          )}
          {review ? (
            <Button loading={busy} disabled={invalid} onClick={() => void commit()}>
              {t(actionKey)}
            </Button>
          ) : (
            <Button loading={busy} disabled={!source || Boolean(error)} onClick={() => void prepare()}>
              {t("public.review")}
            </Button>
          )}
        </>
      }
    >
      <div className="public-copy">
        {busy && (
          <p role="status">
            <Spinner size={16} /> {t("public.loading")}
          </p>
        )}
        {error && (
          <p role="alert">
            {t(error)}{" "}
            {error === "public.connection" && !review && (
              <Button variant="link" onClick={() => setReload((n) => n + 1)}>
                {t("public.retry")}
              </Button>
            )}
          </p>
        )}
        {(review?.account ?? account) && (
          <p>{t("public.identity", { name: (review?.account ?? account)?.name ?? "" })}</p>
        )}
        <h3>{review?.title ?? source?.title}</h3>
        {action === "update" && <p>{t("public.replace")}</p>}
        {review && (
          <>
            <a href={review.url} target="_blank" rel="noreferrer">
              {review.url}
            </a>
            <p>{formatBytes(review.bytes)}</p>
          </>
        )}
        {action === "revoke" ? (
          <p>{t("public.revokeWarning")}</p>
        ) : (
          <>
            <p>{t("public.warning")}</p>
            {!review && source && (
              <>
                <p>{t("public.page")}</p>
                <h4>{t("public.state")}</h4>
                {Object.entries(source.state ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <Checkbox
                      label={key}
                      checked={keys.includes(key)}
                      disabled={busy}
                      onCheckedChange={(on) =>
                        setKeys((cur) => (on ? [...cur, key] : cur.filter((item) => item !== key)))
                      }
                    />
                    <details>
                      <summary>{t("public.contents")}</summary>
                      <pre>{JSON.stringify(value, null, 2)}</pre>
                    </details>
                  </div>
                ))}
              </>
            )}
            {review?.bundle && (
              <>
                <SettingRow
                  title={review.bundle.manifest.title}
                  description={String(review.bundle.manifest.version ?? "")}
                />
                <iframe
                  className="public-copy__preview"
                  title={t("public.preview")}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  srcDoc={preview}
                />
                <details>
                  <summary>{t("public.html")}</summary>
                  <pre>{review.bundle.html}</pre>
                </details>
                <h4>{t("public.state")}</h4>
                <pre>{JSON.stringify(review.bundle.state ?? {}, null, 2)}</pre>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

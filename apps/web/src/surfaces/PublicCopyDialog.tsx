import { publicPreviewDocument } from "@apx/surfaces/public-preview";
import { Button, Checkbox, Dialog, GoogleMark, SettingRow, Spinner } from "@apx/ui";
import { useEffect, useMemo, useRef } from "react";
import { formatBytes } from "../common/format.ts";
import { GoogleSignal } from "../common/GoogleSignal.tsx";
import { useCloudAccount } from "../config/useCloudAccount.ts";
import { accountError } from "../data/account.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { closePublicCopy, type usePublicRequest } from "./publicRequest.ts";
import { usePublicCopy } from "./usePublicCopy.ts";
import "../styles/public-copies.css";

type Request = NonNullable<ReturnType<typeof usePublicRequest>>;
type Account = ReturnType<typeof useCloudAccount>;

/**
 * Anyone with the link: a copy of the artifact at apxagent.app. Signed out, the same dialog signs in first (APX joined
 * to Google) and carries on when the browser is done; signed in, it goes straight to what goes in the copy.
 */
export function PublicCopyDialog({ request }: { request: Request }) {
  // A card an agent prepared or a copy being stopped already belongs to the account; the rest may need to sign in.
  if (request.draft || request.action === "revoke") return <CopyDialog request={request} />;
  return <SignedIn request={request} />;
}

function SignedIn({ request }: { request: Request }) {
  const account = useCloudAccount();
  if (account.profile) return <CopyDialog request={request} onSignedOut={account.reload} />;
  return <SignInDialog account={account} />;
}

function SignInDialog({ account }: { account: Account }) {
  const t = useT();
  const { loading, available, waiting, busy, error } = account;
  const state = waiting ? "connecting" : error != null ? "broken" : "idle";
  return (
    <Dialog
      open
      size="sm"
      title={t("share.anyone")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && closePublicCopy()}
      footer={
        <>
          {waiting && (
            <Button variant="link" disabled={busy} onClick={() => void account.start()}>
              {t("public.reopen")}
            </Button>
          )}
          <Button variant="secondary" onClick={closePublicCopy}>
            {t("common.cancel")}
          </Button>
          {!waiting && available && (
            <Button leadingIcon={<GoogleMark />} loading={busy} onClick={() => void account.start()}>
              {t("public.continueGoogle")}
            </Button>
          )}
        </>
      }
    >
      <div className="public-copy public-copy--signin">
        {loading ? (
          <Spinner size={18} />
        ) : (
          <>
            <GoogleSignal state={state} label={waiting ? t("public.waiting") : undefined} />
            <p>{t("public.signIn")}</p>
            {!waiting && (
              <p className="public-copy__muted">{t(available ? "public.signInLead" : "account.unavailable")}</p>
            )}
            {error != null && <p role="alert">{accountError(t, error)}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

async function copyLink(url: string, copied: string, failed: string) {
  try {
    await navigator.clipboard.writeText(url);
    notify(copied, "info");
  } catch {
    notify(failed);
  }
}

function CopyDialog({ request, onSignedOut }: { request: Request; onSignedOut?: () => void }) {
  const t = useT();
  const { source, account, keys, setKeys, review, done, busy, error, invalid, setReload, prepare, commit, back } =
    usePublicCopy(request);
  const preview = useMemo(
    () => review?.bundle && publicPreviewDocument(review.bundle.html, review.bundle.state),
    [review],
  );
  // The session ended meanwhile: the dialog goes back to signing in instead of sending the owner to Settings.
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;
  useEffect(() => {
    if (error === "public.signIn") signedOut.current?.();
  }, [error]);
  const action = review?.action ?? request.action;
  const actionKey = action === "revoke" ? "public.revoke" : action === "update" ? "public.update" : "public.publish";
  const title = done
    ? t("public.done")
    : review
      ? t("public.reviewTitle")
      : action === "publish"
        ? t("share.anyone")
        : t(actionKey);
  const name = (review?.account ?? account)?.name;
  const stateKeys = Object.entries(source?.state ?? {});
  if (done)
    return (
      <Dialog
        open
        size="md"
        title={title}
        closeLabel={t("common.close")}
        onOpenChange={(open) => !open && closePublicCopy()}
        footer={
          <>
            <Button variant="secondary" onClick={() => window.open(done.url, "_blank", "noopener,noreferrer")}>
              {t("public.openLink")}
            </Button>
            <Button onClick={closePublicCopy}>{t("public.finish")}</Button>
          </>
        }
      >
        <div className="public-copy">
          <div className="public-copy__link">
            {/* A line breaks only before the copy's code, never inside it. */}
            <span>
              {done.url.slice(0, done.url.lastIndexOf("/") + 1)}
              <wbr />
              {done.url.slice(done.url.lastIndexOf("/") + 1)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void copyLink(done.url, t("share.copied"), t("share.copyFailed"))}
            >
              {t("public.copyLink")}
            </Button>
          </div>
          <p className="public-copy__muted">{t("public.doneHint")}</p>
        </div>
      </Dialog>
    );
  return (
    <Dialog
      open
      size="lg"
      title={title}
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
          <p role="alert" className="public-copy__alert">
            {t(error)}{" "}
            {error === "public.connection" && !review && (
              <Button variant="link" onClick={() => setReload((n) => n + 1)}>
                {t("public.retry")}
              </Button>
            )}
          </p>
        )}
        {name && <p className="public-copy__muted">{t("public.identity", { name })}</p>}
        {review && <h3>{review.title}</h3>}
        {action === "update" && <p>{t("public.replace")}</p>}
        {review && (
          <>
            <a href={review.url} target="_blank" rel="noreferrer">
              {review.url}
            </a>
            <p className="public-copy__muted">{formatBytes(review.bytes)}</p>
          </>
        )}
        {action === "revoke" ? (
          <p>{t("public.revokeWarning")}</p>
        ) : (
          <>
            {!review && source && (
              <>
                <p>{t("public.snapshot", { title: source.title })}</p>
                {stateKeys.length > 0 && <h4>{t("public.state")}</h4>}
                {stateKeys.map(([key, value]) => (
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
            {review && <p>{t("public.warning")}</p>}
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

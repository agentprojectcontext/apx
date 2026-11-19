import { publicPreviewDocument } from "@apx/surfaces/public-preview";
import { Button, Dialog, GoogleMark, Skeleton, Switch } from "@apx/ui";
import { useEffect, useMemo, useRef } from "react";
import { formatBytes } from "../common/format.ts";
import { GoogleSignal } from "../common/GoogleSignal.tsx";
import { useCloudAccount } from "../config/useCloudAccount.ts";
import { accountError } from "../data/account.ts";
import { useT } from "../i18n/index.ts";
import { closePublicCopy, type usePublicRequest } from "./publicRequest.ts";
import { usePublicCopy } from "./usePublicCopy.ts";
import "../styles/public-copies.css";

type Request = NonNullable<ReturnType<typeof usePublicRequest>>;
type Account = ReturnType<typeof useCloudAccount>;

/**
 * Share public: a copy of the artifact at apxagent.app. Signed out, signing in comes first (APX joined to Google) and
 * the dialog carries on by itself once the browser is done; signed in, it is one step: see it, choose whether its saved
 * data goes too, and share.
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
      bare
      size="sm"
      title={t("public.signInTitle")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && closePublicCopy()}
    >
      <div className="public-signin">
        {loading ? (
          <Skeleton width="100%" height={120} />
        ) : (
          <>
            <GoogleSignal state={state} />
            <p>{t(waiting ? "public.waiting" : available ? "public.signIn" : "account.unavailable")}</p>
            {error != null && <p role="alert">{accountError(t, error)}</p>}
            <div className="public-signin__actions">
              <Button variant="secondary" onClick={closePublicCopy}>
                {t("common.cancel")}
              </Button>
              {waiting ? (
                <Button variant="secondary" disabled={busy} onClick={() => void account.start()}>
                  {t("public.reopen")}
                </Button>
              ) : (
                available && (
                  <Button leadingIcon={<GoogleMark />} loading={busy} onClick={() => void account.start()}>
                    {t("public.continueGoogle")}
                  </Button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function CopyDialog({ request, onSignedOut }: { request: Request; onSignedOut?: () => void }) {
  const t = useT();
  const { source, account, withData, setWithData, review, busy, error, invalid, setReload, commit } =
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
  const stopping = action === "revoke";
  const title = t(stopping ? "public.stopTitle" : action === "update" ? "public.updateTitle" : "public.title");
  const confirm = t(stopping ? "public.stop" : action === "update" ? "public.updateAction" : "public.title");
  const name = (review?.account ?? account)?.name;
  const savedData = request.draft ? review?.bundle?.state : source?.state;
  const hasData = Object.keys(savedData ?? {}).length > 0;
  return (
    <Dialog
      open
      size={stopping ? "sm" : "lg"}
      title={title}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && !busy && closePublicCopy()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={closePublicCopy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={stopping ? "danger" : "primary"}
            loading={busy}
            disabled={!review || invalid || Boolean(error)}
            onClick={() => void commit()}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className="public-copy">
        {error && (
          <p role="alert" className="public-copy__alert">
            {t(error)}{" "}
            {error === "public.connection" && (
              <Button variant="link" onClick={() => setReload((n) => n + 1)}>
                {t("public.retry")}
              </Button>
            )}
          </p>
        )}
        {stopping ? (
          <p>{t("public.revokeWarning")}</p>
        ) : (
          <>
            {preview ? (
              <iframe
                className="public-copy__preview"
                title={t("public.preview")}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={preview}
              />
            ) : (
              !error && <Skeleton width="100%" height={240} />
            )}
            <p className="public-copy__muted">
              {action === "update" ? t("public.replace") : t("public.snapshot")}
              {review ? ` ${t("public.size", { size: formatBytes(review.bytes) })}` : ""}
            </p>
            {hasData && !request.draft && (
              <Switch
                checked={withData}
                disabled={busy}
                onCheckedChange={setWithData}
                label={t("public.withData")}
                description={withData ? undefined : t("public.withDataHint")}
              />
            )}
            <div className="public-copy__more">
              {hasData && (withData || request.draft) && (
                <details>
                  <summary>{t("public.contents")}</summary>
                  <pre>{JSON.stringify(savedData, null, 2)}</pre>
                </details>
              )}
              {review?.bundle && (
                <details>
                  <summary>{t("public.html")}</summary>
                  <pre>{review.bundle.html}</pre>
                </details>
              )}
            </div>
            <p className="public-copy__muted">
              {name ? `${t("public.identity", { name })} · ` : ""}
              {t("public.warning")}
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}

import { Button, Input, SettingRow, Spinner } from "@apx/ui";
import { accountError } from "../data/account.ts";
import { useT } from "../i18n/index.ts";
import { useCloudAccount } from "./useCloudAccount.ts";

/** Uses the adjacent account card and setting rows: recognize your account, choose a handle, sign out. */
export function CloudAccount() {
  const t = useT();
  const account = useCloudAccount();
  const { profile, available, loading, busy, waiting, handle, error, saved } = account;
  return (
    <section aria-label={t("account.cloud")}>
      <SettingRow title={t("account.cloud")} description={t("account.cloudHint")}>
        {loading ? (
          <Spinner size={18} />
        ) : !profile && !waiting ? (
          <Button size="sm" disabled={!available} loading={busy} onClick={() => void account.start()}>
            {t("account.signIn")}
          </Button>
        ) : !profile ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void account.logout()}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </SettingRow>
      {!loading && !available && !profile && <p className="config__hint">{t("account.unavailable")}</p>}
      {waiting && <p role="status">{t("account.waiting")}</p>}
      {profile && (
        <>
          <div className="account-card">
            {profile.photo ? (
              <img className="account-card__avatar" src={profile.photo} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="account-card__avatar">{profile.name.slice(0, 1)}</span>
            )}
            <div className="account-card__text">
              <div className="account-card__name">{profile.name || t("account.cloud")}</div>
              <div className="account-card__sub">{t("account.shortId", { id: profile.id })}</div>
            </div>
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void account.logout()}>
              {t("account.signOut")}
            </Button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void account.save();
            }}
          >
            <SettingRow title={t("account.handle")} description={t("account.handleHint")}>
              <Input
                aria-label={t("account.handle")}
                size="sm"
                value={handle}
                maxLength={25}
                placeholder={t("account.handlePlaceholder")}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => account.setHandle(event.currentTarget.value)}
              />
              <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={handle === profile.handle}>
                {t("common.save")}
              </Button>
            </SettingRow>
          </form>
        </>
      )}
      {error != null && (
        <p role="alert">
          {accountError(t, error)}{" "}
          <Button size="sm" variant="link" onClick={account.retry}>
            {t("common.retry")}
          </Button>
        </p>
      )}
      {saved && <p role="status">{t("account.saved")}</p>}
    </section>
  );
}

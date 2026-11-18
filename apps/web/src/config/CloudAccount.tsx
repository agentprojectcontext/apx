import type { AccountProfile } from "@apx/protocol";
import { Avatar, Button, Dialog, Input, SettingRow, Spinner } from "@apx/ui";
import { accountError } from "../data/account.ts";
import { useT } from "../i18n/index.ts";
import type { useCloudAccount } from "./useCloudAccount.ts";

type Account = ReturnType<typeof useCloudAccount>;

// Settings › Account: one card for who you are. Signed out it is you, the owner of this install, with Sign in with
// Google beside it; signed in, the same card shows your photo, name and APX ID with Sign out.

/** The card at the top: your name from this install, and the APX account when you signed in. */
export function AccountCard({ name, account }: { name: string; account: Account }) {
  const t = useT();
  const { profile, available, loading, busy, waiting, error, saved } = account;
  const sub = profile
    ? `${t("account.shortId", { id: profile.id })} · ${t("account.owner")}`
    : waiting
      ? t("account.waiting")
      : t("account.owner");
  return (
    <section aria-label={t("config.account")}>
      <div className="account-card">
        <Avatar name={name} src={profile?.photo || undefined} size={52} />
        <div className="account-card__text">
          <div className="account-card__name">{name}</div>
          <div className="account-card__sub" role={waiting ? "status" : undefined}>
            {sub}
          </div>
        </div>
        <div className="account-card__act">
          {loading ? (
            <Spinner size={18} />
          ) : profile ? (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void account.logout()}>
              {t("account.signOut")}
            </Button>
          ) : waiting ? (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void account.logout()}>
              {t("common.cancel")}
            </Button>
          ) : available ? (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void account.start()}>
              {t("account.signIn")}
            </Button>
          ) : null}
        </div>
      </div>
      {error != null && (
        <p role="alert" className="account-card__note">
          {accountError(t, error)}{" "}
          {account.canReload && (
            <Button size="sm" variant="link" onClick={account.reload}>
              {t("account.reload")}
            </Button>
          )}
        </p>
      )}
      {saved && (
        <p role="status" className="account-card__note">
          {t("account.saved")}
        </p>
      )}
    </section>
  );
}

/** Your public username, only while signed in. */
export function AccountHandle({ profile, account }: { profile: AccountProfile; account: Account }) {
  const t = useT();
  const { busy, handle } = account;
  return (
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
  );
}

/**
 * Right after signing in, when the name typed here is not the account's: which one stays, side by side, and what
 * is replaced. Nothing else of the profile changes.
 */
export function AccountNameChoice({
  current,
  offered,
  onKeep,
  onUse,
}: {
  current: string;
  offered: string;
  onKeep(): void;
  onUse(): void;
}) {
  const t = useT();
  return (
    <Dialog
      open
      size="sm"
      title={t("account.nameChoiceTitle")}
      description={t("account.nameChoiceLead")}
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && onKeep()}
      footer={
        <>
          <Button variant="secondary" onClick={onKeep}>
            {t("account.nameKeep", { name: current })}
          </Button>
          <Button onClick={onUse}>{t("account.nameUse", { name: offered })}</Button>
        </>
      }
    >
      <dl className="account-compare">
        <div>
          <dt>{t("account.nameNow")}</dt>
          <dd>{current}</dd>
        </div>
        <div>
          <dt>{t("account.nameGoogle")}</dt>
          <dd>{offered}</dd>
        </div>
      </dl>
      <p className="account-card__note">{t("account.nameLoses", { name: current })}</p>
    </Dialog>
  );
}

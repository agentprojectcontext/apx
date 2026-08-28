import { useMemo, useState } from "react";
import useSWR from "swr";
import { Section } from "../../components/Section";
import { Empty, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { ImageProviderList } from "../../components/images/ImageProviderList";
import { ImageProviderModal, type ImageProviderSave } from "../../components/images/ImageProviderModal";
import { ImageTestCard } from "../../components/images/ImageTestCard";
import { ImageDefaultsCard } from "../../components/images/ImageDefaultsCard";
import { Images, type ImagesConfig } from "../../lib/api/images";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { t } from "../../i18n";

// Images module — configure the engines that draw, set the shared defaults,
// and prove one works. Availability comes from the daemon (/images/providers);
// everything else persists through the admin config PATCH under images.*.
//
// Same shape as the Voices module on purpose: these are the same problem
// (several providers, one router, per-provider credentials) and a person who
// has configured one should recognise the other immediately.
export function ImagesScreen() {
  const toast = useToast();
  const { config, isLoading: cfgLoading, patch, mutate: mutateCfg } = useGlobalConfig();
  const {
    data: providersData,
    isLoading: provLoading,
    error: provError,
    mutate: mutateProviders,
  } = useSWR("/api/images/providers", () => Images.providers());

  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // `images` is not on the typed GlobalConfig (it is owned here) — read it off
  // a local view, the way the Voices module reads voice/transcription. Memoised
  // because the `|| {}` fallback would otherwise be a fresh object on every
  // render, and the memo below depends on it.
  const imagesCfg = useMemo<ImagesConfig>(
    () => ((config as unknown as { images?: ImagesConfig }).images || {}),
    [config],
  );
  const configuredProvider = providersData?.configured_provider || imagesCfg.provider || "auto";
  const mode = providersData?.mode || imagesCfg.mode || "chain";
  const order = useMemo(() => providersData?.order || [], [providersData]);
  const engines = providersData?.engines || [];

  const editingConfig = useMemo<Record<string, unknown>>(() => {
    if (!editing || editing === "__new__") return {};
    if (editing.startsWith("custom:")) {
      return (imagesCfg.custom?.[editing.slice(7)] as unknown as Record<string, unknown>) || {};
    }
    return ((imagesCfg as unknown as Record<string, unknown>)[editing] as Record<string, unknown>) || {};
  }, [editing, imagesCfg]);

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      const key = id.startsWith("custom:")
        ? `images.custom.${id.slice(7)}.enabled`
        : `images.${id}.enabled`;
      await patch({ [key]: enabled });
      await mutateProviders();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (nextOrder: string[]) => {
    setBusy(true);
    try {
      await patch({ "images.order": nextOrder });
      await mutateProviders();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveProvider = async ({ set, unset }: ImageProviderSave) => {
    await patch(set, unset.length ? unset : undefined);
    await mutateProviders();
    await mutateCfg();
    toast.success(t("images_ui.toast_config_saved"));
  };

  const saveDefaults = async (set: Record<string, unknown>, unset?: string[]) => {
    try {
      await patch(set, unset);
      await mutateProviders();
      await mutateCfg();
      toast.success(t("images_ui.toast_defaults_saved"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doRemoveCustom = async () => {
    const id = confirmRemove;
    if (!id || !id.startsWith("custom:")) return;
    setBusy(true);
    try {
      // Drop the block and any reference to it in the chain order, or the
      // router would keep walking past a provider that no longer exists.
      await patch({ "images.order": order.filter((x) => x !== id) }, [`images.custom.${id.slice(7)}`]);
      await mutateProviders();
      await mutateCfg();
      toast.success(t("images_ui.toast_provider_removed"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmRemove(null);
    }
  };

  return (
    <div data-testid="screen-images">
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t("images_screen.providers_title")} description={t("images_ui.providers_desc")}>
          {provLoading || cfgLoading ? (
            <Loading />
          ) : provError ? (
            <Empty>{t("images_ui.providers_load_error", { msg: (provError as Error).message })}</Empty>
          ) : (
            <ImageProviderList
              engines={engines}
              order={order}
              onToggleEnabled={toggleEnabled}
              onReorder={reorder}
              onConfigure={(id) => setEditing(id)}
              onRemove={(id) => setConfirmRemove(id)}
              onAddNew={() => setEditing("__new__")}
              busy={busy}
            />
          )}
        </Section>

        <div className="space-y-6">
          <Section title={t("images_screen.test_title")} description={t("images_ui.test_desc")}>
            <ImageTestCard engines={engines} defaultProvider={configuredProvider} mode={mode} />
          </Section>

          <Section title={t("images_screen.defaults_title")} description={t("images_ui.defaults_desc")}>
            {cfgLoading ? <Loading /> : <ImageDefaultsCard config={imagesCfg} onPatch={saveDefaults} />}
          </Section>
        </div>
      </div>

      <ImageProviderModal
        open={!!editing}
        providerId={editing}
        config={editingConfig}
        onClose={() => setEditing(null)}
        onSave={saveProvider}
      />

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={doRemoveCustom}
        title={t("images_ui.remove_confirm")}
        confirmLabel={t("common.remove")}
        testId="image-remove-provider-confirm"
      />
    </div>
  );
}

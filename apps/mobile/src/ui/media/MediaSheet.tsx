import type { MediaItem } from "../../chat/media";
import { openOnWeb, saveMedia, shareMedia } from "../../chat/mediaFiles";
import { t } from "../../i18n";
import { Icon, type IconName } from "../Icon";
import { BottomSheet, ListRow } from "../kit";
import { useTheme } from "../theme";
import { useMediaClient } from "./context";

/** What the phone can do with a picture, video, sound or file: keep it in the gallery, share it or open it elsewhere. */
export function MediaSheet({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const theme = useTheme();
  const client = useMediaClient();
  const actions: Array<[string, IconName, () => void]> = [];
  if (item.kind === "image" || item.kind === "video")
    actions.push([t("saveToGallery"), "Download", () => void saveMedia(client, item)]);
  actions.push([t("shareOrOpen"), "Share2", () => void shareMedia(client, item)]);
  if (item.url && !item.media_id) actions.push([t("openInBrowser"), "Globe", () => openOnWeb(item)]);
  return (
    <BottomSheet title={item.name} onClose={onClose}>
      {actions.map(([label, icon, run]) => (
        <ListRow
          key={label}
          label={label}
          leading={<Icon name={icon} size={18} color={theme.fgMuted} />}
          chevron={false}
          onPress={() => {
            onClose();
            run();
          }}
        />
      ))}
    </BottomSheet>
  );
}

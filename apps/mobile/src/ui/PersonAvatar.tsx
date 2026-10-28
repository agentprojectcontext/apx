import { useContext, useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { mediaFile } from "../chat/mediaFiles";
import { initials } from "../format";
import type { ApxClient } from "../protocol";
import { ChannelMark } from "./ChannelMark";
import { MediaClient } from "./media/context";
import { makeStyles, useTheme } from "./theme";

/** One question per person while the app runs: the core keeps the picture a day and asks the channel after that. */
const asked = new Map<string, Promise<string | undefined>>();
function pictureOf(client: ApxClient, person: string): Promise<string | undefined> {
  let picture = asked.get(person);
  if (!picture) {
    picture = client
      .call("contacts.avatar", { person })
      .then((r) =>
        r.media_id
          ? mediaFile(client, {
              key: r.media_id,
              kind: "image",
              media_id: r.media_id,
              mime: "image/jpeg",
              name: "avatar.jpg",
            })
          : undefined,
      )
      .catch(() => undefined);
    asked.set(person, picture);
  }
  return picture;
}

/**
 * A contact's face: the picture they show on WhatsApp or Telegram, or their initials while it loads or when they show
 * none. `channel` puts that app's mark on its corner.
 */
export function PersonAvatar({
  person,
  name,
  size,
  channel,
}: {
  person?: string | undefined;
  name: string;
  size: number;
  channel?: string | undefined;
}) {
  const theme = useTheme();
  const s = useStyles();
  const client = useContext(MediaClient);
  const [picture, setPicture] = useState<{ person: string; uri: string }>();
  useEffect(() => {
    if (!client || !person) return;
    let live = true;
    void pictureOf(client, person).then((uri) => live && uri && setPicture({ person, uri }));
    return () => {
      live = false;
    };
  }, [client, person]);
  const uri = picture?.person === person ? picture?.uri : undefined;
  const mark = Math.max(14, Math.round(size * 0.42));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={name} style={{ width: size, height: size }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[s.initials, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={{ color: theme.fgMuted, fontSize: size * 0.36, fontWeight: "600" }}>{initials(name)}</Text>
        </View>
      )}
      {channel ? (
        <View style={[s.mark, { width: mark + 4, height: mark + 4, borderRadius: (mark + 4) / 2 }]}>
          <ChannelMark type={channel} size={mark} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  initials: { alignItems: "center", justifyContent: "center", backgroundColor: theme.fillStrong },
  mark: {
    position: "absolute",
    right: -3,
    bottom: -3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.bg,
  },
}));

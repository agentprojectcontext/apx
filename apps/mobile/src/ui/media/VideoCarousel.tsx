import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { type MediaItem, sizeText } from "../../chat/media";
import { t } from "../../i18n";
import { Icon } from "../Icon";
import { IconButton, Spinner } from "../kit";
import { makeStyles } from "../theme";
import { useMediaUri } from "./context";

const GAP = 8;

/**
 * A message's videos: one player, or a carousel to swipe through when there are more. Each is fetched only when its
 * play button is pressed, and the one swiped away pauses.
 */
export function VideoCarousel({ items, onMenu }: { items: MediaItem[]; onMenu: (item: MediaItem) => void }) {
  const s = useStyles();
  const screen = useWindowDimensions().width;
  const [index, setIndex] = useState(0);
  const many = items.length > 1;
  // A slide leaves the next one peeking in, so it reads as something to swipe.
  const slide = Math.min(many ? screen * 0.62 : screen - 72, 260);
  const height = Math.round(slide * (16 / 9));
  const current = items[index];
  return (
    <View style={[s.wrap, { width: screen - 32 }]}>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        snapToInterval={slide + GAP}
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEnabled={many}
        contentContainerStyle={{ gap: GAP }}
        scrollEventThrottle={64}
        onScroll={(e) =>
          setIndex(Math.min(items.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / (slide + GAP)))))
        }
        renderItem={({ item, index: i }) => (
          <VideoSlide item={item} width={slide} height={height} active={i === index} onMenu={() => onMenu(item)} />
        )}
      />
      {many && current ? (
        <Text numberOfLines={1} style={s.caption}>
          {index + 1} / {items.length} · {current.name}
        </Text>
      ) : null}
    </View>
  );
}

function VideoSlide({
  item,
  width,
  height,
  active,
  onMenu,
}: {
  item: MediaItem;
  width: number;
  height: number;
  active: boolean;
  onMenu: () => void;
}) {
  const s = useStyles();
  const [want, setWant] = useState(false);
  const { uri, error } = useMediaUri(item, want);
  return (
    <View style={[s.slide, { width, height }]}>
      {uri ? (
        <Player uri={uri} active={active} width={width} height={height} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("playVideo", { name: item.name })}
          onPress={() => setWant(true)}
          onLongPress={onMenu}
          style={s.poster}
        >
          {want && !error ? <Spinner size={22} /> : <PlayBadge />}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.posterInfo}>
            <Icon name="Video" size={14} color="#fff" />
            <Text numberOfLines={1} style={s.posterName}>
              {item.name}
            </Text>
            <Text style={s.posterSize}>{sizeText(item.bytes)}</Text>
          </View>
        </Pressable>
      )}
      <IconButton
        icon="MoreHorizontal"
        label={t("mediaOptions")}
        size={18}
        color="#fff"
        onPress={onMenu}
        style={s.menu}
      />
    </View>
  );
}

function PlayBadge() {
  const s = useStyles();
  return (
    <View style={s.play}>
      <Icon name="Play" size={26} color="#fff" />
    </View>
  );
}

function Player({ uri, active, width, height }: { uri: string; active: boolean; width: number; height: number }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  // A TextureView scrolls and clips with the chat; a SurfaceView would draw over the messages around it.
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      surfaceType="textureView"
      style={{ width, height }}
    />
  );
}

const useStyles = makeStyles((theme) => ({
  wrap: { gap: 6 },
  slide: { borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
  poster: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#111" },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 3,
  },
  posterInfo: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  posterName: { color: "#fff", fontSize: 13, fontWeight: "500", flexShrink: 1 },
  posterSize: { color: "rgba(255, 255, 255, 0.7)", fontSize: 12 },
  menu: { position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0, 0, 0, 0.35)" },
  error: { color: theme.danger, fontSize: 12, paddingHorizontal: 12, textAlign: "center" },
  caption: { color: theme.fgSubtle, fontSize: 12, marginLeft: 6 },
}));

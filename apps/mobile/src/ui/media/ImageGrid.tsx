import { Image, Pressable, Text, useWindowDimensions, View } from "react-native";
import { type MediaItem, mosaicRows } from "../../chat/media";
import { Icon } from "../Icon";
import { Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { useMediaUri } from "./context";

const GAP = 3;
const MAX_WIDTH = 320;

/** A message's pictures as one mosaic; a tap opens them full screen, a long press offers what to do with one. */
export function ImageGrid({
  items,
  onOpen,
  onMenu,
}: {
  items: MediaItem[];
  onOpen: (index: number) => void;
  onMenu: (item: MediaItem) => void;
}) {
  const s = useStyles();
  const width = mediaWidth(useWindowDimensions().width);
  const rows = mosaicRows(items.length);
  const shown = rows.reduce((sum, n) => sum + n, 0);
  let next = 0;
  return (
    <View style={[s.grid, { width }]}>
      {rows.map((count, r) => {
        const tile = (width - GAP * (count - 1)) / count;
        const height = count > 1 ? tile : rows.length > 1 ? width * 0.5 : width * 0.75;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <View key={r} style={s.row}>
            {Array.from({ length: count }, () => {
              const index = next++;
              const item = items[index];
              if (!item) return null;
              const more = index === shown - 1 ? items.length - shown : 0;
              return (
                <Tile
                  key={item.key}
                  item={item}
                  width={tile}
                  height={height}
                  more={more}
                  onPress={() => onOpen(index)}
                  onLongPress={() => onMenu(item)}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** How wide a message's media block is: most of the phone's width, up to a comfortable size. */
export function mediaWidth(screen: number): number {
  return Math.min(screen - 32 - 40, MAX_WIDTH);
}

function Tile({
  item,
  width,
  height,
  more,
  onPress,
  onLongPress,
}: {
  item: MediaItem;
  width: number;
  height: number;
  more: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const { uri, error } = useMediaUri(item);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={item.name}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[s.tile, { width, height }]}
    >
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" style={{ width, height }} />
      ) : error ? (
        <Icon name="Image" size={22} color={theme.fgSubtle} />
      ) : (
        <Spinner size={16} />
      )}
      {more > 0 ? (
        <View style={s.more}>
          <Text style={s.moreText}>+{more}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  grid: { gap: GAP, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", gap: GAP },
  tile: { backgroundColor: theme.fill, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  more: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { color: "#fff", fontSize: 24, fontWeight: "600" },
}));

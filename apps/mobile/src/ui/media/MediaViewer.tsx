import { useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { MediaItem } from "../../chat/media";
import { t } from "../../i18n";
import { Flasher } from "../Flash";
import { IconButton, Spinner } from "../kit";
import { makeStyles } from "../theme";
import { useMediaUri } from "./context";
import { MediaSheet } from "./MediaSheet";

const BAR = 52;

/**
 * A message's pictures full screen: swipe between them, tap to hide or show the controls; the menu (or a long press)
 * keeps, shares or opens one.
 */
export function MediaViewer({ items, start, onClose }: { items: MediaItem[]; start: number; onClose: () => void }) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(start);
  const [menu, setMenu] = useState<MediaItem>();
  // Controls float on a fade over the picture, which starts a little lower so they cover less of it.
  const [height, setHeight] = useState(0);
  const [chrome, setChrome] = useState(true);
  const top = insets.top + 6;
  const current = items[index];
  return (
    <Modal statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        <View
          style={[s.stage, { paddingTop: top + BAR / 2, paddingBottom: insets.bottom + 8 }]}
          onLayout={(e) => setHeight(e.nativeEvent.layout.height - (top + BAR / 2) - (insets.bottom + 8))}
        >
          {height > 0 ? (
            <FlatList
              horizontal
              pagingEnabled
              data={items}
              keyExtractor={(item) => item.key}
              initialScrollIndex={start}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item }) => (
                <Slide
                  item={item}
                  width={width}
                  height={height}
                  onTap={() => setChrome((on) => !on)}
                  onMenu={() => setMenu(item)}
                />
              )}
            />
          ) : null}
        </View>
        {chrome ? (
          <View style={[s.bar, { paddingTop: top }]}>
            <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#000" stopOpacity={0.8} />
                  <Stop offset="0.6" stopColor="#000" stopOpacity={0.45} />
                  <Stop offset="1" stopColor="#000" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#fade)" />
            </Svg>
            <IconButton icon="X" label={t("close")} color="#fff" onPress={onClose} />
            <Text numberOfLines={1} style={s.title}>
              {items.length > 1 ? `${index + 1} / ${items.length}` : (current?.name ?? "")}
            </Text>
            {current ? (
              <IconButton
                icon="MoreHorizontal"
                label={t("mediaOptions")}
                color="#fff"
                onPress={() => setMenu(current)}
              />
            ) : null}
          </View>
        ) : null}
        <Flasher />
      </View>
      {menu ? <MediaSheet item={menu} onClose={() => setMenu(undefined)} /> : null}
    </Modal>
  );
}

function Slide({
  item,
  width,
  height,
  onTap,
  onMenu,
}: {
  item: MediaItem;
  width: number;
  height: number;
  onTap: () => void;
  onMenu: () => void;
}) {
  const { uri, error } = useMediaUri(item);
  const s = useStyles();
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={s.slide}
      maximumZoomScale={3}
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onTap} onLongPress={onMenu} accessibilityLabel={item.name}>
        {uri ? (
          <Image source={{ uri }} resizeMode="contain" style={{ width, height }} />
        ) : error ? (
          <Text style={s.error}>{error}</Text>
        ) : (
          <Spinner size={22} />
        )}
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: "#000" },
  slide: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  stage: { flex: 1 },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    // The fade runs on below the buttons, so it ends softly over the picture.
    paddingBottom: 36,
  },
  title: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600", textAlign: "center" },
  error: { color: theme.danger, fontSize: 13 },
}));

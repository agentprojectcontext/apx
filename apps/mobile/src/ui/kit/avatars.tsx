import { Image, Text, View } from "react-native";
import { blobEyes } from "../blobEyes";
import { makeStyles, useTheme } from "../theme";

const BLOBS: Record<string, number> = {
  menta: require("../../../../../packages/ui/src/blobs/bodies/menta.webp"),
  parche: require("../../../../../packages/ui/src/blobs/bodies/parche.webp"),
  trino: require("../../../../../packages/ui/src/blobs/bodies/trino.webp"),
  cubi: require("../../../../../packages/ui/src/blobs/bodies/cubi.webp"),
  nimbo: require("../../../../../packages/ui/src/blobs/bodies/nimbo.webp"),
  papa: require("../../../../../packages/ui/src/blobs/bodies/papa.webp"),
  noche: require("../../../../../packages/ui/src/blobs/bodies/noche.webp"),
  kiwi: require("../../../../../packages/ui/src/blobs/bodies/kiwi.webp"),
  gajo: require("../../../../../packages/ui/src/blobs/bodies/gajo.webp"),
  campana: require("../../../../../packages/ui/src/blobs/bodies/campana.webp"),
  cobalto: require("../../../../../packages/ui/src/blobs/bodies/cobalto.webp"),
  rubi: require("../../../../../packages/ui/src/blobs/bodies/rubi.webp"),
  trebol: require("../../../../../packages/ui/src/blobs/bodies/trebol.webp"),
  saturno: require("../../../../../packages/ui/src/blobs/bodies/saturno.webp"),
  onyx: require("../../../../../packages/ui/src/blobs/bodies/onyx.webp"),
  perla: require("../../../../../packages/ui/src/blobs/bodies/perla.webp"),
  faro: require("../../../../../packages/ui/src/blobs/bodies/faro.webp"),
  brasa: require("../../../../../packages/ui/src/blobs/bodies/brasa.webp"),
  aqua: require("../../../../../packages/ui/src/blobs/bodies/aqua.webp"),
  coral: require("../../../../../packages/ui/src/blobs/bodies/coral.webp"),
  zafiro: require("../../../../../packages/ui/src/blobs/bodies/zafiro.webp"),
  pino: require("../../../../../packages/ui/src/blobs/bodies/pino.webp"),
  eclipse: require("../../../../../packages/ui/src/blobs/bodies/eclipse.webp"),
  peon: require("../../../../../packages/ui/src/blobs/bodies/peon.webp"),
  ovni: require("../../../../../packages/ui/src/blobs/bodies/ovni.webp"),
  amatista: require("../../../../../packages/ui/src/blobs/bodies/amatista.webp"),
  volcan: require("../../../../../packages/ui/src/blobs/bodies/volcan.webp"),
  quad: require("../../../../../packages/ui/src/blobs/bodies/quad.webp"),
  cometa: require("../../../../../packages/ui/src/blobs/bodies/cometa.webp"),
  lila: require("../../../../../packages/ui/src/blobs/bodies/lila.webp"),
  orbita: require("../../../../../packages/ui/src/blobs/bodies/orbita.webp"),
  caracol: require("../../../../../packages/ui/src/blobs/bodies/caracol.webp"),
  iris: require("../../../../../packages/ui/src/blobs/bodies/iris.webp"),
  laguna: require("../../../../../packages/ui/src/blobs/bodies/laguna.webp"),
  carbon: require("../../../../../packages/ui/src/blobs/bodies/carbon.webp"),
};

/** Muted hues behind an agent's initials, one set per scheme so the text keeps its contrast. */
const INITIALS_BG = {
  dark: ["#23453b", "#392b51", "#26384d", "#493128", "#492d3c", "#274147", "#47402a", "#3e2e48"],
  light: ["#d6eee2", "#e5ddf7", "#dbe5f6", "#f5e1d5", "#f3dae5", "#d7ebee", "#eee7cf", "#e8def1"],
};

export function AgentAvatar({
  name,
  blob,
  id,
  size = 34,
  online = false,
}: {
  name: string;
  blob?: string;
  id?: string;
  size?: number;
  online?: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "A";
  const seed = id ?? name;
  const hash = [...seed].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  const blobName = blob || Object.keys(BLOBS)[hash % Object.keys(BLOBS).length];
  const hue = hash % 8;
  const colors = INITIALS_BG[t.scheme];
  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      {blobName && BLOBS[blobName] ? (
        <Image source={BLOBS[blobName]} resizeMode="contain" style={{ width: size, height: size }} />
      ) : (
        <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors[hue] }]}>
          <Text style={{ color: t.fg, fontSize: size * 0.34, fontWeight: "600" }}>{initials}</Text>
        </View>
      )}
      {blobName && BLOBS[blobName]
        ? blobEyes[blobName]?.eyes.map((eye) => (
            <View
              key={`${eye.x}:${eye.y}`}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: (eye.x * size) / 256,
                top: (eye.y * size) / 256,
                width: (eye.w * size) / 256,
                height: (eye.h * size) / 256,
                borderRadius: (eye.rx * size) / 256,
                backgroundColor: blobEyes[blobName]?.color,
              }}
            />
          ))
        : null}
      {online ? <View style={s.onlineDot} /> : null}
    </View>
  );
}

export function ProjectAvatar({ name, color: tint, size = 22 }: { name: string; color?: string; size?: number }) {
  const t = useTheme();
  const color = tint ?? t.brand;
  const s = useStyles();
  return (
    <View
      style={[
        s.projectAvatar,
        { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: color },
      ]}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.52, fontWeight: "600" }}>{name[0]?.toUpperCase() ?? "?"}</Text>
    </View>
  );
}

/** Two agents of one conversation, the second over the first's corner. */
export function AgentPair({
  first,
  second,
  size = 48,
}: {
  first: { name: string; blob?: string; id?: string };
  second: { name: string; blob?: string; id?: string };
  size?: number;
}) {
  const s = useStyles();
  const each = Math.round(size * 0.58);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", left: 0, top: 0 }}>
        <AgentAvatar {...first} size={each} />
      </View>
      <View style={[s.pairBack, { right: 0, bottom: 0, borderRadius: each / 2 }]}>
        <AgentAvatar {...second} size={each} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  avatar: { alignItems: "center", justifyContent: "center" },
  onlineDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.brand,
    borderWidth: 2,
    borderColor: t.bg,
  },
  projectAvatar: { alignItems: "center", justifyContent: "center" },
  pairBack: { position: "absolute", backgroundColor: t.bg, padding: 2, margin: -2 },
}));

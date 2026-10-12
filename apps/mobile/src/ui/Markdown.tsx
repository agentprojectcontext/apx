import { useMemo } from "react";
import { Linking, Text, View } from "react-native";
import { type Block, type Inline, parseMarkdown } from "../chat/markdown";
import { makeStyles, useTheme } from "./theme";

function Runs({ runs }: { runs: Inline[] }) {
  const s = useStyles();
  return runs.map((run, i) => {
    // Runs are positions in one line; they never reorder.
    const key = `${run.kind}:${i}`;
    switch (run.kind) {
      case "bold":
        return (
          <Text key={key} style={s.bold}>
            <Runs runs={run.children} />
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={s.italic}>
            <Runs runs={run.children} />
          </Text>
        );
      case "code":
        return (
          <Text key={key} style={s.inlineCode}>
            {run.text}
          </Text>
        );
      case "link":
        return (
          <Text key={key} style={s.link} accessibilityRole="link" onPress={() => void Linking.openURL(run.url)}>
            {run.text}
          </Text>
        );
      default:
        return run.text;
    }
  });
}

function Blocks({ blocks, color }: { blocks: Block[]; color: string }) {
  const theme = useTheme();
  const s = useStyles();
  return blocks.map((block, i) => {
    const key = `${block.kind}:${i}`;
    switch (block.kind) {
      case "heading":
        return (
          <Text key={key} selectable style={[s.text, s.heading, { color }]}>
            <Runs runs={block.inline} />
          </Text>
        );
      case "list":
        return (
          <View key={key} style={s.list}>
            {block.items.map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: list items are positional
              <View key={j} style={s.item}>
                <Text style={[s.text, s.marker]}>{item.marker}</Text>
                <Text selectable style={[s.text, { color, flex: 1 }]}>
                  <Runs runs={item.inline} />
                </Text>
              </View>
            ))}
          </View>
        );
      case "code":
        return (
          <Text key={key} selectable style={s.code}>
            {block.text}
          </Text>
        );
      case "quote":
        return (
          <View key={key} style={s.quote}>
            <Blocks blocks={block.blocks} color={theme.fgMuted} />
          </View>
        );
      default:
        return (
          <Text key={key} selectable style={[s.text, { color }]}>
            <Runs runs={block.inline} />
          </Text>
        );
    }
  });
}

/** An agent's answer: the markdown it writes (headings, lists, quotes, code, bold, links) in native text. */
export function Markdown({ text, color: tint }: { text: string; color?: string }) {
  const theme = useTheme();
  const color = tint ?? theme.fg;
  const s = useStyles();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={s.root}>
      <Blocks blocks={blocks} color={color} />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { gap: 8 },
  text: { fontSize: 15, lineHeight: 21 },
  heading: { fontWeight: "600", fontSize: 16 },
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic" },
  inlineCode: { fontFamily: theme.mono, fontSize: 13, backgroundColor: theme.fillStrong },
  link: { textDecorationLine: "underline" },
  list: { gap: 4 },
  quote: { gap: 8, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: theme.borderStrong },
  item: { flexDirection: "row", gap: 8 },
  marker: { color: theme.fgSubtle, minWidth: 14 },
  code: {
    fontFamily: theme.mono,
    fontSize: 12,
    lineHeight: 17,
    color: theme.fg,
    backgroundColor: theme.bg,
    padding: 10,
    borderRadius: 10,
    overflow: "hidden",
  },
}));

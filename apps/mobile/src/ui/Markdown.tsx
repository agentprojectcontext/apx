import { createContext, useContext, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { type Block, type Inline, parseMarkdown, plainText } from "../chat/markdown";
import { t } from "../i18n";
import { EMAIL_LANG, parseEmailBlock } from "../protocol";
import { EmailCard } from "./chat/EmailCard";
import { copyText } from "./copy";
import { Icon } from "./Icon";
import { makeStyles, useTheme } from "./theme";

/** Whether the words can be selected in place (not in the chat, where a long press opens the message's menu). */
const Selectable = createContext(true);

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
  const selectable = useContext(Selectable);
  return blocks.map((block, i) => {
    const key = `${block.kind}:${i}`;
    switch (block.kind) {
      case "heading":
        return (
          <Text key={key} selectable={selectable} style={[s.text, s.heading, { color }]}>
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
                <Text selectable={selectable} style={[s.text, { color, flex: 1 }]}>
                  <Runs runs={item.inline} />
                </Text>
              </View>
            ))}
          </View>
        );
      case "code": {
        const mail = block.lang === EMAIL_LANG ? parseEmailBlock(block.text) : undefined;
        if (mail) return <EmailCard key={key} mail={mail} />;
        return (
          <View key={key}>
            <Text selectable={selectable} style={s.code}>
              {block.text}
            </Text>
            <CopyButton text={block.text} style={s.codeCopy} />
          </View>
        );
      }
      case "table":
        return <Table key={key} table={block} color={color} />;
      case "quote":
        return (
          <View key={key} style={s.quote}>
            <View style={s.quoteText}>
              <Blocks blocks={block.blocks} color={theme.fgMuted} />
            </View>
            <CopyButton text={plainText(block.blocks)} />
          </View>
        );
      default:
        return (
          <Text key={key} selectable={selectable} style={[s.text, { color }]}>
            <Runs runs={block.inline} />
          </Text>
        );
    }
  });
}

type TableBlock = Extract<Block, { kind: "table" }>;

const runsLength = (runs: Inline[]): number =>
  runs.reduce((n, run) => n + ("children" in run ? runsLength(run.children) : run.text.length), 0);

/** A column as wide as its longest cell, within what a phone can show: longer cells wrap. */
const columnWidths = (table: TableBlock): number[] =>
  table.align.map((_, column) => {
    const longest = Math.max(...[table.header, ...table.rows].map((row) => runsLength(row[column] ?? [])));
    return Math.min(240, Math.max(64, longest * 9 + 24));
  });

/** A table the agent wrote: header and rows on a grid that scrolls sideways when it is wider than the bubble. */
function Table({ table, color }: { table: TableBlock; color: string }) {
  const s = useStyles();
  const selectable = useContext(Selectable);
  const widths = useMemo(() => columnWidths(table), [table]);
  const row = (cells: Inline[][], header: boolean, last: boolean) =>
    cells.map((cell, column) => (
      <View
        // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
        key={column}
        style={[s.cell, { width: widths[column] }, header && s.headerCell, last && s.lastRow]}
      >
        <Text
          selectable={selectable}
          style={[s.cellText, { color, textAlign: table.align[column] ?? "left" }, header && s.bold]}
        >
          <Runs runs={cell} />
        </Text>
      </View>
    ));
  return (
    <ScrollView horizontal style={s.tableScroll} contentContainerStyle={s.tableContent} testID="markdown-table">
      <View style={s.table}>
        <View style={s.tableRow}>{row(table.header, true, table.rows.length === 0)}</View>
        {table.rows.map((cells, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <View key={i} style={s.tableRow}>
            {row(cells, false, i === table.rows.length - 1)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Copies a quote or a code block on its own: what an agent drafts for the owner to paste elsewhere. */
function CopyButton({ text, style }: { text: string; style?: object }) {
  const theme = useTheme();
  const s = useStyles();
  const [done, setDone] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("copyText")}
      hitSlop={8}
      onPress={() =>
        void copyText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      style={({ pressed }) => [s.copy, pressed && { opacity: 0.6 }, style]}
    >
      <Icon name={done ? "Check" : "Copy"} size={14} color={theme.fgMuted} />
    </Pressable>
  );
}

/** An agent's answer: the markdown it writes (headings, lists, quotes, code, bold, links) in native text. */
export function Markdown({
  text,
  color: tint,
  selectable = true,
}: {
  text: string;
  color?: string;
  selectable?: boolean;
}) {
  const theme = useTheme();
  const color = tint ?? theme.fg;
  const s = useStyles();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <Selectable.Provider value={selectable}>
      <View style={s.root}>
        <Blocks blocks={blocks} color={color} />
      </View>
    </Selectable.Provider>
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
  quote: { flexDirection: "row", gap: 8, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: theme.borderStrong },
  quoteText: { flex: 1, gap: 8 },
  copy: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.fillStrong,
  },
  codeCopy: { position: "absolute", top: 6, right: 6 },
  // A sideways ScrollView grows by default; the table keeps its own height.
  tableScroll: { flexGrow: 0 },
  tableContent: { alignItems: "flex-start" },
  table: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, overflow: "hidden" },
  tableRow: { flexDirection: "row" },
  cell: { paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  headerCell: { backgroundColor: theme.fill },
  lastRow: { borderBottomWidth: 0 },
  cellText: { fontSize: 14, lineHeight: 19 },
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

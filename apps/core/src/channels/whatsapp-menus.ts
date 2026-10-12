/**
 * What businesses send on WhatsApp instead of sentences: buttons, lists, templates, nativeFlow menus, polls, and
 * the tap someone made on one. None of them carry `conversation`, so each is read here into words a thread can
 * hold. The payloads come off someone else's server in a decade of overlapping proto generations: every read is
 * loose and never throws.
 */

type Node = Record<string, unknown>;

/** Containers WhatsApp wraps real content in (business menus often arrive inside `viewOnceMessage`). */
export const WA_CONTAINERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
  "deviceSentMessage",
  "botInvokeMessage",
] as const;

export type MenuOption = { n: number; id: string; title: string; description?: string; url?: string };
export type Menu = {
  kind: "buttons" | "list" | "template" | "interactive" | "poll";
  title: string;
  text: string;
  /** What the button that opens a list says ("See options"): the question when the body is empty. */
  prompt: string;
  options: MenuOption[];
};
export type MenuPick = { kind: Menu["kind"]; id: string; title: string };

const node = (v: unknown): Node | undefined => (v && typeof v === "object" ? (v as Node) : undefined);
const nodes = (v: unknown): Node[] => (Array.isArray(v) ? v.map(node).filter((x): x is Node => !!x) : []);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** A proto text field that is a string in one generation and `{ text }` in the next. */
const soft = (v: unknown) => (typeof v === "string" ? v.trim() : str(node(v)?.text) || str(node(v)?.displayText));
const json = (v: unknown): Node => {
  try {
    return node(JSON.parse(String(v ?? ""))) ?? {};
  } catch {
    return {};
  }
};

/** Numbered from 1, blanks and repeats gone: the number is how a person answers a menu on a phone. */
function numbered(raw: Omit<MenuOption, "n">[]): MenuOption[] {
  const seen = new Set<string>();
  const out: MenuOption[] = [];
  for (const o of raw) {
    const key = o.title.toLowerCase();
    if (!o.title || seen.has(key)) continue;
    seen.add(key);
    out.push({
      n: out.length + 1,
      id: o.id || o.title,
      title: o.title,
      ...(o.description ? { description: o.description } : {}),
      ...(o.url ? { url: o.url } : {}),
    });
  }
  return out;
}
const joined = (...parts: string[]) => parts.filter(Boolean).join(" — ");

function fromButtons(m: Node): Omit<Menu, "kind"> {
  return {
    title: soft(m.headerText) || soft(m.text),
    text: soft(m.contentText),
    prompt: "",
    options: numbered(nodes(m.buttons).map((b) => ({ id: str(b.buttonId), title: soft(b.buttonText) }))),
  };
}

function fromList(m: Node): Omit<Menu, "kind"> {
  const options = nodes(m.sections).flatMap((s) =>
    nodes(s.rows).map((r) => ({
      id: str(r.rowId),
      title: str(r.title),
      description: joined(str(s.title), str(r.description)),
    })),
  );
  return { title: soft(m.title), text: soft(m.description), prompt: soft(m.buttonText), options: numbered(options) };
}

/** Three spellings of a template are live at once; all are read rather than betting on one. */
function fromTemplate(m: Node): Omit<Menu, "kind"> {
  const h = node(m.hydratedTemplate) ?? node(m.hydratedFourRowTemplate) ?? {};
  const four = node(m.fourRowTemplate) ?? {};
  const options = nodes(h.hydratedButtons ?? four.buttons).flatMap((b) => {
    const quick = node(b.quickReplyButton);
    const url = node(b.urlButton);
    const call = node(b.callButton);
    if (quick) return [{ id: soft(quick.id), title: soft(quick.displayText) }];
    if (url) return [{ id: soft(url.url), title: soft(url.displayText), url: soft(url.url) }];
    if (call) return [{ id: soft(call.phoneNumber), title: soft(call.displayText) }];
    return [];
  });
  return {
    title: soft(h.hydratedTitleText) || soft(four.title),
    text: soft(h.hydratedContentText) || soft(four.content),
    prompt: "",
    options: numbered(options),
  };
}

/** nativeFlow hides each button in a JSON string whose shape depends on its `name`; a `single_select` is a list. */
function fromNativeFlow(flow: unknown, into: { prompt: string; options: Omit<MenuOption, "n">[] }) {
  for (const b of nodes(node(flow)?.buttons)) {
    const params = json(b.buttonParamsJson);
    const sections = nodes(params.sections);
    if (str(b.name) === "single_select" || sections.length) {
      into.prompt ||= str(params.title);
      for (const s of sections)
        for (const r of nodes(s.rows))
          into.options.push({
            id: str(r.id),
            title: str(r.title) || str(r.header),
            description: joined(str(s.title), str(r.description)),
          });
      continue;
    }
    const title = str(params.display_text) || str(params.displayText) || str(params.flow_cta);
    if (title) into.options.push({ id: str(params.id) || str(params.flow_id), title, url: str(params.url) });
  }
}

function fromInteractive(m: Node): Omit<Menu, "kind"> {
  const into = { prompt: "", options: [] as Omit<MenuOption, "n">[] };
  fromNativeFlow(m.nativeFlowMessage, into);
  // A carousel's cards each have buttons; from this side it is still one list of things to pick.
  for (const card of nodes(node(m.carouselMessage)?.cards)) fromNativeFlow(card.nativeFlowMessage, into);
  const header = node(m.header);
  return {
    title: [soft(header?.title), soft(header?.subtitle)].filter(Boolean).join("\n"),
    text: soft(m.body),
    prompt: into.prompt,
    options: numbered(into.options),
  };
}

function fromPoll(m: Node): Omit<Menu, "kind"> {
  const options = nodes(m.options).map((o) => ({ id: str(o.optionName), title: str(o.optionName) }));
  return { title: "", text: str(m.name), prompt: "", options: numbered(options) };
}

/** The tap someone made on a menu: a real reply proto per generation. */
export function readPick(c: unknown): MenuPick | undefined {
  const m = node(c);
  if (!m) return undefined;
  const br = node(m.buttonsResponseMessage);
  if (br) return { kind: "buttons", id: str(br.selectedButtonId), title: soft(br.selectedDisplayText) };
  const tr = node(m.templateButtonReplyMessage);
  if (tr) return { kind: "template", id: soft(tr.selectedId), title: soft(tr.selectedDisplayText) };
  const lr = node(m.listResponseMessage);
  if (lr) return { kind: "list", id: str(node(lr.singleSelectReply)?.selectedRowId), title: soft(lr.title) };
  const ir = node(m.interactiveResponseMessage);
  if (ir) {
    const flow = node(ir.nativeFlowResponseMessage);
    const params = json(flow?.paramsJson);
    return {
      kind: "interactive",
      id: str(params.id) || str(flow?.name),
      title: soft(ir.body) || str(params.display_text) || str(params.title),
    };
  }
  return undefined;
}

/** The menu a message offers, or nothing when it is not one (or one with nothing readable in it). */
export function readMenu(c: unknown): Menu | undefined {
  const m = node(c);
  if (!m) return undefined;
  const poll = node(m.pollCreationMessage) ?? node(m.pollCreationMessageV2) ?? node(m.pollCreationMessageV3);
  const read: [Menu["kind"], Node | undefined, (m: Node) => Omit<Menu, "kind">][] = [
    ["buttons", node(m.buttonsMessage), fromButtons],
    ["list", node(m.listMessage), fromList],
    ["template", node(m.templateMessage), fromTemplate],
    ["interactive", node(m.interactiveMessage), fromInteractive],
    ["poll", poll, fromPoll],
  ];
  for (const [kind, at, from] of read) {
    if (!at) continue;
    const menu = { kind, ...from(at) };
    return menu.options.length || menu.text || menu.title || menu.prompt ? menu : undefined;
  }
  return undefined;
}

/**
 * A menu or a pick as a person would read it. The options go inline and numbered, so the agent can answer "2" or
 * the label the way a person would; the footer (legal boilerplate on every business message) is dropped.
 */
export function menuText(c: unknown): string | undefined {
  const pick = readPick(c);
  if (pick) return `[chose: ${pick.title || pick.id || "an option"}]`;
  const menu = readMenu(c);
  if (!menu) return undefined;
  // The list's own button label stands in for the body only when there is no body.
  const head = [...new Set([menu.title, menu.text || menu.prompt].filter(Boolean))].join("\n");
  const opts = menu.options.map((o) => `${o.n}. ${o.title}`).join(" | ");
  return [head, opts ? `[Options: ${opts}]` : ""].filter(Boolean).join("\n") || undefined;
}

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { t } from "../src/i18n";
import type { ApxClient, Message } from "../src/protocol";
import { BrowserConsents } from "../src/ui/BrowserConsents";
import { ChatMessage } from "../src/ui/ChatMessage";

jest.mock("../src/chat/mediaFiles", () => ({}));
jest.mock("../src/ui/media/VideoCarousel", () => ({ VideoCarousel: () => null }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const source = Array.from({ length: 12 }, (_, i) => `const value${i} = ${i};`).join("\n");
const message = (scope?: "tab" | "turn"): Message => ({
  id: "msg_browser",
  thread_id: "th_chat",
  seq: 1,
  author: { kind: "agent", id: "agent_reader" },
  created_at: "2026-10-28T10:00:00Z",
  parts: [
    {
      type: "input",
      input_id: "input_browser",
      kind: "confirm",
      tool: "browser_evaluate",
      prompt: "Run browser JavaScript?",
      detail: source,
      browser: {
        origin: "https://example.test",
        document: "document_internal",
        path: "review.js",
        sha256: "a".repeat(64),
        title: "Example page",
        tab_number: 2,
      },
      state: scope ? "approved" : "pending",
      approval_scopes: ["once", "tab", "turn"],
      ...(scope ? { approval_scope: scope } : {}),
    },
  ],
});

test.each([
  ["approveOnce", { decision: "approve" }],
  ["approveTab", { decision: "approve", scope: "tab" }],
  ["approveTurn", { decision: "approve", scope: "turn" }],
  ["deny", { decision: "deny" }],
] as const)("browser review sends only the selected %s decision", async (label, answer) => {
  const respond = jest.fn(async () => {});
  const ui = await render(<ChatMessage message={message()} agents={[]} respond={respond} />);
  expect(ui.getByText(source).props.numberOfLines).toBeUndefined();
  expect(ui.getByText(t("browserScopeHelp"))).toBeVisible();
  expect(ui.getByText(`${t("browserOrigin")}: https://example.test`)).toBeVisible();
  expect(ui.queryByText(/Tab: internal/)).toBeNull();
  expect(ui.queryByText(t("browserSafety"))).toBeNull();
  expect(ui.queryByText(t("approveSession"))).toBeNull();
  expect(ui.queryByText(t("approveAlways"))).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t(label) }));
  await waitFor(() => expect(respond).toHaveBeenCalledWith("input_browser", answer));
  expect(respond).toHaveBeenCalledTimes(1);
});

test.each(["tab", "turn"] as const)(
  "settled browser review shows the %s scope without approval controls",
  async (scope) => {
    const ui = await render(<ChatMessage message={message(scope)} agents={[]} respond={jest.fn()} />);
    expect(ui.getByText(`${t("inputApproved")} · ${t(scope === "tab" ? "browserTab" : "browserTurn")}`)).toBeVisible();
    expect(ui.queryByText(t("approveOnce"))).toBeNull();
    await fireEvent.press(ui.getByRole("button"));
    expect(ui.getByText(source).props.numberOfLines).toBeUndefined();
    expect(ui.queryByText(t("approveTab"))).toBeNull();
    expect(ui.queryByText(t("approveTurn"))).toBeNull();
  },
);

const grant = {
  key: "browser:grant",
  server: "native",
  tool: "browser_evaluate",
  scope: "tab",
  thread_id: "th_chat",
  agent_id: "agent_reader",
  browser: { origin: "https://example.test", tab: "tab_internal", epoch: "epoch_internal", run: "run_internal" },
  expires_at: "2026-10-28T10:30:00Z",
};
const props = { thread: "th_chat", agents: [{ id: "agent_reader", name: "Reader" }], threads: [] };

test.each([undefined, grant.expires_at])(
  "turn permission shows execution end, not a timed expiry (%s)",
  async (expires_at) => {
    const call = jest.fn().mockResolvedValue({ approvals: [{ ...grant, scope: "turn", expires_at }] });
    const ui = await render(<BrowserConsents {...props} client={{ call } as unknown as ApxClient} />);
    await fireEvent.press(ui.getByRole("button", { name: t("browserPermissions") }));
    await waitFor(() => expect(ui.getByText(t("browserTurnEnds"))).toBeVisible());
    expect(ui.queryByText(t("browserExpires", { at: new Date(grant.expires_at).toLocaleString() }))).toBeNull();
  },
);

test("active permissions are reachable during the chat, show human scope and revoke the exact grant", async () => {
  const call = jest
    .fn()
    .mockResolvedValueOnce({
      approvals: [
        grant,
        { ...grant, key: "other-chat", thread_id: "th_other" },
        { ...grant, key: "mcp-grant", browser: undefined, scope: "always" },
      ],
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ approvals: [] });
  const ui = await render(<BrowserConsents {...props} client={{ call } as unknown as ApxClient} />);
  expect(call).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: t("browserPermissions") }));
  await waitFor(() => expect(ui.getByText(`https://example.test · ${t("browserTab")}`)).toBeVisible());
  expect(ui.getAllByRole("button", { name: new RegExp(`^${t("browserRevoke")}:`) })).toHaveLength(1);
  expect(ui.queryByText("tab_internal")).toBeNull();
  expect(ui.queryByText("run_internal")).toBeNull();
  expect(ui.getByText(t("browserExpires", { at: new Date(grant.expires_at).toLocaleString() }))).toBeVisible();
  expect(ui.queryByText(t("browserTurnEnds"))).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: new RegExp(`^${t("browserRevoke")}:`) }));
  await waitFor(() => expect(ui.getByText(t("browserNone"))).toBeVisible());
  expect(call).toHaveBeenNthCalledWith(2, "tools.revoke", {
    key: "browser:grant",
    thread: "th_chat",
    agent: "agent_reader",
  });
  expect(call).toHaveBeenNthCalledWith(3, "tools.approvals", {});
});

test("failed permission loading is not an empty list and can be retried", async () => {
  const call = jest.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ approvals: [] });
  const ui = await render(<BrowserConsents {...props} client={{ call } as unknown as ApxClient} />);
  await fireEvent.press(ui.getByRole("button", { name: t("browserPermissions") }));
  await waitFor(() => expect(ui.getByText(t("browserLoadFailed"))).toBeVisible());
  expect(ui.queryByText(t("browserNone"))).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t("browserRefresh") }));
  await waitFor(() => expect(ui.getByText(t("browserNone"))).toBeVisible());
  expect(ui.queryByText(t("browserLoadFailed"))).toBeNull();
});

test("a late permissions response cannot replace the new chat's permissions", async () => {
  let finish!: (value: { approvals: (typeof grant)[] }) => void;
  const pending = new Promise<{ approvals: (typeof grant)[] }>((resolve) => {
    finish = resolve;
  });
  const next = { ...grant, thread_id: "th_other", browser: { ...grant.browser, origin: "https://other.example.test" } };
  const call = jest
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce({ approvals: [next] });
  const client = { call } as unknown as ApxClient;
  const ui = await render(<BrowserConsents {...props} client={client} />);
  await fireEvent.press(ui.getByRole("button", { name: t("browserPermissions") }));
  await ui.rerender(<BrowserConsents {...props} thread="th_other" client={client} />);
  await waitFor(() => expect(ui.getByText(`https://other.example.test · ${t("browserTab")}`)).toBeVisible());
  await act(async () => {
    finish({ approvals: [grant] });
  });
  expect(ui.queryByText(`https://example.test · ${t("browserTab")}`)).toBeNull();
  expect(ui.getByText(`https://other.example.test · ${t("browserTab")}`)).toBeVisible();
});

test("failed revocation does not pretend the grant disappeared; refresh can recover", async () => {
  const call = jest
    .fn()
    .mockResolvedValueOnce({ approvals: [grant] })
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ approvals: [grant] });
  const ui = await render(<BrowserConsents {...props} client={{ call } as unknown as ApxClient} />);
  await fireEvent.press(ui.getByRole("button", { name: t("browserPermissions") }));
  await waitFor(() => expect(ui.getByRole("button", { name: new RegExp(`^${t("browserRevoke")}:`) })).toBeVisible());
  await fireEvent.press(ui.getByRole("button", { name: new RegExp(`^${t("browserRevoke")}:`) }));
  await waitFor(() => expect(ui.getByText(t("browserRevokeFailed"))).toBeVisible());
  expect(ui.queryByText(t("browserLoadFailed"))).toBeNull();
  expect(ui.getByText(`https://example.test · ${t("browserTab")}`)).toBeVisible();
  expect(ui.queryByText(t("browserNone"))).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t("browserRefresh") }));
  await waitFor(() => expect(ui.queryByText(t("browserRevokeFailed"))).toBeNull());
  expect(call).toHaveBeenCalledTimes(3);
});

test("structured approval preserves source prefixes and exposes metadata only in technical details", async () => {
  const data = message();
  const input = data.parts.find((part) => part.type === "input");
  if (!input) throw new Error("Missing approval fixture");
  const exactSource = 'Tab: "Keep";\nOrigin: "Keep";\nDocument: "Keep";\n\n42';
  input.detail = exactSource;
  const ui = await render(<ChatMessage message={data} agents={[]} respond={jest.fn()} />);
  expect(ui.getByText(exactSource).props.numberOfLines).toBeUndefined();
  expect(ui.queryByText("Run browser JavaScript?")).toBeNull();
  expect(ui.queryByText(`${t("browserDocument")}: document_internal`)).toBeNull();
  expect(ui.getByRole("button", { name: t("browserTechnical") })).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ expanded: false }),
  );
  await fireEvent.press(ui.getByRole("button", { name: t("browserTechnical") }));
  expect(ui.getByRole("button", { name: t("browserTechnical") })).toHaveProp(
    "accessibilityState",
    expect.objectContaining({ expanded: true }),
  );
  expect(ui.getByText(`${t("browserDocument")}: document_internal`)).toBeVisible();
  expect(ui.getByText(`${t("browserFile")}: review.js`)).toBeVisible();
  expect(ui.getByText(`${t("browserHash")}: ${"a".repeat(64)}`)).toBeVisible();
  expect(ui.getByText(exactSource)).toBeVisible();
});

test("older approvals without structured review preserve the entire original detail", async () => {
  const data = message();
  const input = data.parts.find((part) => part.type === "input");
  if (!input?.detail) throw new Error("Missing approval fixture");
  delete input.browser;
  input.detail = `Tab: internal\nOrigin: https://example.test\nDocument: internal\nReview all code.\n\n${source}`;
  const ui = await render(<ChatMessage message={data} agents={[]} respond={jest.fn()} />);
  expect(ui.getByText(input.detail).props.numberOfLines).toBeUndefined();
  expect(ui.getByText(t("browserScopeHelp"))).toBeVisible();
});

test("browser safety details expand without hiding the scope warning or source", async () => {
  const ui = await render(<ChatMessage message={message()} agents={[]} respond={jest.fn()} />);
  await fireEvent.press(ui.getByRole("button", { name: t("browserMore") }));
  expect(ui.getByText(t("browserSafety"))).toBeVisible();
  expect(ui.getByText(t("browserScopeHelp"))).toBeVisible();
  expect(ui.getByText(source)).toBeVisible();
  expect(ui.getByRole("button", { name: t("approveTab") }).props.accessibilityHint).toContain(t("browserTabHelp"));
});

test.each([true, false])("same-site tabs have distinct revoke names (tab metadata: %s)", async (metadata) => {
  const first = { ...grant, browser: { ...grant.browser, ...(metadata ? { title: "Orders", tab_number: 2 } : {}) } };
  const second = {
    ...grant,
    key: "second-grant",
    browser: { ...grant.browser, ...(metadata ? { title: "Orders", tab_number: 3 } : {}) },
  };
  const call = jest
    .fn()
    .mockResolvedValueOnce({ approvals: [first, second] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ approvals: [first] });
  const ui = await render(<BrowserConsents {...props} client={{ call } as unknown as ApxClient} />);
  await fireEvent.press(ui.getByRole("button", { name: t("browserPermissions") }));
  const names = (n: number) =>
    `${t("browserRevoke")}: https://example.test · ${metadata ? "Orders" : t("browserUntitled")} · ${t(metadata ? "browserTabNumber" : "browserPermissionNumber", { n })} · Reader · ${t("browserChat")}`;
  await waitFor(() => expect(ui.getByRole("button", { name: names(metadata ? 2 : 1) })).toBeVisible());
  await fireEvent.press(ui.getByRole("button", { name: names(metadata ? 3 : 2) }));
  await waitFor(() =>
    expect(call).toHaveBeenNthCalledWith(2, "tools.revoke", {
      key: "second-grant",
      thread: "th_chat",
      agent: "agent_reader",
    }),
  );
  await waitFor(() =>
    expect(ui.getAllByRole("button", { name: new RegExp(`^${t("browserRevoke")}:`) })).toHaveLength(1),
  );
  expect(ui.getByText(new RegExp(`^${t("browserRevoked", { context: "" }).split(":")[0]}`))).toHaveProp(
    "accessibilityLiveRegion",
    "polite",
  );
});

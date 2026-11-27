import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { lang, t } from "../src/i18n";
import { ApxClient, type Message, noticeText } from "../src/protocol";
import { ContinuationNotice } from "../src/ui/chat/ContinuationNotice";
import { credentials, transport } from "./transport.test-support";

const Native = jest.requireActual<typeof import("react-native")>("react-native");
afterEach(() => jest.restoreAllMocks());

type Notice = Extract<Message["parts"][number], { type: "notice" }>;
const label = (key: string) => noticeText({ code: `continuation.${key}`, text: key }, lang);
const part: Notice = {
  type: "notice",
  code: "continuation.receipt",
  text: "Follow-up",
  level: "warn",
  vars: {
    id: "followup",
    thread: "thread",
    state: "pending",
    purpose: "Check the report",
    condition: "time",
    when: "2026-12-01T10:00:00Z",
    expires: "2026-12-02T10:00:00Z",
  },
};
const terminal = (state: string, reason = "access"): Notice => ({ ...part, vars: { ...part.vars, state, reason } });

test("pending checks cancel through the registered protocol and show the confirmed state", async () => {
  const net = transport();
  net.responses["continuations.cancel"] = { state: "canceled" };
  const focus = jest.spyOn(Native.AccessibilityInfo, "setAccessibilityFocus").mockImplementation(() => {});
  jest.spyOn(Native, "findNodeHandle").mockReturnValue(42);
  const client = new ApxClient({ ...credentials, client: { name: "test", version: "1" } });
  const ui = await render(<ContinuationNotice part={part} client={client} />);
  expect(ui.queryByText("Check the report")).toBeNull();
  expect(focus).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: `${t("followup")} · ${label("scheduled")}` }));
  expect(ui.getByText("Check the report")).toBeTruthy();
  await fireEvent.press(ui.getByText(label("cancel")));
  await waitFor(() => expect(ui.getByText(`${t("followup")} · ${label("canceled")}`)).toBeTruthy());
  await waitFor(() => expect(focus).toHaveBeenCalledWith(42));
  expect(net.calls).toContainEqual({
    method: "continuations.cancel",
    params: expect.objectContaining({ thread: "thread", id: "followup" }),
  });
  expect(ui.queryByText(label("cancel"))).toBeNull();
});

test("a cancellation failure stays visible even when folded and allows retry", async () => {
  const net = transport();
  net.faults["continuations.cancel"] = { code: "internal", message: "Offline" };
  const ui = await render(
    <ContinuationNotice
      part={part}
      client={new ApxClient({ ...credentials, client: { name: "test", version: "1" } })}
    />,
  );
  expect(
    ui.getByRole("button", {
      name: noticeText(
        { code: "continuation.cancelLabel", text: "cancelLabel", vars: { purpose: "Check the report" } },
        lang,
      ),
    }),
  ).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: `${t("followup")} · ${label("scheduled")}` }));
  await fireEvent.press(ui.getByText(label("cancel")));
  await waitFor(() => expect(ui.getByRole("alert")).toBeTruthy());
  await fireEvent.press(ui.getByRole("button", { name: `${t("followup")} · ${label("scheduled")}` }));
  expect(ui.getByText(label("cancel"))).toBeTruthy();
  expect(ui.queryByText("Check the report")).toBeNull();
  expect(ui.getByText(label("cancelError"))).toBeTruthy();
  await fireEvent.press(ui.getByRole("button", { name: `${t("followup")} · ${label("scheduled")}` }));
  delete net.faults["continuations.cancel"];
  net.responses["continuations.cancel"] = { state: "canceled" };
  await fireEvent.press(ui.getByText(label("cancel")));
  await waitFor(() => expect(ui.getByText(`${t("followup")} · ${label("canceled")}`)).toBeTruthy());
  expect(ui.queryByRole("alert")).toBeNull();
});

test.each(["blocked", "completed", "admitted", "expired", "failed", "canceled"])(
  "%s checks do not offer fictional cancellation",
  async (state) => {
    const net = transport();
    const ui = await render(
      <ContinuationNotice
        part={terminal(state)}
        client={new ApxClient({ ...credentials, client: { name: "test", version: "1" } })}
      />,
    );
    expect(ui.queryByText(label("cancel"))).toBeNull();
    await fireEvent.press(ui.getByRole("button"));
    expect(ui.getByText("Check the report")).toBeTruthy();
    expect(ui.queryByText(label("cancel"))).toBeNull();
    if (state === "blocked") expect(ui.getByText(label("accessDetail"))).toBeTruthy();
    expect(net.calls).toEqual([]);
  },
);

test("a pending receipt without a usable connection does not offer cancellation", async () => {
  const ui = await render(<ContinuationNotice part={part} />);
  expect(ui.queryByText(label("cancel"))).toBeNull();
});

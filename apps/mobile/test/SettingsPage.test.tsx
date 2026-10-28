import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NoticePrefs } from "../../../packages/protocol/src/domain";
import { emptyWorkspace } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { SettingsPage } from "../src/pages/SettingsPage";
import { credentials, deferred, transport } from "./transport.test-support";

jest.mock("expo-notifications", () => ({
  ...jest.requireActual("expo-notifications"),
  getPermissionsAsync: jest.fn(async () => ({
    status: "denied",
    granted: false,
    canAskAgain: false,
    expires: "never",
  })),
  getPresentedNotificationsAsync: jest.fn(async () => []),
}));
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const prefs = NoticePrefs.parse({});
const view = (
  load: () => Promise<NoticePrefs>,
  save: (p: NoticePrefs) => Promise<NoticePrefs>,
  disconnect = jest.fn(),
) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <SettingsPage
      creds={credentials}
      data={emptyWorkspace}
      host="Acme"
      back={jest.fn()}
      disconnect={disconnect}
      load={load}
      save={save}
    />
  </SafeAreaProvider>
);
let net: ReturnType<typeof transport>;
beforeEach(() => {
  net = transport();
  net.responses["devices.list"] = { devices: [] };
});
afterEach(() => net.restore());

test("disconnect requires native destructive confirmation", async () => {
  const disconnect = jest.fn();
  const alert = jest.spyOn(Alert, "alert");
  const ui = await render(
    view(
      async () => prefs,
      async (p) => p,
      disconnect,
    ),
  );
  await fireEvent.press(ui.getByRole("button", { name: t("disconnect") }));
  expect(disconnect).not.toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)?.[2];
  expect(buttons?.find((b) => b.style === "cancel")?.text).toBe(t("cancel"));
  await act(async () => buttons?.find((b) => b.style === "destructive")?.onPress?.());
  expect(disconnect).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("a failed preference save rolls back its optimistic value and reports the failure", async () => {
  const save = jest.fn(async (_p: NoticePrefs): Promise<NoticePrefs> => {
    throw new Error("Core offline");
  });
  const alert = jest.spyOn(Alert, "alert");
  const ui = await render(view(async () => prefs, save));
  await fireEvent.press(ui.getByRole("button", { name: "10" }));
  expect(save).toHaveBeenCalledWith({ ...prefs, budget_per_day: 10 });
  expect(ui.getByRole("button", { name: String(prefs.budget_per_day) })).toBeSelected();
  expect(alert).toHaveBeenCalledWith(t("couldNotChange"), "Core offline");
  await ui.unmount();
});

test("an older save response cannot become the rollback baseline after a newer save succeeded", async () => {
  const first = deferred<NoticePrefs>();
  const second = deferred<NoticePrefs>();
  const save = jest
    .fn<Promise<NoticePrefs>, [NoticePrefs]>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockRejectedValueOnce(new Error("Latest failed"));
  const ui = await render(view(async () => prefs, save));
  await fireEvent.press(ui.getByRole("button", { name: "5" }));
  await fireEvent.press(ui.getByRole("button", { name: "10" }));
  await act(async () => second.resolve({ ...prefs, budget_per_day: 10 }));
  expect(ui.getByRole("button", { name: "10" })).toBeSelected();
  await act(async () => first.resolve({ ...prefs, budget_per_day: 5 }));
  expect(ui.getByRole("button", { name: "10" })).toBeSelected();
  await fireEvent.press(ui.getByRole("button", { name: "1" }));
  expect(ui.getByRole("button", { name: "10" })).toBeSelected();
  await ui.unmount();
});

test("a previous settings load cannot replace the current load's result", async () => {
  const previous = deferred<NoticePrefs>();
  const save = jest.fn(async (p: NoticePrefs) => p);
  const ui = await render(view(() => previous.promise, save));
  await ui.rerender(view(async () => ({ ...prefs, budget_per_day: 10 }), save));
  expect(ui.getByRole("button", { name: "10" })).toBeSelected();
  await act(async () => previous.resolve({ ...prefs, budget_per_day: 1 }));
  expect(ui.getByRole("button", { name: "10" })).toBeSelected();
  await ui.unmount();
});

test("quiet hours restore their previous range; the chat app for notices may be none, as in the panel (DECISIONS.md#d-161)", async () => {
  const quiet = { ...prefs, quiet_from: "21:30", quiet_to: "08:15" };
  const save = jest.fn(async (p: NoticePrefs) => p);
  const load = async () => quiet;
  const ui = await render(view(load, save));
  expect(ui.getByRole("button", { name: `${t("setQuietFrom")} 21:30` })).toBeVisible();
  await fireEvent.press(ui.getByRole("switch", { name: t("setQuietOn") }));
  expect(save).toHaveBeenLastCalledWith({ ...quiet, quiet_from: undefined, quiet_to: undefined });
  expect(ui.queryByText("21:30")).toBeNull();
  await fireEvent.press(ui.getByRole("switch", { name: t("setQuietOn") }));
  expect(save).toHaveBeenLastCalledWith(quiet);
  // Every phone is told: this one is shown, not picked.
  await fireEvent.press(ui.getByText(t("setThisPhone")));
  expect(save).toHaveBeenLastCalledWith(quiet);
  await fireEvent.press(ui.getByText(t("setNone")));
  expect(save).toHaveBeenLastCalledWith({ ...quiet, channel: "none" });
  await fireEvent.press(ui.getByText(t("setAuto")));
  expect(save).toHaveBeenLastCalledWith({ ...quiet, channel: undefined });
  await ui.unmount();
});

test("a failed pending save rolls back to a success confirmed after that request started", async () => {
  const first = deferred<NoticePrefs>();
  const second = deferred<NoticePrefs>();
  const save = jest
    .fn<Promise<NoticePrefs>, [NoticePrefs]>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const ui = await render(view(async () => prefs, save));
  await fireEvent.press(ui.getByRole("button", { name: "5" }));
  await fireEvent.press(ui.getByRole("button", { name: "10" }));
  await act(async () => first.resolve({ ...prefs, budget_per_day: 5 }));
  expect(ui.getByRole("button", { name: "10" })).toBeSelected();
  await act(async () => second.reject(new Error("Second failed")));
  expect(ui.getByRole("button", { name: "5" })).toBeSelected();
  await ui.unmount();
});

test("save failure after leaving settings does not raise an obsolete alert", async () => {
  const pending = deferred<NoticePrefs>();
  const alert = jest.spyOn(Alert, "alert");
  const save = jest.fn(() => pending.promise);
  const ui = await render(view(async () => prefs, save));
  await fireEvent.press(ui.getByRole("button", { name: "5" }));
  await ui.unmount();
  await act(async () => pending.reject(new Error("Late failure")));
  expect(alert).not.toHaveBeenCalled();
});

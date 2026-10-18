import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace, type Memory, type Workspace } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { type MemoryActions, MemoryPage } from "../src/pages/MemoryPage";
import { deferred } from "./transport.test-support";

const note: Memory = {
  id: "mem_one",
  text: "Review every change",
  scope: "global",
  source: "owner",
  tainted: false,
  updated_at: "2026-10-18T10:00:00Z",
};
const data: Workspace = {
  ...emptyWorkspace,
  projects: [
    { id: "p_one", name: "Acme", registered: true },
    { id: "p_hidden", name: "Hidden", registered: false },
  ],
  agents: [{ id: "april", name: "April" }],
  memories: 1,
};
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mount = (actions: MemoryActions, back = jest.fn()) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <MemoryPage data={data} actions={actions} back={back} />
    </SafeAreaProvider>,
  );
const actions = () => ({
  list: jest.fn(async () => [note]),
  add: jest.fn(async () => ({ ...note, id: "mem_new" })),
  remove: jest.fn(async () => {}),
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("memory lists notes and registered project scopes, and global/project filters use their distinct query shapes", async () => {
  const api = actions();
  const ui = await mount(api);
  await act(() => jest.advanceTimersByTimeAsync(0));
  expect(api.list).toHaveBeenLastCalledWith({ query: undefined });
  expect(ui.getByText(note.text)).toBeVisible();
  expect(ui.queryByText("Hidden")).toBeNull();
  await fireEvent.press(ui.getByRole("button", { name: t("memGlobal") }));
  await act(() => jest.advanceTimersByTimeAsync(0));
  expect(api.list).toHaveBeenLastCalledWith({ query: undefined, scope: "global" });
  await fireEvent.press(ui.getByText("Acme"));
  await act(() => jest.advanceTimersByTimeAsync(0));
  expect(api.list).toHaveBeenLastCalledWith({ query: undefined, scope: "project", project: "p_one" });
  await ui.unmount();
});

test("memory searches debounce typing and ignore an older answer that arrives after the latest result", async () => {
  const older = deferred<Memory[]>();
  const list = jest.fn(async (params: { query?: string }) =>
    params.query === "older"
      ? older.promise
      : [{ ...note, text: params.query === "latest" ? "Newest result" : note.text }],
  );
  const api = { ...actions(), list };
  const ui = await mount(api);
  await act(() => jest.advanceTimersByTimeAsync(0));
  await fireEvent.changeText(ui.getByPlaceholderText(t("memSearch")), "older");
  await act(() => jest.advanceTimersByTimeAsync(299));
  expect(list).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTimeAsync(1));
  expect(list).toHaveBeenLastCalledWith({ query: "older" });
  await fireEvent.changeText(ui.getByPlaceholderText(t("memSearch")), " latest ");
  await act(() => jest.advanceTimersByTimeAsync(300));
  expect(ui.getByText("Newest result")).toBeVisible();
  await act(async () => older.resolve([{ ...note, text: "Obsolete result" }]));
  expect(ui.getByText("Newest result")).toBeVisible();
  expect(ui.queryByText("Obsolete result")).toBeNull();
  await ui.unmount();
});

test("adding a note trims input, uses the selected project and returns to the list after saving", async () => {
  const api = actions();
  api.add.mockResolvedValue({ ...note, id: "mem_new", text: "Project note", scope: "project", project_id: "p_one" });
  const ui = await mount(api);
  await act(() => jest.advanceTimersByTimeAsync(0));
  await fireEvent.press(ui.getByText("Acme"));
  await act(() => jest.advanceTimersByTimeAsync(0));
  await fireEvent.press(ui.getByRole("button", { name: t("memNew") }));
  expect(ui.getByRole("button", { name: t("memSave") })).toBeDisabled();
  await fireEvent.changeText(ui.getByPlaceholderText(t("memPlaceholder")), "  Project note  ");
  await fireEvent.press(ui.getByRole("button", { name: t("memSave") }));
  expect(api.add).toHaveBeenCalledWith("Project note", "p_one");
  expect(ui.queryByPlaceholderText(t("memPlaceholder"))).toBeNull();
  expect(ui.getByText("Project note")).toBeVisible();
  await ui.unmount();
});

test("saving failure keeps the draft open, reports the error and lets the owner cancel without another save", async () => {
  const api = actions();
  api.add.mockRejectedValue(new Error("Core offline"));
  const alert = jest.spyOn(Alert, "alert");
  const ui = await mount(api);
  await act(() => jest.advanceTimersByTimeAsync(0));
  await fireEvent.press(ui.getByRole("button", { name: t("memNew") }));
  await fireEvent.changeText(ui.getByPlaceholderText(t("memPlaceholder")), "Draft note");
  await fireEvent.press(ui.getByRole("button", { name: t("memSave") }));
  expect(alert).toHaveBeenCalledWith(t("couldNotSave"), "Core offline");
  expect(ui.getByPlaceholderText(t("memPlaceholder"))).toHaveDisplayValue("Draft note");
  expect(ui.getByRole("button", { name: t("memSave") })).toBeEnabled();
  await fireEvent.press(ui.getByRole("button", { name: t("cancel") }));
  expect(ui.queryByPlaceholderText(t("memPlaceholder"))).toBeNull();
  expect(api.add).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("deleting a note waits for native confirmation and updates the list only after the action succeeds", async () => {
  const api = actions();
  const alert = jest.spyOn(Alert, "alert");
  const ui = await mount(api);
  await act(() => jest.advanceTimersByTimeAsync(0));
  await fireEvent.press(ui.getByLabelText(t("memDelete")));
  expect(api.remove).not.toHaveBeenCalled();
  expect(ui.getByText(note.text)).toBeVisible();
  const buttons = alert.mock.calls.at(-1)?.[2];
  expect(buttons?.find((button) => button.style === "cancel")?.text).toBe(t("cancel"));
  const confirm = buttons?.find((button) => button.style === "destructive")?.onPress;
  expect(confirm).toEqual(expect.any(Function));
  await act(async () => {
    confirm?.();
  });
  expect(api.remove).toHaveBeenCalledWith(note.id);
  expect(ui.queryByText(note.text)).toBeNull();
  expect(ui.getByText(t("memEmpty"))).toBeVisible();
  await ui.unmount();
});

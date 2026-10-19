import { act, fireEvent, render } from "@testing-library/react-native";
import { App } from "../src/App";
import { clearCreds, loadCreds } from "../src/creds";
import * as workspace from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { startPhoneNode } from "../src/phone";
import { ApxClient } from "../src/protocol";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../src/creds", () => ({
  loadCreds: jest.fn(async () => null),
  clearCreds: jest.fn(),
  saveCreds: jest.fn(),
}));
jest.mock("../src/phone", () => ({ startPhoneNode: jest.fn() }));
jest.mock("../src/PairScreen", () => ({ PairScreen: () => null }));
jest.mock("../src/WorkspaceScreen", () => ({ WorkspaceScreen: () => null }));

const previous = process.env.EXPO_PUBLIC_APX_INBOX_PREVIEW;
afterEach(() => {
  if (previous === undefined) delete process.env.EXPO_PUBLIC_APX_INBOX_PREVIEW;
  else process.env.EXPO_PUBLIC_APX_INBOX_PREVIEW = previous;
});

test("native preview renders the real inbox without credentials, subscriptions or network; callbacks remain local", async () => {
  process.env.EXPO_PUBLIC_APX_INBOX_PREVIEW = "1";
  const call = jest.spyOn(ApxClient.prototype, "call");
  const hook = jest.spyOn(workspace, "useWorkspace");
  const ui = await render(<App />);
  expect(ui.getByText(t("inboxPreview"))).toBeVisible();
  expect(ui.getByRole("button", { name: "Launch planning" })).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: "Launch planning" }));
  expect(ui.getByText(t("previewOpened", { name: "Launch planning (home)" }))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("newChat") }));
  expect(ui.getByText(t("previewCreate"))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("navMore") }));
  expect(ui.getByText(t("previewAccount"))).toBeVisible();
  await act(async () => {
    await ui.getByTestId("chats-list").props.refreshControl.props.onRefresh();
  });
  expect(ui.getByText(t("previewRefresh"))).toBeVisible();
  await fireEvent.press(ui.getByText("Northwind"));
  expect(ui.getByRole("button", { name: "Northwind review" })).toBeVisible();
  expect(ui.queryByRole("button", { name: "Launch planning" })).toBeNull();
  expect(loadCreds).not.toHaveBeenCalled();
  expect(clearCreds).not.toHaveBeenCalled();
  expect(startPhoneNode).not.toHaveBeenCalled();
  expect(hook).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: t("previewReturn") }));
  expect(ui.queryByText(t("inboxPreview"))).toBeNull();
  expect(loadCreds).toHaveBeenCalledTimes(1);
  expect(clearCreds).not.toHaveBeenCalled();
  await ui.unmount();
});

test.each([undefined, "0", "true"])("preview is opt-in: flag %s opens the actual app", async (flag) => {
  if (flag === undefined) delete process.env.EXPO_PUBLIC_APX_INBOX_PREVIEW;
  else process.env.EXPO_PUBLIC_APX_INBOX_PREVIEW = flag;
  const ui = await render(<App />);
  expect(ui.queryByText(t("inboxPreview"))).toBeNull();
  expect(loadCreds).toHaveBeenCalledTimes(1);
  expect(clearCreds).not.toHaveBeenCalled();
  await ui.unmount();
});

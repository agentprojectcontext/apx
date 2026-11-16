import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { CatalogEngine } from "../src/chat/models";
import { t } from "../src/i18n";
import { ChatComposer } from "../src/ui/ChatComposer";
import { ModelSheet } from "../src/ui/ModelSheet";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const mount = (children: React.ReactNode) =>
  render(<SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>);

const catalog: CatalogEngine[] = [
  {
    id: "chatgpt",
    kind: "provider",
    label: "ChatGPT",
    available: true,
    models: [
      { id: "gpt-6", name: "GPT-6", chat: true, efforts: ["low", "medium", "high"], default_effort: "medium" },
      { id: "mini", name: "Mini", chat: true },
    ],
  },
];

const sheet = async (current?: { model?: string; router: boolean }) => {
  const onPick = jest.fn();
  const ui = await mount(
    <ModelSheet
      {...(current ? { current } : {})}
      agentName="Roby"
      loadCatalog={async () => catalog}
      onPick={onPick}
      onClose={() => {}}
    />,
  );
  return { ui, onPick };
};

test("a model with levels opens them, and a level picks it as model#effort", async () => {
  const { ui, onPick } = await sheet();
  await waitFor(() => expect(ui.getByText("chatgpt/gpt-6")).toBeVisible());
  expect(ui.queryByText(t("effortHigh"))).toBeNull();
  await fireEvent.press(ui.getByText("chatgpt/gpt-6"));
  expect(onPick).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByText(t("effortHigh")));
  expect(onPick).toHaveBeenCalledWith({ model: "chatgpt/gpt-6#high", router: false });
  // The model's default level travels as no effort, as the panel sends it.
  await fireEvent.press(ui.getByText(t("effortMedium")));
  expect(onPick).toHaveBeenLastCalledWith({ model: "chatgpt/gpt-6", router: false });
  await ui.unmount();
});

test("a model without levels picks in one tap, and the chat's own model shows its effort on", async () => {
  const { ui, onPick } = await sheet({ model: "chatgpt/gpt-6#low", router: false });
  await waitFor(() => expect(ui.getByText(t("effortLow"))).toBeVisible());
  expect(ui.getByRole("button", { name: t("effortLow") })).toBeSelected();
  expect(ui.getByRole("button", { name: t("effortHigh") })).not.toBeSelected();
  await fireEvent.press(ui.getByText("chatgpt/mini"));
  expect(onPick).toHaveBeenCalledWith({ model: "chatgpt/mini", router: false });
  await ui.unmount();
});

test("the composer's model chip does not reach up over the send button", async () => {
  const ui = await mount(
    <ChatComposer
      text="hello"
      onChangeText={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      onAttach={() => {}}
      onModel={() => {}}
      attachments={[]}
      onRemoveAttachment={() => {}}
      voice={{ state: "idle", seconds: 0, start: () => {}, stop: () => {} }}
      online
      busy={false}
      stopping={false}
      agentName="Roby"
      model="chatgpt/gpt-6 · High"
    />,
  );
  const chip = ui.getByRole("button", { name: t("modelForChat") });
  expect(chip).toHaveTextContent("chatgpt/gpt-6 · High");
  expect(chip.props.hitSlop).toMatchObject({ top: 0 });
  await ui.unmount();
});

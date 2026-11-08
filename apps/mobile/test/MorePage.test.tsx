import { fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { MorePage } from "../src/pages/MorePage";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const GB = 1024 ** 3;

const view = (disk: { free_bytes: number; low: boolean } | undefined, freeSpace = jest.fn(async () => 2 * GB)) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <MorePage
      data={{ ...emptyWorkspace, ...(disk ? { disk } : {}) }}
      host="127.0.0.1"
      online
      onSelect={jest.fn()}
      freeSpace={freeSpace}
    />
  </SafeAreaProvider>
);

test("with the disk almost full, More says how much is left and frees what APX rebuilds on its own", async () => {
  const freeSpace = jest.fn(async () => 2 * GB);
  const ui = await render(view({ free_bytes: 0.5 * GB, low: true }, freeSpace));
  expect(ui.getByText(t("diskLow", { free: "512.0 MB" }))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("diskFree") }));
  expect(freeSpace).toHaveBeenCalledTimes(1);
  expect(await ui.findByText(t("diskFreed", { size: "2.0 GB" }))).toBeVisible();
  await ui.unmount();
});

test("with room on the disk, or an older core that does not say, there is no warning", async () => {
  for (const disk of [{ free_bytes: 90 * GB, low: false }, undefined]) {
    const ui = await render(view(disk));
    expect(ui.queryByRole("button", { name: t("diskFree") })).toBeNull();
    await ui.unmount();
  }
});

import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { t } from "../src/i18n";
import { PrivacySettings } from "../src/ui/PrivacySettings";
import { deferred } from "./transport.test-support";

function fixture() {
  let privacy = { location: true, trips: true, revision: "one" };
  let usage = true;
  const call = jest.fn(async (method: string, patch: Record<string, unknown>) => {
    if (method === "phone.configure_privacy") privacy = { ...privacy, ...patch };
    if (method === "telemetry.set") usage = patch.usage === true;
    return method.startsWith("telemetry.") ? { enabled: true, usage } : privacy;
  });
  return { call };
}

test("location, trip location and anonymous statistics change their shared preferences independently", async () => {
  const f = fixture();
  const ui = await render(<PrivacySettings call={f.call} />);
  expect(ui.getByRole("switch", { name: t("privacyLocation") })).toBeChecked();
  await fireEvent.press(ui.getByRole("switch", { name: t("privacyLocation") }));
  expect(f.call).toHaveBeenCalledWith("phone.configure_privacy", { location: false });
  expect(ui.getByRole("switch", { name: t("privacyLocation") })).not.toBeChecked();
  expect(ui.getByRole("switch", { name: t("privacyTrips") })).toBeChecked();
  await fireEvent.press(ui.getByRole("switch", { name: t("privacyStats") }));
  expect(f.call).toHaveBeenCalledWith("telemetry.set", { usage: false });
  expect(ui.getByRole("switch", { name: t("privacyStats") })).not.toBeChecked();
  expect(f.call).not.toHaveBeenCalledWith("devices.revoke", expect.anything());
  await ui.unmount();
});

test("a rejected save keeps the confirmed preference and reports the error", async () => {
  const f = fixture();
  const alert = jest.spyOn(Alert, "alert");
  const call = jest.fn((method: string, patch: Record<string, unknown>) =>
    method === "phone.configure_privacy" ? Promise.reject(new Error("Offline")) : f.call(method, patch),
  );
  const ui = await render(<PrivacySettings call={call} />);
  await fireEvent.press(ui.getByRole("switch", { name: t("privacyLocation") }));
  expect(ui.getByRole("switch", { name: t("privacyLocation") })).toBeChecked();
  expect(alert).toHaveBeenCalledWith(t("couldNotChange"), "Error: Offline");
  await ui.unmount();
});

test("an older core leaves unavailable location choices disabled but retains its statistics choice", async () => {
  const f = fixture();
  const call = jest.fn((method: string, patch: Record<string, unknown>) =>
    method.startsWith("phone.") ? Promise.reject(new Error("Unknown method")) : f.call(method, patch),
  );
  const ui = await render(<PrivacySettings call={call} />);
  expect(ui.getByRole("switch", { name: t("privacyLocation") })).toBeDisabled();
  expect(ui.getByRole("switch", { name: t("privacyStats") })).not.toBeDisabled();
  await fireEvent.press(ui.getByRole("switch", { name: t("privacyStats") }));
  expect(f.call).toHaveBeenCalledWith("telemetry.set", { usage: false });
  await ui.unmount();
});

test("a slow read cannot overwrite the result of a later save", async () => {
  const f = fixture();
  const old = deferred<unknown>();
  let slow = false;
  const call = jest.fn((method: string, patch: Record<string, unknown>) =>
    method === "phone.privacy" && slow ? old.promise : f.call(method, patch),
  );
  const ui = await render(<PrivacySettings call={call} />);
  slow = true;
  await ui.rerender(<PrivacySettings call={call.bind(null)} />);
  slow = false;
  await fireEvent.press(ui.getByRole("switch", { name: t("privacyLocation") }));
  await act(async () => old.resolve({ location: true, trips: true, revision: "old" }));
  expect(ui.getByRole("switch", { name: t("privacyLocation") })).not.toBeChecked();
  await ui.unmount();
});

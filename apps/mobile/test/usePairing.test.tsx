import { act, renderHook } from "@testing-library/react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { usePairing } from "../src/hooks/usePairing";
import { t } from "../src/i18n";

const core = "https://core.example.com";
const credentials = { url: core, token: "paired-test-token", device: "dev_phone" };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

beforeEach(() => jest.spyOn(Crypto, "randomUUID").mockReturnValue("f89d0356-6cca-4cc0-88ee-26105910c373"));

test("pairing probes addresses, trims the code and saves credentials before handing off to the app", async () => {
  const order: string[] = [];
  const save = jest.spyOn(SecureStore, "setItemAsync").mockImplementation(async () => {
    order.push("saved");
  });
  const paired = jest.fn(() => order.push("paired"));
  const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("http://offline.local")) throw new Error("Not reachable");
    if (url.endsWith("/health")) return reply({});
    return reply({ ok: true, result: { token: credentials.token, device: { id: credentials.device } } });
  });
  const hook = await renderHook(() => usePairing(undefined, paired));
  await act(() => hook.result.current.pair(["http://offline.local", core], " 123456 "));
  expect(save).toHaveBeenCalledWith("apx.pairing", JSON.stringify(credentials));
  expect(paired).toHaveBeenCalledWith(credentials);
  expect(order).toEqual(["saved", "paired"]);
  const request = fetch.mock.calls.find(([url]) => String(url).endsWith("/rpc/devices.pair"));
  expect(request?.[0]).toBe(`${core}/rpc/devices.pair`);
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    code: "123456",
    name: Platform.OS === "android" ? Platform.constants.Model : Platform.OS === "ios" ? "iPhone" : "Phone",
    platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "other",
  });
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.error).toBe("");
  await hook.unmount();
});

test("an incoming QR is consumed once even when the completion callback changes", async () => {
  jest.spyOn(SecureStore, "setItemAsync").mockResolvedValue(undefined);
  const fetch = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input).endsWith("/health")
        ? reply({})
        : reply({ ok: true, result: { token: credentials.token, device: { id: credentials.device } } }),
    );
  const link = `apx://pair?c=123456&u=${encodeURIComponent(core)}`;
  const first = jest.fn();
  const second = jest.fn();
  const hook = await renderHook((onPaired: typeof first) => usePairing(link, onPaired), { initialProps: first });
  expect(first).toHaveBeenCalledTimes(1);
  await hook.rerender(second);
  expect(second).not.toHaveBeenCalled();
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/rpc/devices.pair"))).toHaveLength(1);
  await hook.unmount();
});

test("concurrent taps pair only once and busy clears when the pending response completes", async () => {
  let finish: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const paired = jest.fn();
  jest.spyOn(SecureStore, "setItemAsync").mockResolvedValue(undefined);
  const fetch = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => (String(input).endsWith("/health") ? reply({}) : pending));
  const hook = await renderHook(() => usePairing(undefined, paired));
  let pairing: Promise<void> | undefined;
  await act(async () => {
    pairing = hook.result.current.pair([core], "123456");
  });
  expect(hook.result.current.busy).toBe(true);
  await act(() => hook.result.current.pair([core], "654321"));
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/rpc/devices.pair"))).toHaveLength(1);
  await act(async () => {
    finish(reply({ ok: true, result: { token: credentials.token, device: { id: credentials.device } } }));
    await pairing;
  });
  expect(paired).toHaveBeenCalledTimes(1);
  expect(hook.result.current.busy).toBe(false);
  await hook.unmount();
});

test("unreachable addresses never send a pairing request or save a key", async () => {
  const save = jest.spyOn(SecureStore, "setItemAsync");
  const paired = jest.fn();
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
  const hook = await renderHook(() => usePairing(undefined, paired));
  await act(() => hook.result.current.pair([core], "123456"));
  expect(hook.result.current.error).toBe(t("unreachable"));
  expect(hook.result.current.busy).toBe(false);
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith("/health"))).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  expect(paired).not.toHaveBeenCalled();
  await hook.unmount();
});

test("bad and rate-limited codes show different failures, preserve no credentials and permit retry", async () => {
  const save = jest.spyOn(SecureStore, "setItemAsync");
  const paired = jest.fn();
  let message = "Code expired";
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input).endsWith("/health")
        ? reply({})
        : reply({ ok: false, error: { code: "unauthorized", message } }, false),
    );
  const hook = await renderHook(() => usePairing(undefined, paired));
  await act(() => hook.result.current.pair([core], "123456"));
  expect(hook.result.current.error).toBe(t("badCode"));
  expect(hook.result.current.busy).toBe(false);
  message = "Too many attempts";
  await act(() => hook.result.current.pair([core], "123456"));
  expect(hook.result.current.error).toBe(t("lockedCode"));
  expect(hook.result.current.busy).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(paired).not.toHaveBeenCalled();
  await hook.unmount();
});

test("secure storage failure keeps the app unpaired and reports the error", async () => {
  jest.spyOn(SecureStore, "setItemAsync").mockRejectedValue(new Error("Keystore locked"));
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input).endsWith("/health")
        ? reply({})
        : reply({ ok: true, result: { token: credentials.token, device: { id: credentials.device } } }),
    );
  const paired = jest.fn();
  const hook = await renderHook(() => usePairing(undefined, paired));
  await act(() => hook.result.current.pair([core], "123456"));
  expect(paired).not.toHaveBeenCalled();
  expect(hook.result.current.busy).toBe(false);
  expect(hook.result.current.error).toBe(t("failed", { error: "Keystore locked" }));
  await hook.unmount();
});

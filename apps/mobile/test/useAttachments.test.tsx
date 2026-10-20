import { act, renderHook } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useAttachments } from "../src/chat/useAttachments";
import type { ApxClient } from "../src/protocol";

const mockPicker = {
  canceled: true,
  assets: [] as { uri: string; fileName?: string; mimeType?: string; fileSize?: number }[],
};
const mockPickDocuments = {
  canceled: true,
  assets: [] as { uri: string; name: string; mimeType?: string; size?: number }[],
};
const mockBase64 = jest.fn(async () => "encoded-file");
const mockUploadCall = jest.fn(async () => ({ media: { id: "med_saved" } }));
const mockCameraPermission = jest.fn(async () => ({ granted: true }));
const mockCameraLaunch = jest.fn(
  async (_options: unknown): Promise<typeof mockPicker> => ({ canceled: true, assets: [] }),
);
const mockPhotoLaunch = jest.fn(async (_options: unknown) => mockPicker);
const mockDocsLaunch = jest.fn(async (_options: unknown) => mockPickDocuments);
jest.mock("expo-file-system", () => ({ File: jest.fn().mockImplementation(() => ({ base64: mockBase64 })) }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (options: unknown) => mockPhotoLaunch(options),
  requestCameraPermissionsAsync: () => mockCameraPermission(),
  launchCameraAsync: (options: unknown) => mockCameraLaunch(options),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: (options: unknown) => mockDocsLaunch(options) }));

const client = { call: mockUploadCall } as unknown as ApxClient;
beforeEach(() => {
  mockPicker.canceled = true;
  mockPicker.assets = [];
  mockPickDocuments.canceled = true;
  mockPickDocuments.assets = [];
  mockBase64.mockClear();
  mockUploadCall.mockClear();
  mockUploadCall.mockResolvedValue({ media: { id: "med_saved" } });
  mockPhotoLaunch.mockClear();
  mockCameraPermission.mockClear();
  mockCameraLaunch.mockClear();
  mockDocsLaunch.mockClear();
});

afterEach(() => jest.restoreAllMocks());

test("videos and documents over 2 MB upload within the shared 20 MB file limit", async () => {
  const alert = jest.spyOn(Alert, "alert");
  const hook = await renderHook(() => useAttachments(client, "thr_chat"));
  for (const [name, mime, size] of [
    ["clip.mp4", "video/mp4", 5_333_561],
    ["report.pdf", "application/pdf", 20 * 1024 * 1024],
  ] as const) {
    await act(async () => {
      const uploaded = await hook.result.current.upload(`file://${name}`, name, mime, size);
      expect(uploaded).toEqual(expect.objectContaining({ id: "med_saved", kind: "file", name, mime }));
    });
  }
  expect(alert).not.toHaveBeenCalled();
  expect(mockUploadCall).toHaveBeenCalledTimes(2);
  expect(hook.result.current.items).toHaveLength(2);
  expect(hook.result.current.uploading).toBe(false);
  await hook.unmount();
});

test("uploads a selected image with chat scope and take drains only uploaded media ids", async () => {
  const hook = await renderHook(() => useAttachments(client, "thr_chat"));
  let uploaded: unknown;
  await act(async () => {
    uploaded = await hook.result.current.upload("file://photo", "photo.png", "image/png", 1024);
  });
  expect(mockBase64).toHaveBeenCalledTimes(1);
  expect(mockUploadCall).toHaveBeenCalledWith("media.upload", {
    name: "photo.png",
    mime: "image/png",
    data: "encoded-file",
    thread: "thr_chat",
  });
  expect(hook.result.current.items).toEqual([
    {
      key: expect.stringContaining(":photo.png"),
      name: "photo.png",
      kind: "image",
      uri: "file://photo",
      mime: "image/png",
      id: "med_saved",
    },
  ]);
  expect(uploaded).toEqual(hook.result.current.items[0]);
  expect(hook.result.current.uploading).toBe(false);
  await act(async () => {
    expect(hook.result.current.take()).toEqual(["med_saved"]);
  });
  expect(hook.result.current.items).toEqual([]);
  await hook.unmount();
});

test("rejects oversized files before reading and reports upload failures without leaving stale tray items", async () => {
  const alert = jest.spyOn(Alert, "alert");
  const hook = await renderHook(() => useAttachments(client, undefined));
  await act(async () => {
    expect(
      await hook.result.current.upload("file://huge", "huge.pdf", "application/pdf", 20 * 1024 * 1024 + 1),
    ).toBeUndefined();
  });
  expect(mockBase64).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalled();
  mockUploadCall.mockRejectedValueOnce(new Error("Core offline"));
  await act(async () => {
    expect(await hook.result.current.upload("file://small", "small.pdf", "application/pdf")).toBeUndefined();
  });
  expect(mockUploadCall).toHaveBeenCalledWith("media.upload", {
    name: "small.pdf",
    mime: "application/pdf",
    data: "encoded-file",
  });
  expect(hook.result.current.items).toEqual([]);
  expect(hook.result.current.uploading).toBe(false);
  expect(alert).toHaveBeenLastCalledWith(expect.any(String), "Core offline");
  await hook.unmount();
});

test("mockPicker actions honor cancellation and upload selected images, camera photos, and documents", async () => {
  const hook = await renderHook(() => useAttachments(client, undefined));
  await act(async () => {
    await hook.result.current.pickPhotos();
    await hook.result.current.pickFiles();
  });
  expect(mockUploadCall).not.toHaveBeenCalled();
  mockPicker.canceled = false;
  mockPicker.assets = [{ uri: "file://picked", fileName: "picked.jpg", mimeType: "image/jpeg", fileSize: 50 }];
  mockPickDocuments.canceled = false;
  mockPickDocuments.assets = [{ uri: "file://doc", name: "report.txt", mimeType: "text/plain", size: 40 }];
  mockCameraLaunch.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file://camera", fileName: "camera.jpg", mimeType: "image/jpeg" }],
  });
  await act(async () => {
    await hook.result.current.pickPhotos();
    await hook.result.current.takePhoto();
    await hook.result.current.pickFiles();
  });
  expect(mockPhotoLaunch).toHaveBeenLastCalledWith({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: 8,
    quality: 0.7,
  });
  expect(mockCameraPermission).toHaveBeenCalledTimes(1);
  expect(mockCameraLaunch).toHaveBeenCalledWith({ mediaTypes: ["images"], quality: 0.7 });
  expect(mockUploadCall).toHaveBeenCalledTimes(3);
  expect(hook.result.current.items.map(({ name, kind }) => [name, kind])).toEqual([
    ["picked.jpg", "image"],
    ["camera.jpg", "image"],
    ["report.txt", "file"],
  ]);
  const key = hook.result.current.items[0]?.key;
  await act(async () => hook.result.current.remove(key ?? "missing"));
  expect(hook.result.current.items.map((item) => item.name)).toEqual(["camera.jpg", "report.txt"]);
  await hook.unmount();
});

test("removing an in-flight attachment prevents its late response from restoring it", async () => {
  const pending = Promise.withResolvers<{ media: { id: string } }>();
  mockUploadCall.mockReturnValueOnce(pending.promise);
  const hook = await renderHook(() => useAttachments(client, "thr_chat"));
  let upload: Promise<unknown> = Promise.resolve();
  await act(async () => {
    upload = hook.result.current.upload("file://pending", "pending.mp3", "audio/mpeg", 100);
  });
  expect(hook.result.current.uploading).toBe(true);
  expect(hook.result.current.items).toEqual([expect.objectContaining({ name: "pending.mp3", kind: "audio" })]);
  const item = hook.result.current.items[0];
  expect(item).toBeDefined();
  if (!item) throw new Error("Expected pending attachment");
  await act(async () => hook.result.current.remove(item.key));
  expect(hook.result.current.items).toEqual([]);
  await act(async () => {
    pending.resolve({ media: { id: "med_late" } });
    await upload;
  });
  expect(hook.result.current.items).toEqual([]);
  expect(hook.result.current.uploading).toBe(false);
  await act(async () => expect(hook.result.current.take()).toEqual([]));
  await hook.unmount();
});

test("camera permission denial avoids opening the camera", async () => {
  mockCameraPermission.mockResolvedValueOnce({ granted: false });
  const hook = await renderHook(() => useAttachments(client, undefined));
  await act(async () => hook.result.current.takePhoto());
  expect(mockCameraLaunch).not.toHaveBeenCalled();
  await hook.unmount();
});

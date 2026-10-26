import { Alert } from "react-native";
import type { MediaItem } from "../src/chat/media";
import { saveMedia, shareMedia } from "../src/chat/mediaFiles";
import type { ApxClient } from "../src/protocol";

const mockFiles = new Map<string, string>();
const mockDeleted: string[] = [];
const mockCreateAsset = jest.fn();
const mockShare = jest.fn();
const mockPermissions = jest.fn();
const mockRequest = jest.fn();
const mockFlash = jest.fn();

jest.mock("expo-crypto", () => ({ randomUUID: () => "unique-copy" }));
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  Directory: class {
    uri: string;
    exists = false;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/");
    }
    create() {
      this.exists = true;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/");
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length ?? 0;
    }
    create() {
      mockFiles.set(this.uri, "");
    }
    write(data: string) {
      mockFiles.set(this.uri, data);
    }
    copy(to: { uri: string }) {
      mockFiles.set(to.uri, mockFiles.get(this.uri) ?? "");
    }
    static async downloadFileAsync(_url: string, file: { uri: string }) {
      mockFiles.set(file.uri, "web-image");
      return file;
    }
  },
}));
jest.mock("expo-media-library", () => ({
  Asset: { create: (uri: string) => mockCreateAsset(uri) },
  getPermissionsAsync: (...args: unknown[]) => mockPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequest(...args),
}));
jest.mock("expo-sharing", () => ({ shareAsync: (...args: unknown[]) => mockShare(...args) }));
jest.mock("../src/ui/Flash", () => ({ flash: (...args: unknown[]) => mockFlash(...args) }));

let nextId = 0;
const item = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  key: `key-${++nextId}`,
  media_id: `med_${nextId}`,
  kind: "image",
  mime: "image/jpeg",
  name: "image.bin",
  ...overrides,
});
const call = jest.fn(async () => ({ data: "aW1hZ2U=" }));
const client = { call } as unknown as ApxClient;

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleted.length = 0;
  mockPermissions.mockResolvedValue({ granted: true });
  mockRequest.mockResolvedValue({ granted: false });
  mockCreateAsset.mockImplementation(async (uri: string) => {
    if (!/\/asset\.(jpg|png|webp|mp4|mov)$/.test(uri)) throw new Error("DCIM not allowed for external/file");
    expect(mockFiles.get(uri)).toBeTruthy();
  });
});

test.each([
  ["image/jpeg", "photo.bin", "image", "jpg"],
  ["image/png", "no extension", "image", "png"],
  ["image/webp", "content://media/external/images/42", "image", "webp"],
  ["video/mp4", "clip.txt", "video", "mp4"],
  ["video/quicktime", "clip", "video", "mov"],
] as const)("saving %s stages typed bytes, publishes, then cleans the copy", async (mime, name, kind, ext) => {
  await saveMedia(client, item({ mime, name, kind }));
  expect(mockCreateAsset).toHaveBeenCalledWith(`file:///cache/gallery-unique-copy/asset.${ext}`);
  expect(mockFlash).toHaveBeenCalledTimes(1);
  expect(mockDeleted).toEqual(["file:///cache/gallery-unique-copy"]);
  expect(mockPermissions).toHaveBeenCalledWith(true, [kind === "video" ? "video" : "photo"]);
  expect(mockRequest).not.toHaveBeenCalled();
});

test("remote images get the same gallery staging", async () => {
  await saveMedia(client, item({ media_id: undefined, url: "https://example.com/image", name: "remote.txt" }));
  expect(mockCreateAsset).toHaveBeenCalledWith("file:///cache/gallery-unique-copy/asset.jpg");
});

test("permission refusal does not read media or publish success", async () => {
  mockPermissions.mockResolvedValue({ granted: false });
  const alert = jest.spyOn(Alert, "alert");
  await saveMedia(client, item());
  expect(call).not.toHaveBeenCalled();
  expect(mockRequest).toHaveBeenCalledWith(true, ["photo"]);
  expect(mockCreateAsset).not.toHaveBeenCalled();
  expect(mockFlash).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalled();
});

test("native failure cleans the copy, reports the error and permits retry", async () => {
  const media = item();
  const alert = jest.spyOn(Alert, "alert");
  mockCreateAsset.mockRejectedValueOnce(new Error("storage full"));
  await saveMedia(client, media);
  expect(mockDeleted).toHaveLength(1);
  expect(mockFlash).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(expect.any(String), "storage full");
  await saveMedia(client, media);
  expect(mockCreateAsset).toHaveBeenCalledTimes(2);
  expect(mockFlash).toHaveBeenCalledTimes(1);
});

test("failed downloads never reach the gallery and can be fetched again", async () => {
  const media = item();
  const alert = jest.spyOn(Alert, "alert");
  call.mockRejectedValueOnce(new Error("core unavailable"));
  await saveMedia(client, media);
  expect(mockCreateAsset).not.toHaveBeenCalled();
  expect(mockDeleted).toHaveLength(0);
  expect(mockFlash).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(expect.any(String), "core unavailable");
  await saveMedia(client, media);
  expect(call).toHaveBeenCalledTimes(2);
  expect(mockCreateAsset).toHaveBeenCalledTimes(1);
  expect(mockFlash).toHaveBeenCalledTimes(1);
});

test("documents and unknown types open Files sharing without gallery permissions or a false saved notice", async () => {
  await saveMedia(client, item({ kind: "file", mime: "application/pdf", name: "notes.pdf" }));
  await saveMedia(client, item({ mime: "image/x-unknown" }));
  expect(mockPermissions).not.toHaveBeenCalled();
  expect(mockCreateAsset).not.toHaveBeenCalled();
  expect(mockFlash).not.toHaveBeenCalled();
  expect(mockShare).toHaveBeenCalledTimes(2);
});

test("sharing retains the display filename rather than the gallery staging name", async () => {
  await shareMedia(client, item({ mime: "image/png", name: "original.png" }));
  expect(mockShare).toHaveBeenCalledWith(expect.stringMatching(/\/original\.png$/), {
    mimeType: "image/png",
    dialogTitle: "original.png",
  });
});

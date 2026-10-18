import { act, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { emptyWorkspace, type FileEntry } from "../src/hooks/useWorkspace";
import { t } from "../src/i18n";
import { type FileActions, FilesPage } from "../src/pages/FilesPage";
import { deferred } from "./transport.test-support";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 20, right: 0, bottom: 20, left: 0 } };
const data = {
  ...emptyWorkspace,
  projects: [
    { id: "p_one", name: "Acme", path: "/work/acme", registered: true },
    { id: "p_remote", name: "No folder" },
    { id: "p_hidden", name: "Hidden", path: "/work/hidden", registered: false },
  ],
};
const entry = (name: string, kind: "dir" | "file" = "file", bytes = 1): FileEntry => ({
  name,
  path: name,
  kind,
  bytes,
});
const actions = () => ({
  tree: jest.fn(async (_project: string, _dir: string) => ({ entries: [entry("readme.txt")], truncated: false })),
  read: jest.fn(
    async (_project: string, path: string): ReturnType<FileActions["read"]> => ({
      path,
      text: "File contents",
      binary: false,
      truncated: false,
      bytes: 13,
    }),
  ),
  media: jest.fn(async (_project: string, _path: string) => ({ mime: "image/png", data: "aW1hZ2U=", bytes: 5 })),
});
const mount = (api: FileActions, back = jest.fn()) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <FilesPage data={data} actions={api} back={back} />
    </SafeAreaProvider>,
  );
const openProject = async (ui: Awaited<ReturnType<typeof mount>>) => {
  await fireEvent.press(ui.getByText("Acme"));
};

test("only registered projects with a local folder can be browsed, and back exits the picker", async () => {
  const api = actions();
  const back = jest.fn();
  const ui = await mount(api, back);
  expect(ui.getByText("Acme")).toBeVisible();
  expect(ui.queryByText("No folder")).toBeNull();
  expect(ui.queryByText("Hidden")).toBeNull();
  expect(api.tree).not.toHaveBeenCalled();
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  expect(back).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("folders sort before files, sizes and truncation are visible, and back walks to the parent", async () => {
  const api = actions();
  api.tree.mockImplementation(async (_project, dir) => ({
    entries: dir ? [] : [entry("z.txt", "file", 1536), entry("assets", "dir"), entry("a.txt", "file", 2097152)],
    truncated: !dir,
  }));
  const ui = await mount(api);
  await openProject(ui);
  expect(api.tree).toHaveBeenLastCalledWith("p_one", "");
  const labels = ui.getAllByText(/^(assets|a\.txt|z\.txt)$/).map((node) => node.props.children);
  expect(labels).toEqual(["assets", "a.txt", "z.txt"]);
  expect(ui.getByText("2 KB")).toBeVisible();
  expect(ui.getByText("2.0 MB")).toBeVisible();
  expect(ui.getByText(t("filesMore"))).toBeVisible();
  await fireEvent.press(ui.getByText("assets"));
  expect(api.tree).toHaveBeenLastCalledWith("p_one", "assets");
  expect(ui.getByText(t("filesEmptyDir"))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  expect(api.tree).toHaveBeenLastCalledWith("p_one", "");
  await ui.unmount();
});

test("text and binary files use the read API, display truncation or the binary notice, and return to their folder", async () => {
  const api = actions();
  api.read
    .mockResolvedValueOnce({
      path: "readme.txt",
      text: "Truncated contents",
      binary: false,
      truncated: true,
      bytes: 18,
    })
    .mockResolvedValueOnce({ path: "readme.txt", text: undefined, binary: true, truncated: false, bytes: 18 });
  const ui = await mount(api);
  await openProject(ui);
  await fireEvent.press(ui.getByText("readme.txt"));
  expect(api.read).toHaveBeenCalledWith("p_one", "readme.txt");
  expect(api.media).not.toHaveBeenCalled();
  expect(ui.getByText("Truncated contents")).toBeVisible();
  expect(ui.getByText(t("filesTruncated"))).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  await fireEvent.press(ui.getByText("readme.txt"));
  expect(ui.getByText(t("filesBinary"))).toBeVisible();
  await ui.unmount();
});

test("images use the media API and the supplied MIME type, while Markdown renders its content", async () => {
  const api = actions();
  api.tree.mockResolvedValue({ entries: [entry("cover.PNG"), entry("notes.md")], truncated: false });
  const ui = await mount(api);
  await openProject(ui);
  await fireEvent.press(ui.getByText("cover.PNG"));
  expect(api.media).toHaveBeenCalledWith("p_one", "cover.PNG");
  expect(api.read).not.toHaveBeenCalled();
  expect(ui.getByLabelText("cover.PNG").props.source).toEqual({ uri: "data:image/png;base64,aW1hZ2U=" });
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  api.read.mockResolvedValue({ path: "notes.md", text: "# Heading", binary: false, truncated: false, bytes: 9 });
  await fireEvent.press(ui.getByText("notes.md"));
  expect(ui.getByText("Heading")).toBeVisible();
  await ui.unmount();
});

test("listing failures and failed file reads show their own error instead of an endless spinner", async () => {
  const api = actions();
  api.tree.mockRejectedValueOnce(new Error("Folder unavailable"));
  const ui = await mount(api);
  await openProject(ui);
  expect(ui.getByText("Folder unavailable")).toBeVisible();
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  await openProject(ui);
  api.read.mockRejectedValueOnce(new Error("Read refused"));
  await fireEvent.press(ui.getByText("readme.txt"));
  expect(ui.getByText("Read refused")).toBeVisible();
  await ui.unmount();
});

test("leaving a folder drops its late response and preserves the project picker", async () => {
  const api = actions();
  const pending = deferred<{ entries: FileEntry[]; truncated: boolean }>();
  api.tree.mockReturnValue(pending.promise);
  const ui = await mount(api);
  await openProject(ui);
  await fireEvent.press(ui.getByRole("button", { name: t("back") }));
  await act(async () => pending.resolve({ entries: [entry("Old response")], truncated: false }));
  expect(ui.getByText(t("filesPickProject"))).toBeVisible();
  expect(ui.queryByText("Old response")).toBeNull();
  await ui.unmount();
});

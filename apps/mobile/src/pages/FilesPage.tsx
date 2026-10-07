import { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FileEntry, Project, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { EmptyState, IconTile, ListGroup, ListRow, Screen, Spinner, SubHeader, type } from "../ui/kit";
import { Markdown } from "../ui/Markdown";
import { theme } from "../ui/theme";

export type FileActions = {
  tree: (project: string, dir: string) => Promise<{ entries: FileEntry[]; truncated: boolean }>;
  read: (
    project: string,
    path: string,
  ) => Promise<{ path: string; bytes: number; binary: boolean; truncated: boolean; text?: string }>;
  media: (project: string, path: string) => Promise<{ mime: string; data: string; bytes: number }>;
};

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const size = (bytes?: number) =>
  bytes === undefined
    ? undefined
    : bytes < 1024
      ? `${bytes} B`
      : bytes < 1048576
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1048576).toFixed(1)} MB`;

/** A project's files, read only: folders to walk into, and text, markdown or images to look at. */
export function FilesPage({ data, back, actions }: { data: Workspace; back: () => void; actions: FileActions }) {
  const [project, setProject] = useState<Project>();
  // The open folders, deepest last; a file is open when `file` is set.
  const [dirs, setDirs] = useState<string[]>([]);
  const [file, setFile] = useState<FileEntry>();
  const projects = data.projects.filter((item) => item.path && item.registered !== false);
  const up = () => {
    if (file) setFile(undefined);
    else if (dirs.length) setDirs((list) => list.slice(0, -1));
    else if (project) setProject(undefined);
    else back();
  };
  const dir = dirs.at(-1) ?? "";
  const title = file?.name ?? (dir ? (dir.split("/").at(-1) ?? dir) : (project?.name ?? t("files")));
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={title} back={up} />
      {!project ? (
        <Screen>
          {projects.length ? (
            <>
              <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("filesPickProject")}</Text>
              <ListGroup>
                {projects.map((item) => (
                  <ListRow
                    key={item.id}
                    label={item.name}
                    leading={<IconTile icon="Folder" tone="violet" />}
                    onPress={() => setProject(item)}
                  />
                ))}
              </ListGroup>
            </>
          ) : (
            <EmptyState title={t("files")} body={t("filesNoProjects")} icon="Folder" />
          )}
        </Screen>
      ) : file ? (
        <FileView project={project.id} file={file} actions={actions} />
      ) : (
        <Folder
          project={project.id}
          dir={dir}
          actions={actions}
          open={(entry) => (entry.kind === "dir" ? setDirs((list) => [...list, entry.path]) : setFile(entry))}
        />
      )}
    </View>
  );
}

function Folder({
  project,
  dir,
  actions,
  open,
}: {
  project: string;
  dir: string;
  actions: FileActions;
  open: (entry: FileEntry) => void;
}) {
  const [listing, setListing] = useState<{ entries: FileEntry[]; truncated: boolean }>();
  const [error, setError] = useState("");
  useEffect(() => {
    setListing(undefined);
    void actions
      .tree(project, dir)
      .then((result) => {
        const sorted = [...result.entries].sort(
          (a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name),
        );
        setListing({ entries: sorted, truncated: result.truncated });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [actions, project, dir]);
  if (error) return <EmptyState title={t("couldNotOpen")} body={error} icon="TriangleAlert" />;
  if (!listing)
    return (
      <View style={s.loading}>
        <Spinner size={20} />
      </View>
    );
  return (
    <Screen>
      {listing.entries.length ? (
        <ListGroup>
          {listing.entries.map((entry) => (
            <ListRow
              key={entry.path}
              label={entry.name}
              detail={entry.kind === "file" ? size(entry.bytes) : undefined}
              leading={
                <Icon
                  name={entry.kind === "dir" ? "Folder" : "FileText"}
                  size={18}
                  color={entry.kind === "dir" ? theme.violetSoftFg : theme.fgMuted}
                />
              }
              onPress={() => open(entry)}
            />
          ))}
        </ListGroup>
      ) : (
        <Text style={[type.muted, { padding: 4 }]}>{t("filesEmptyDir")}</Text>
      )}
      {listing.truncated ? <Text style={type.meta}>{t("filesMore")}</Text> : null}
    </Screen>
  );
}

function FileView({ project, file, actions }: { project: string; file: FileEntry; actions: FileActions }) {
  const [text, setText] = useState<{ text?: string; binary: boolean; truncated: boolean }>();
  const [image, setImage] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    if (IMAGE.test(file.name))
      void actions
        .media(project, file.path)
        .then((media) => setImage(`data:${media.mime};base64,${media.data}`))
        .catch(fail);
    else void actions.read(project, file.path).then(setText).catch(fail);
  }, [actions, project, file]);
  if (error) return <EmptyState title={t("couldNotOpen")} body={error} icon="TriangleAlert" />;
  if (image)
    return (
      <View style={s.imageWrap}>
        <Image source={{ uri: image }} resizeMode="contain" style={s.image} accessibilityLabel={file.name} />
      </View>
    );
  if (!text)
    return (
      <View style={s.loading}>
        <Spinner size={20} />
      </View>
    );
  if (text.binary || text.text === undefined)
    return <EmptyState title={file.name} body={t("filesBinary")} icon="FileText" />;
  return (
    <ScrollView contentContainerStyle={s.file}>
      {text.truncated ? <Text style={type.meta}>{t("filesTruncated")}</Text> : null}
      {MARKDOWN.test(file.name) ? (
        <Markdown text={text.text} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text selectable style={s.code}>
            {text.text}
          </Text>
        </ScrollView>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  loading: { padding: 40, alignItems: "center" },
  file: { padding: 16, paddingBottom: 40, gap: 10 },
  code: { color: theme.fg, fontFamily: theme.mono, fontSize: 12, lineHeight: 18 },
  imageWrap: { flex: 1, padding: 16 },
  image: { flex: 1, width: "100%" },
});

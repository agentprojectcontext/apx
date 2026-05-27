import { http } from "../http.js";

export async function cmdPluginsList() {
  const data = await http.get("/plugins");
  const ids = Object.keys(data);
  if (ids.length === 0) {
    console.log("(no plugins loaded)");
    return;
  }
  for (const id of ids) {
    const s = data[id];
    console.log(`# ${id}`);
    console.log(JSON.stringify(s, null, 2));
    console.log("");
  }
}

export async function cmdPluginStatus(args) {
  const id = args._[0];
  if (!id) throw new Error("apx plugins status: missing <plugin-id>");
  const s = await http.get(`/plugins/${id}/status`);
  console.log(JSON.stringify(s, null, 2));
}

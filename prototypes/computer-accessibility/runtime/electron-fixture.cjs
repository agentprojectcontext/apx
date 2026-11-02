const { app, BrowserWindow, Menu } = require("electron");
const { createInterface } = require("node:readline");
const { fixtureURL } = require("./electron-documents.cjs");

if (!process.env.OBSERVER_FIXTURE_DATA) throw Error("Set OBSERVER_FIXTURE_DATA to isolated scratch data");
app.setPath("userData", process.env.OBSERVER_FIXTURE_DATA);
app.setName("Acme Electron selection");
const windows = [];
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "SYNTHETIC_MENU_SENTINEL", submenu: [] }]));
  for (const label of ["alpha", "beta"]) {
    const window = new BrowserWindow({
      width: 600,
      height: 400,
      title: "Acme same title",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    let url = fixtureURL(label, ["iframe", "nested-iframe"].includes(process.env.OBSERVER_FIXTURE_MODE));
    if (process.env.OBSERVER_FIXTURE_MODE === "remote") {
      const remote = new URL(process.env.OBSERVER_FIXTURE_REMOTE_URL);
      if (remote.hostname !== "127.0.0.1" || remote.protocol !== "http:") throw Error("LAB_REMOTE_MUST_BE_LOOPBACK");
      url = remote.href;
    }
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await window.loadURL(url);
    windows.push(window);
  }
  process.stdout.write("FIXTURE_READY\n");
  createInterface({ input: process.stdin }).on("line", async (line) => {
    if (line === "navigate") {
      const remote = new URL(process.env.OBSERVER_FIXTURE_REMOTE_URL);
      if (remote.hostname !== "127.0.0.1" || remote.protocol !== "http:") throw Error("LAB_REMOTE_MUST_BE_LOOPBACK");
      for (const window of windows) await window.loadURL(remote.href);
      process.stdout.write("FIXTURE_NAVIGATED\n");
      return;
    }
    if (line === "close-alpha") windows[0].close();
    if (line === "reorder") windows[0].moveTop();
    process.stdout.write("FIXTURE_DONE\n");
  });
});
app.on("window-all-closed", () => app.quit());

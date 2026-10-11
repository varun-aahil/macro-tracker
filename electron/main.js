const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// serve the app from a real origin (app://macro-tracker) so indexeddb, service workers and module imports behave
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true } }]);

app.whenReady().then(() => {
  const root = path.join(__dirname, "..");
  protocol.handle("app", req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(root, p === "/" ? "index.html" : p));
    if (!file.startsWith(root)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({ width: 440, height: 860, autoHideMenuBar: true, icon: path.join(root, "build", "icon.png") });
  win.loadURL("app://macro-tracker/");
});
app.on("window-all-closed", () => app.quit());

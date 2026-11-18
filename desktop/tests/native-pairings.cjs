// Real Electron utility processes and two loopback-only Metis protocol fixtures.
const { app, safeStorage } = require("electron");
app.disableHardwareAcceleration();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");

const directory = process.env.METIS_NATIVE_PAIRINGS_TEST_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "metis-native-pairings-"));
process.env.METIS_DESKTOP_TEST_DATA = directory;
const timeout = setTimeout(() => { console.error("NATIVE_PAIRINGS_TIMEOUT"); app.exit(1); }, 45000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const result = await predicate();
    if (result) return result;
    await delay(25);
  }
  throw Error("Timed out: " + label);
}

async function fixture(name) {
  const f = { name, enrollments: 0, auth: [], sockets: new Set(), responses: new Map(), next: name + "-1" };
  const deviceId = "same-id-on-both-servers";
  f.clientId = deviceId;
  const server = http.createServer(async (req, res) => {
    if (require('./metis-server-fixture.cjs').replyMetisVersion(req, res)) return;
    const json = (value, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/api/remote-clients/enroll") {
      f.enrollments++;
      let content = "";
      for await (const chunk of req) content += chunk;
      const input = JSON.parse(content);
      if (input.token === "u_redirect") return res.writeHead(307, { location: f.redirect }).end();
      if (input.token === "u_wrong-mode") return json({ client: { id: deviceId, permissionMode: "admin" }, credential: "not-installed" });
      if (input.token !== "u_" + name) return json({}, 401);
      assert.equal(input.permissionMode, "user");
      assert.ok(!input.capabilities.includes("admin_processes"));
      return json({ client: { id: deviceId, permissionMode: "user" }, credential: f.next });
    }
    if (req.url === "/api/remote-clients/hub") {
      assert.equal(req.headers["x-metis-client-id"], deviceId);
      assert.equal(req.headers.authorization, "Bearer " + f.next);
      return json({ client: { id: deviceId, name, permissionMode: "user" }, audit: [
        { clientId: deviceId, marker: name }, { clientId: "someone-else", marker: "reject-me" },
      ] });
    }
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Synthetic " + name + "</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  f.origin = "http://127.0.0.1:" + server.address().port;
  const wss = new WebSocketServer({ server, path: "/ws/remote-client" });
  wss.on("connection", ws => {
    f.sockets.add(ws);
    ws.on("close", () => f.sockets.delete(ws));
    ws.on("message", data => {
      const msg = JSON.parse(data);
      if (msg.type === "auth") {
        assert.equal(msg.clientId, deviceId);
        assert.equal(msg.credential, f.next);
        f.auth.push(msg.credential);
        f.socket = ws;
        ws.send(JSON.stringify({ type: "authenticated", clientId: deviceId }));
      }
      if (msg.type === "heartbeat") ws.send(JSON.stringify({ type: "heartbeat_ack" }));
      if (msg.type === "response") f.responses.set(msg.requestId, msg);
    });
  });
  f.job = (id, action, params) => f.socket.send(JSON.stringify({ type: "request", requestId: id, action, params }));
  f.close = () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); };
  return f;
}

const fixtures = [];
async function run() {
  await app.whenReady();
  const a = await fixture("A"); fixtures.push(a);
  const b = await fixture("B"); fixtures.push(b);
  b.redirect = a.origin + "/api/remote-clients/enroll";
  const file = path.join(directory, "config.json");
  // Seed the legacy single-origin format; do not open any production URL.
  const legacy = { server: a.origin, clientId: a.clientId, permissionMode: "user" };
  if (process.platform !== "linux") legacy.encryptedCredential = safeStorage.encryptString(a.next).toString("base64");
  else legacy.credential = a.next;
  fs.writeFileSync(file, JSON.stringify(legacy), { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "server.json"), JSON.stringify({ url: a.origin }));

  const api = require("../main.cjs");
  await waitFor(() => a.auth.length === 1 && api.getDesktop()?.getState().mode === "ready", "legacy A online");
  const firstA = a.socket;
  api.showWindow();
  const hub = api.getDeviceWindow();
  const js = code => hub.webContents.executeJavaScript(code);
  await waitFor(async () => !hub.webContents.isLoading() && await js("Boolean(window.metis)"), "native hub ready");
  const invoke = (method, arg) => js(`metis.${method}(${arg === undefined ? "" : JSON.stringify(arg)})`);
  const pair = (server, token) => invoke("pair", { server, token });
  await assert.rejects(pair("http://bad.example", "u_B"), /HTTPS/);
  await assert.rejects(pair(b.origin, "u_redirect"), /endpoint redirected/);
  assert.equal(a.enrollments, 0);
  await assert.rejects(pair(b.origin, "u_wrong-mode"), /different access mode/);
  assert.equal(b.auth.length, 0);
  assert.equal(a.socket, firstA);

  await pair(b.origin + "/chat", "u_B");
  await waitFor(async () => (await invoke("state")).serverRows.filter(x => x.status === "online").length === 2, "A and B online");
  assert.equal(a.auth.length, 1);
  assert.equal(a.socket, firstA);
  assert.equal((await invoke("snapshot", a.origin)).client.name, "A");
  assert.deepEqual((await invoke("snapshot", b.origin)).audit.map(x => x.marker), ["B"]);
  assert.doesNotMatch(JSON.stringify(await invoke("state")), /A-1|B-1/);

  const desktop = api.getDesktop();
  const wa = await desktop.openServer(a.origin);
  const wb = await desktop.openServer(b.origin);
  await waitFor(() => wa.getState().mode === "ready" && wb.getState().mode === "ready", "origin windows ready");
  for (const [window, origin] of [[wa, a.origin], [wb, b.origin]]) {
    const state = await window.getView().webContents.executeJavaScript("metisApp.deviceState()");
    assert.equal(state.server, origin);
    assert.equal(state.paired, true);
    assert.equal(state.serverRows, undefined);
    assert.doesNotMatch(JSON.stringify(state), /A-1|B-1/);
  }

  // The native settings window selects the originating web window's server.
  api.showWindow(wb);
  await waitFor(() => js(`document.querySelector("#server-grid [aria-pressed=true]")?.dataset.origin === ${JSON.stringify(b.origin)}`), "B settings selection");
  await waitFor(() => js('document.querySelector("#device-name").textContent === "B"'), "B activity in the native hub");
  await js(`[...document.querySelectorAll("#server-grid button")].find(card => card.dataset.origin === ${JSON.stringify(a.origin)}).click()`);
  await waitFor(() => js('document.querySelector("#device-name").textContent === "A"'), "A activity after switching");
  for (const width of [390, 768, 1440]) {
    hub.setContentSize(width, 720);
    await waitFor(() => js(`innerWidth === ${width}`), "native hub width " + width);
    assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true, "no page overflow at " + width);
  }
  console.log("PAIRING_HUB_LAYOUT_OK");

  const firstB = b.socket;
  const slow = process.platform === "win32" ? "ping -n 3 127.0.0.1 > nul & echo fixture-job" : "sleep 2; printf fixture-job";
  a.job("shared-request-id", "execute_command", { command: slow });
  b.job("shared-request-id", "get_info", {});
  const quick = await waitFor(() => b.responses.get("shared-request-id"), "concurrent B job");
  assert.equal(quick.ok, true);
  assert.equal(a.responses.has("shared-request-id"), false);
  const result = await waitFor(() => a.responses.get("shared-request-id"), "A job completion");
  assert.equal(result.ok, true);
  assert.match(result.result.stdout, /fixture-job/);

  // Failed same-origin replacement keeps the old authenticated runtime.
  await assert.rejects(pair(a.origin, "u_wrong-mode"), /different access mode/);
  assert.equal(a.socket, firstA);
  a.next = "A-2";
  await pair(a.origin, "u_A");
  await waitFor(() => a.auth.length === 2 && !a.sockets.has(firstA), "A replacement");
  assert.equal(b.socket, firstB);
  assert.equal(b.auth.length, 1);
  assert.deepEqual(a.auth, ["A-1", "A-2"]);
  const { createCredentialStore } = require("../credential-store.cjs");
  const saved = createCredentialStore({ file, safeStorage });
  assert.deepEqual([...saved.load().values()].map(x => x.config.credential), ["A-2", "B-1"]);

  await assert.rejects(invoke("unpair"), /Select a paired server/);
  await assert.rejects(invoke("unpair", b.origin + "/"), /Select a paired server/);
  await invoke("unpair", b.origin);
  await waitFor(() => b.sockets.size === 0, "only B disconnected");
  assert.equal(a.sockets.size, 1);
  assert.deepEqual([...saved.load().keys()], [a.origin]);
  assert.equal((await wb.getView().webContents.executeJavaScript("metisApp.deviceState()")).paired, false);
  assert.equal((await wa.getView().webContents.executeJavaScript("metisApp.deviceState()")).paired, true);
  console.log("NATIVE_MULTI_ORIGIN_PAIRING_OK");
}
run().then(() => app.quit(),
  error => { console.error(error); app.exit(1); });
// Chromium still holds its profile open inside this event on Windows. The
// runner owns profile cleanup after the Electron process has actually exited.
app.once("quit", () => { clearTimeout(timeout); for (const f of fixtures) f.close(); });

"use strict";
// Enroll the released app only against a dedicated loopback fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer } = require("ws");
const { replyMetisVersion } = require("./metis-server-fixture.cjs");

const root = process.env.RUNNER_TEMP;
const directory = path.resolve(process.argv[2] || "");
assert.ok(root && directory.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep));
const token = "u_installerFixture";
const credential = "isolated-installer-fixture-credential";
const clientId = "fixture-installed-desktop";
const requestId = "initial-installed-get-info";
let enrollments = 0, authentications = 0;

function report(name, body) {
  const file = path.join(directory, name);
  fs.writeFileSync(file + ".tmp", JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}

const server = http.createServer(async (req, res) => {
  if (replyMetisVersion(req, res)) return;
  const json = (data, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  try {
    if (req.method === "POST" && req.url === "/api/remote-clients/enroll") {
      let body = "";
      for await (const buf of req) {
        body += buf;
        if (body.length > 32 * 1024) return json({}, 413);
      }
      const data = JSON.parse(body);
      if (data.token !== token || data.permissionMode !== "user") return json({}, 401);
      assert.ok(!data.capabilities.includes("admin_processes"));
      enrollments++;
      return json({ client: { id: clientId, permissionMode: "user" }, credential });
    }
    if (req.url === "/api/remote-clients/hub") {
      if (req.headers["x-metis-client-id"] !== clientId || req.headers.authorization !== "Bearer " + credential) return json({}, 401);
      return json({ client: { id: clientId, name: "Isolated installer test", permissionMode: "user" }, audit: [] });
    }
    if (req.method !== "GET" || req.url !== "/") return json({}, 404);
    res.writeHead(200, { "content-type": "text/html" }).end(
      '<!doctype html><title>Metis Installer Fixture</title><h1>Metis Installer Fixture</h1>' +
      '<button type="button" onclick="window.metisApp.openDeviceSettings()">Open isolated device settings</button>'
    );
  } catch (error) {
    console.error("Fixture HTTP failed:", error.message);
    json({}, 500);
  }
});
server.requestTimeout = 10000;
server.listen(0, "127.0.0.1", () => report("address.json", { origin: "http://127.0.0.1:" + server.address().port + "/" }));
const wss = new WebSocketServer({ server, path: "/ws/remote-client", maxPayload: 64 * 1024 });
wss.on("connection", ws => {
  let authenticated = false;
  ws.on("message", bytes => {
    try {
      const msg = JSON.parse(bytes);
      if (msg.type === "auth" && !authenticated && msg.clientId === clientId && msg.credential === credential && enrollments === 1) {
        authenticated = true;
        authentications++;
        ws.send(JSON.stringify({ type: "authenticated", clientId }));
        ws.send(JSON.stringify({ type: "request", requestId, action: "get_info", params: {} }));
      } else if (authenticated && msg.type === "heartbeat") {
        ws.send(JSON.stringify({ type: "heartbeat_ack" }));
      } else if (authenticated && msg.type === "response" && msg.requestId === requestId) {
        assert.equal(msg.ok, true);
        assert.match(msg.result.os, /^win32 /);
        assert.equal(msg.result.architecture, "x64");
        assert.equal(enrollments, 1);
        assert.equal(authentications, 1);
        report("result.json", { enrollments, authentications, firstDeviceCheck: true });
      } else if (!authenticated) {
        ws.close(1008);
      }
    } catch (error) {
      console.error("Fixture device check failed:", error.message);
      ws.close(1011);
    }
  });
});
setTimeout(() => process.exit(1), 120000);

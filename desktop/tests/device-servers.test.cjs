const assert = require("node:assert/strict");
const test = require("node:test");
const { deviceServerRows } = require("../src/main/device-servers.cjs");
const { pairingOrigin, validatePairing } = require("../src/main/device-pairing.cjs");

test("device settings deduplicate recent entries but retain every exact paired origin", () => {
  const rows = deviceServerRows([
    { url: "https://lab.example/ui" }, { url: "https://lab.example/other" },
    { url: "https://lab.example:8443/chat" }, { url: "http://127.0.0.1:8080/" },
    { url: "https://user:secret@bad.example" },
  ], new Map([
    ["https://lab.example:8443", { config: { credential: "private", permissionMode: "admin" }, status: { connection: "offline", accessMismatch: true } }],
    ["https://hidden.example", { config: { credential: "private", permissionMode: "user" }, status: { connection: "online" } }],
  ]), "Fixture PC");
  assert.deepEqual(rows.map(({ host, status, deviceName, permissionMode }) => [host, status, deviceName, permissionMode]), [
    ["lab.example:8443", "paused", "Fixture PC", "admin"], ["hidden.example", "online", "Fixture PC", "user"],
    ["lab.example", "not-paired", "", undefined], ["127.0.0.1:8080", "not-paired", "", undefined],
  ]);
  assert.equal(rows[0].url, "https://lab.example:8443/chat");
  assert.doesNotMatch(JSON.stringify(rows), /private|secret/);
});

test("pairing validates origins and authentication fields without inferring elevated policy", () => {
  assert.equal(pairingOrigin("https://LAB.example:443/ui"), "https://lab.example");
  for (const url of ["http://lab.example", "file:///tmp/example", "https://u:p@lab.example/",
    "https://lab.example/?q=secret", "https://lab.example/#fragment", "https://lab.example/\\extra", "https://lab.ex\tample/"]) {
    assert.throws(() => pairingOrigin(url));
  }
  const credentials = { server: "http://127.0.0.1:8000", clientId: "device", credential: "fixture", permissionMode: "user" };
  assert.deepEqual(validatePairing(credentials), credentials);
  for (const bad of [{ credential: "" }, { credential: "bad\r\nheader" }, { clientId: 5 }, { permissionMode: undefined }]) {
    assert.throws(() => validatePairing({ ...credentials, ...bad }), /Invalid device pairing data/);
  }
});

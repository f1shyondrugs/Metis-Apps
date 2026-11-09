import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"));

test("packaged client updates from the public remote-client repository without pairing credentials", () => {
  assert.deepEqual(pkg.build.publish, [{
    provider: "github",
    owner: "f1shyondrugs",
    repo: "Metis-Apps",
  }]);
  assert.ok(main.includes('provider: "github"'));
  assert.ok(main.includes('repo: "Metis-Apps"'));
  assert.equal(main.includes("autoUpdater.requestHeaders"), false);
  assert.equal(main.includes("/api/remote-clients/windows-updates"), false);
});

test("macOS computer use loads an in-process library instead of a helper process", () => {
  const unix = readFileSync(new URL("../desktop/computer-use-unix.mjs", import.meta.url), "utf8");
  const client = readFileSync(new URL("../desktop/client.mjs", import.meta.url), "utf8");
  assert.match(unix, /libmetisdesktop\.dylib/);
  assert.match(unix, /koffi\.load/);
  assert.match(unix, /metis_desktop_run", "str"/);
  assert.equal(unix.includes("koffi.decode"), false);
  assert.equal(unix.includes("metis-desktop-helper\""), false);
  assert.match(unix, /app\.asar\.unpacked/);
  assert.match(client, /platform === "darwin"/);
  assert.match(client, /computer-use\.mjs/);
  assert.match(String(pkg.dependencies.koffi), /\^2\./);
  const helper = readFileSync(new URL("../desktop/metis-desktop-helper.swift", import.meta.url), "utf8");
  const computerUse = readFileSync(new URL("../desktop/computer-use.mjs", import.meta.url), "utf8");
  assert.match(helper, /CGDisplayBounds/);
  assert.match(helper, /windowX/);
  assert.match(computerUse, /windowX/);
});

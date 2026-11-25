// Non-Windows E2E and direct npm runs use the same parent-owned profile
// lifecycle as the Windows standard-user runner.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "metis-update-native-"));
const result = spawnSync(require("electron"), [path.join(__dirname, "update-native.cjs")], {
  env: { ...process.env, METIS_UPDATE_TEST_DIR: directory },
  stdio: "inherit",
  timeout: 45000,
  killSignal: "SIGKILL",
});

if (result.error) {
  // Never clean up a profile if the runner could not confirm process exit.
  console.error("Electron updater fixture did not finish:", result.error.message);
  process.exitCode = 1;
} else {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exitCode = result.status ?? 1;
}

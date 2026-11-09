import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, access, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const launcher = new URL("../desktop/linux-launcher.sh", import.meta.url);

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [launcher.pathname, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("headless hosts receive an actionable message before AppImage startup", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-launcher-test-"));
  const fake = path.join(directory, "client.AppImage");
  try {
    await writeFile(fake, "#!/usr/bin/env bash\nexit 0\n");
    await chmod(fake, 0o755);
    const result = await run([fake], { DISPLAY: "", WAYLAND_DISPLAY: "" });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /headless Linux host/);
    assert.match(result.stderr, /legacy headless remote-client installer/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("external launcher checks the renamed Electron binary and removes its extraction", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-launcher-packed-"));
  const fake = path.join(directory, "client.AppImage");
  const bin = path.join(directory, "bin");
  const record = path.join(directory, "ldd-record");
  try {
    await mkdir(bin);
    await writeFile(fake, "#!/bin/sh\nmkdir -p squashfs-root\nprintf '#!/bin/sh\\nexit 0\\n' > squashfs-root/metis-ai-remote-client\nprintf 'ELF fixture' > squashfs-root/metis-ai-remote-client.real\nchmod 755 squashfs-root/metis-ai-remote-client*\n", { mode: 0o755 });
    await writeFile(path.join(bin, "id"), "#!/bin/sh\necho 1000\n", { mode: 0o755 });
    await writeFile(path.join(bin, "ldd"), '#!/bin/sh\nprintf "%s" "$1" > "$METIS_LDD_RECORD"\necho "libatk-1.0.so.0 => not found"\n', { mode: 0o755 });
    const result = await run([fake], { DISPLAY: ":99", PATH: bin + ":" + process.env.PATH, METIS_LDD_RECORD: record });
    assert.equal(result.code, 3);
    assert.match(result.stderr, /libatk-1\.0\.so\.0/);
    const inspected = await readFile(record, "utf8");
    assert.equal(path.basename(inspected), "metis-ai-remote-client.real");
    await assert.rejects(access(path.dirname(path.dirname(inspected))), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("launcher preflight does not suggest --no-sandbox and cleans up safely", async () => {
  const source = await (await import("node:fs/promises")).readFile(launcher, "utf8");
  assert.match(source, /refuses to run as root/);
  assert.match(source, /No packages were installed/);
  assert.doesNotMatch(source, /exec.*--no-sandbox/);
  assert.match(source, /realpath -e/);
  assert.match(source, /No packages were installed/);
});

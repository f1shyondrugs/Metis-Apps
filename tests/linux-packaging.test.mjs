import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const { default: afterPack } = await import(new URL("../desktop/build/linux-after-pack.cjs", import.meta.url));

function run(file, env) {
  return new Promise((resolve) => {
    const child = spawn(file, [], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("afterPack puts the preflight in front of the packaged Electron executable", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-appimage-hook-"));
  try {
    const executable = path.join(directory, "metis-ai-remote-client");
    await writeFile(executable, "#!/bin/sh\nexit 99\n");
    await chmod(executable, 0o755);
    await afterPack({ electronPlatformName: "linux", appOutDir: directory, packager: { executableName: "metis-ai-remote-client" } });
    assert.equal((await readFile(`${executable}.real`, "utf8")).includes("exit 99"), true);
    const result = await run(executable, { DISPLAY: "", WAYLAND_DISPLAY: "" });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /headless Linux host/);
    assert.match(result.stderr, /install\/remote-client\.sh/);
    assert.match(result.stderr, /--enrollment-token/);
    assert.match(result.stderr, /Electron ELF was not started/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the linux hook is not applied to non-Linux packages", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-appimage-hook-skip-"));
  try {
    const executable = path.join(directory, "metis-ai-remote-client");
    await (await import("node:fs/promises")).writeFile(executable, "binary");
    await afterPack({ electronPlatformName: "darwin", appOutDir: directory, packager: { executableName: "metis-ai-remote-client" } });
    assert.equal((await readFile(executable, "utf8")), "binary");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AppImage dependency diagnostics select available t64 packages and print real newlines", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-appimage-libraries-"));
  try {
    const executable = path.join(directory, "metis-ai-remote-client");
    await writeFile(executable, "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const bin = path.join(directory, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "id"), "#!/bin/sh\necho 1000\n", { mode: 0o755 });
    await writeFile(path.join(bin, "ldd"), "#!/bin/sh\necho 'libasound.so.2 => not found'\necho 'libunknown.so.1 => not found'\n", { mode: 0o755 });
    await writeFile(path.join(bin, "apt-cache"), '#!/bin/sh\nif [ "$2" = libasound2t64 ]; then echo "Candidate: 1.2.11"; else echo "Candidate: (none)"; fi\n', { mode: 0o755 });
    await afterPack({ electronPlatformName: "linux", appOutDir: directory, packager: { executableName: "metis-ai-remote-client" } });
    const result = await run(executable, { DISPLAY: ":99", PATH: bin + ":" + process.env.PATH });
    assert.equal(result.code, 3);
    assert.match(result.stderr, /install -y libasound2t64/);
    assert.match(result.stderr, /No available package mapping for: libunknown\.so\.1/);
    assert.doesNotMatch(result.stderr, /\\n/);
    assert.match(result.stderr, /Electron ELF was not started/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

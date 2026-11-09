import assert from "node:assert/strict";
import test from "node:test";
import { unixComputerUse } from "../desktop/computer-use-unix.mjs";

test("Wayland and headless sessions report a useful reason before running commands", async () => {
  for (const env of [{}, { DISPLAY: ":1", WAYLAND_DISPLAY: "wayland-0" }, { DISPLAY: ":1", XDG_SESSION_TYPE: "wayland" }]) {
    const result = await unixComputerUse({ operation: "status" }, { platform: "linux", env, run: () => { throw Error("must not run"); } });
    assert.equal(result.available, false);
    assert.match(result.reason, /X11|Wayland/);
    await assert.rejects(unixComputerUse({ operation: "list_windows" }, { platform: "linux", env }), /X11|Wayland/);
  }
});
test("missing X11 utilities report installation instructions", async () => {
  const result = await unixComputerUse({ operation: "status" }, { platform: "linux", env: { DISPLAY: ":1" },
    run: async () => { throw Error("ENOENT"); } });
  assert.equal(result.available, false);
  assert.match(result.reason, /xdotool, wmctrl and ImageMagick/);
});
test("a locked X11 session cannot receive input", async () => {
  const commands = [];
  const run = async (command, args) => { commands.push([command, args]); return { stdout: command === "gdbus" ? "(true,)" : "" }; };
  await assert.rejects(unixComputerUse({ operation: "click", windowId: "1", x: 1, y: 1 },
    { platform: "linux", env: { DISPLAY: ":1" }, run }), /locked/);
  assert.equal(commands.some(([command, args]) => command === "xdotool" && args.includes("click")), false);
});
test("macOS without the native library rejects desktop requests", async () => {
  const previous = process.env.METIS_DESKTOP_LIB;
  process.env.METIS_DESKTOP_LIB = new URL("./missing-desktop-library.dylib", import.meta.url).pathname;
  try {
    const isolated = await import("../desktop/computer-use-unix.mjs?missing-library");
    await assert.rejects(isolated.unixComputerUse({ operation: "status" }, { platform: "darwin" }));
  } finally {
    if (previous === undefined) delete process.env.METIS_DESKTOP_LIB;
    else process.env.METIS_DESKTOP_LIB = previous;
  }
});

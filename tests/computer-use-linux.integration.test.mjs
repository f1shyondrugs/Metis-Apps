import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import test from "node:test";
import { computerUse } from "../desktop/computer-use.mjs";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test("X11 screenshots and all mouse/keyboard operations reach a real application", {
  skip: process.env.METIS_X11_TEST !== "1", timeout: 40_000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-x11-test-"));
  const stateFile = path.join(dir, "state.json");
  const python = `
import tkinter as tk, json, sys
root=tk.Tk(); root.title("Metis desktop test fixture"); root.geometry("600x420+30+30")
text=tk.Text(root); text.pack(fill="both",expand=True)
events=[]
for kind in ["<Button-1>","<Button-3>","<Button-2>","<Button-4>","<Button-5>","<B1-Motion>"]:
    text.bind(kind,lambda e,k=kind:events.append(k),add="+")
text.focus_set()
def save():
    with open(sys.argv[1],"w") as f: json.dump({"text":text.get("1.0","end-1c"),"events":events},f)
    root.after(50,save)
save(); root.mainloop()
`;
  const wm = spawn("openbox", [], { stdio: "ignore" });
  await delay(500);
  const app = spawn("python3", ["-c", python, stateFile], { stdio: ["ignore", "ignore", "pipe"] });
  let errors = ""; app.stderr.on("data", data => errors += data);
  try {
    let window;
    for (let i = 0; i < 50; i++) {
      const result = await computerUse({ operation: "list_windows" });
      window = result.windows.find(item => item.title === "Metis desktop test fixture");
      if (window) break;
      if (app.exitCode !== null) throw Error(errors);
      await delay(100);
    }
    assert.ok(window, errors);
    const status = await computerUse({ operation: "status" });
    assert.equal(status.available, true);
    const observe = () => computerUse({ operation: "observe", windowId: window.id });
    const first = await observe();
    const png = Buffer.from(first.png, "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), first.width);
    assert.equal(png.readUInt32BE(20), first.height);
    const act = async (operation, params = {}) => {
      const observation = await observe();
      const result = await computerUse({ operation, windowId: window.id, observationId: observation.observationId, ...params });
      assert.equal(result.ok, true);
      await delay(100);
      return observation;
    };
    const consumed = await act("click", { x: 50, y: 50 });
    await assert.rejects(computerUse({ operation: "type", windowId: window.id,
      observationId: consumed.observationId, text: "must not type" }), /Observe/);
    await act("move", { x: 80, y: 60 });
    await act("type", { text: "Metis Unicode äöü" });
    await act("key", { key: "Control+a" });
    await act("key", { key: "End" });
    await act("click", { x: 70, y: 70, button: "right", count: 1 });
    await act("click", { x: 70, y: 70, button: "middle", count: 1 });
    await act("scroll", { x: 60, y: 70, deltaY: -240 });
    await act("drag", { x: 40, y: 40, toX: 120, toY: 50 });
    const latest = await observe();
    execFileSync("xdotool", ["windowmove", window.id, "200", "100"]);
    await assert.rejects(computerUse({ operation: "click", windowId: window.id,
      observationId: latest.observationId, x: 20, y: 20 }), /moved or resized/);
    await delay(150);
    const state = JSON.parse(fs.readFileSync(stateFile));
    assert.match(state.text, /Metis Unicode äöü/);
    for (const event of ["<Button-1>", "<Button-2>", "<Button-3>", "<Button-5>", "<B1-Motion>"])
      assert.ok(state.events.includes(event), event + " did not reach the app");
  } finally {
    app.kill(); wm.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

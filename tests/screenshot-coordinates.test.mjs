import assert from "node:assert/strict";
import test from "node:test";
import { computerUse } from "../desktop/computer-use.mjs";

const retina = { windowId: "42", title: "Window", x: 0, y: 0, width: 2880, height: 1800,
  coordinateWidth: 1440, coordinateHeight: 900, windowX: 0, windowY: 30, windowWidth: 1440, windowHeight: 812, png: "fixture" };

function fixture(result = retina, platform = "darwin") {
  const inputs = [];
  const options = { platform, runUnix: async payload => {
    if (payload.operation === "observe") return { ...result };
    inputs.push(payload);
    return { ok: true };
  } };
  const observe = () => computerUse({ operation: "observe", windowId: "42" }, options);
  const act = (observation, params) => computerUse({ windowId: "42", observationId: observation.observationId, ...params }, options);
  return { inputs, observe, act };
}

test("macOS observations describe the full screenshot and keep menu-bar coordinates", async () => {
  const f = fixture();
  const observed = await f.observe();
  assert.equal(observed.coordinates.capture, "display");
  assert.equal(observed.coordinates.space, "screenshot-pixels");
  assert.equal(observed.coordinates.origin, "top-left");
  assert.equal(observed.coordinates.width, 2880);
  assert.equal(observed.coordinates.height, 1800);
  await f.act(observed, { operation: "click", x: 600, y: 20 });
  const input = f.inputs[0];
  assert.deepEqual([input.x, input.y], [300, 10]);
  assert.deepEqual(input.expectedGeometry, { x: 0, y: 30, width: 1440, height: 812 });
  assert.deepEqual(input.expectedDisplay, { x: 0, y: 0, width: 1440, height: 900 });
});

test("Retina screen edges and drag endpoints map once without a window offset", async () => {
  const f = fixture({ ...retina, x: -1440, y: -200, windowX: -1300, windowY: -170 });
  await f.act(await f.observe(), { operation: "drag", x: 0, y: 0, toX: 2879, toY: 1799 });
  const input = f.inputs[0];
  assert.deepEqual([input.x, input.y, input.toX, input.toY], [0, 0, 1439, 899]);
  assert.deepEqual(input.expectedDisplay, { x: -1440, y: -200, width: 1440, height: 900 });
});

test("window captures keep their own origin and support fractional input scaling", async () => {
  const f = fixture({ windowId: "42", x: 120, y: 30, width: 1500, height: 900,
    coordinateWidth: 1000, coordinateHeight: 600, png: "fixture" }, "linux");
  const observed = await f.observe();
  assert.equal(observed.coordinates.capture, "window");
  await f.act(observed, { operation: "move", x: 1499, y: 899 });
  assert.deepEqual([f.inputs[0].x, f.inputs[0].y], [999, 599]);
  assert.equal(f.inputs[0].expectedDisplay, undefined);
  assert.deepEqual(f.inputs[0].expectedGeometry, { x: 120, y: 30, width: 1000, height: 600 });
});

test("pixels outside the screenshot never reach the native backend, including drag endpoints", async () => {
  const f = fixture({ ...retina, width: 2879 });
  for (const params of [
    { operation: "click", x: 2879, y: 0 },
    { operation: "move", x: 0, y: 1800 },
    { operation: "drag", x: 1, y: 1, toX: 2879, toY: 100 },
    { operation: "drag", x: 1, y: 1, toX: 100, toY: 1800 },
    { operation: "scroll", x: -1, y: 0, deltaY: 120 },
  ]) await assert.rejects(f.act(await f.observe(), params), /outside the observed screenshot|must be an integer/);
  assert.equal(f.inputs.length, 0);
});

test("observations remain single-use and tied to the selected window", async () => {
  const f = fixture();
  const observed = await f.observe();
  await assert.rejects(f.act(observed, { operation: "move", windowId: "43", x: 1, y: 1 }), /Observe this window again/);
  await f.act(observed, { operation: "move", x: 1, y: 1 });
  await assert.rejects(f.act(observed, { operation: "move", x: 1, y: 1 }), /Observe this window again/);
  assert.equal(f.inputs.length, 1);
});

test("malformed screenshot dimensions cannot create a usable observation", async () => {
  for (const change of [{ width: 0 }, { height: NaN }, { coordinateWidth: -1 }, { coordinateHeight: 1.5 }]) {
    await assert.rejects(fixture({ ...retina, ...change }).observe(), /Invalid screenshot dimensions/);
  }
});

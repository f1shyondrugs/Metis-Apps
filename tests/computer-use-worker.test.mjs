import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

test("Computer Use runs behind the worker message boundary", async () => {
  const worker = new Worker(new URL("../desktop/computer-use-worker.mjs", import.meta.url));
  try {
    const id = "worker-probe";
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Computer Use worker did not respond")), 15_000);
      worker.once("error", reject);
      worker.on("message", (message) => {
        if (message?.id !== id) return;
        clearTimeout(timeout);
        resolve(message);
      });
      worker.postMessage({ type: "run", id, params: { operation: "worker_boundary_probe" } });
    });
    assert.equal(response.id, id);
    assert.equal(response.type, "error");
    assert.match(response.error?.message || "", /Unsupported computer use operation/);
  } finally {
    await worker.terminate();
  }
});

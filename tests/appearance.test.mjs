import test from "node:test";
import assert from "node:assert/strict";
import appearance from "../desktop/appearance.cjs";

test("theme replacement removes old aliases and follows both modes", () => {
  const values = new Map();
  const root = { dataset: {}, style: { setProperty: (k,v) => values.set(k,v), removeProperty: k => values.delete(k) } };
  assert.equal(appearance.apply(root, { version:1, mode:"dark", variables:{"--primary":"var(--brand)", "--brand":"#88c0d0"} }), true);
  assert.equal(values.get("--brand"), "#88c0d0");
  assert.equal(appearance.apply(root, {version:1, mode:"light", variables:{"--primary":"#685139"}}), true);
  assert.equal(root.style.colorScheme, "light");
  assert.equal(root.dataset.metisTheme, "light");
  assert.equal(values.has("--brand"), false);
  assert.equal(values.get("--primary"), "#685139");
});

test("malformed and resource-bearing themes cannot replace the last valid theme", () => {
  for (const value of ["red; color: blue", "</script>", "url(https://example.test)", "expression(alert(1))", "red/*x*/", "red!important"]) {
    assert.equal(appearance.normalize({ version:1, mode:"dark", variables:{"--primary":value} }), null);
  }
  assert.equal(appearance.normalize({version:1,mode:"invalid",variables:{}}),null);
  assert.equal(appearance.normalize(appearance.fallback).mode,"dark");
  assert.ok(appearance.normalize({version:1,mode:"dark",variables:{"--primary":"oklch(0.8 0.1 150)", "--color":"color-mix(in srgb, var(--primary) 30%, transparent)"}}));
});

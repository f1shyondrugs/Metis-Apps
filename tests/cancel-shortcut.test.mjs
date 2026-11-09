import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import shortcut from "../desktop/cancel-shortcut.cjs";
import preferences from "../desktop/overlay-preferences.cjs";

test("recorded shortcuts normalize consistently across platforms and keyboard layouts", () => {
  assert.equal(shortcut.normalize("ctrl+shift+x"),"Control+Shift+X");
  assert.equal(shortcut.normalize("Esc"),"Escape");
  assert.equal(shortcut.label("Control+Shift+X"),"Ctrl + Shift + X");
  assert.equal(shortcut.label("Super+F8","darwin"),"Cmd + F8");
  assert.equal(shortcut.fromEvent({key:"X",code:"KeyX",ctrlKey:true,shiftKey:true}),"Control+Shift+X");
  assert.equal(shortcut.fromEvent({key:"!",code:"Digit1",shiftKey:true}),"Shift+1");
  assert.equal(shortcut.fromEvent({key:"Shift",code:"ShiftLeft",shiftKey:true}),null);
  for(const key of ["",null,"Control","Ctrl+Ctrl+X","Ctrl+Unrecognized","F25","<script>"]) assert.throws(()=>shortcut.normalize(key));
});

test("shortcut preferences migrate old files and persist independently from capture visibility", () => {
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-shortcut-")),file=path.join(dir,"preferences.json");
  try {
    writeFileSync(file,JSON.stringify({hideOverlayFromCapture:false}));
    const store=preferences.createOverlayPreferences(file);
    assert.equal(store.getCancelShortcut(),"Escape");
    store.setCancelShortcut("Ctrl+Shift+X");
    store.set(true);
    const restored=preferences.createOverlayPreferences(file);
    assert.equal(restored.getCancelShortcut(),"Control+Shift+X");
    assert.equal(restored.get(),true);
    assert.throws(()=>store.setCancelShortcut("bad key"));
    assert.equal(preferences.createOverlayPreferences(file).getCancelShortcut(),"Control+Shift+X");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

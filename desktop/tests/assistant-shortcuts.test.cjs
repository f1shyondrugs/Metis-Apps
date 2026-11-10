const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const shortcuts=require('../assistant-shortcuts.cjs');
const {createOverlayPreferences}=require('../overlay-preferences.cjs');
const keys={Space:57,Enter:28,M:50,F6:64,Ctrl:29,CtrlRight:3613,Shift:42,ShiftRight:54,Meta:3675,MetaRight:3676};
test('matching uses exact modifiers and release accepts either physical side',()=>{
  const event={keycode:57,ctrlKey:true,shiftKey:true,altKey:false,metaKey:false};
  assert.ok(shortcuts.matches(shortcuts.defaults.assistant,event,keys));
  assert.ok(!shortcuts.matches(shortcuts.defaults.assistant,{...event,altKey:true},keys));
  assert.ok(shortcuts.releases(shortcuts.defaults.assistant,{...event,keycode:57},keys));
  assert.ok(shortcuts.releases(shortcuts.defaults.assistant,{...event,keycode:54,shiftKey:false},keys));
  assert.ok(!shortcuts.releases(shortcuts.defaults.assistant,{...event,keycode:54},keys));
  assert.ok(shortcuts.matches('F6',{keycode:64},keys));
});
test('aliases normalize and collisions or unknown keys cannot be saved',()=>{
  assert.equal(shortcuts.normalize({assistant:'ctrl+alt+space'}).assistant,'Control+Alt+Space');
  assert.throws(()=>shortcuts.normalize({focusInput:shortcuts.defaults.assistant}),/different/);
  assert.throws(()=>shortcuts.normalize({assistant:'Control+NotAKey'}));
  assert.throws(()=>shortcuts.normalize([]));
});
test('migration preserves an existing cancellation key that collides with a new default',()=>{const value=shortcuts.migrateDefaults('Control+Shift+Space');assert.equal(value.cancel,'Control+Shift+Space');assert.equal(value.assistant,'Control+Alt+Space');assert.equal(new Set(Object.values(value)).size,5);});
test('old capture preferences migrate without losing the configured cancel key',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metis-shortcuts-'));
  try{const file=path.join(dir,'preferences.json');fs.writeFileSync(file,JSON.stringify({hideOverlayFromCapture:false,cancelShortcut:'Control+Alt+X'}));
    const p=createOverlayPreferences(file);assert.equal(p.get(),false);assert.equal(p.getAssistantShortcuts().cancel,'Control+Alt+X');
    p.setAssistantShortcuts({...p.getAssistantShortcuts(),assistant:'Control+Alt+Space',focusInput:'F6'});
    const reloaded=createOverlayPreferences(file);assert.equal(reloaded.getAssistantShortcuts().focusInput,'F6');assert.equal(reloaded.get(),false);
    reloaded.setCancelShortcut('Escape');assert.equal(reloaded.getAssistantShortcuts().cancel,'Escape');
    const before=fs.readFileSync(file,'utf8');assert.throws(()=>reloaded.setAssistantShortcuts({assistant:'Escape'}));assert.equal(fs.readFileSync(file,'utf8'),before);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

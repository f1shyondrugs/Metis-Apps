/* Shared accelerator validation and key recording; no Node or DOM dependencies. */
(function(root) {
  const order = ["Control", "Alt", "Shift", "Super"];
  const aliases = {ctrl:"Control",control:"Control",alt:"Alt",option:"Alt",shift:"Shift",meta:"Super",super:"Super",cmd:"Super",command:"Super"};
  const keys = {esc:"Escape",escape:"Escape",space:"Space",enter:"Enter",return:"Enter",tab:"Tab",backspace:"Backspace",delete:"Delete",del:"Delete",insert:"Insert",home:"Home",end:"End",pageup:"PageUp",pagedown:"PageDown",up:"Up",arrowup:"Up",down:"Down",arrowdown:"Down",left:"Left",arrowleft:"Left",right:"Right",arrowright:"Right"};
  function normalize(value) {
    if (typeof value !== "string" || value.length > 100) throw Error("Choose a valid cancellation shortcut.");
    const parts = value.trim().split("+").map(part=>part.trim());
    const last = parts.pop(), modifiers = new Set();
    for (const part of parts) {
      const modifier = aliases[part.toLowerCase()];
      if (!modifier || modifiers.has(modifier)) throw Error("Choose a valid cancellation shortcut.");
      modifiers.add(modifier);
    }
    const key = keys[last?.toLowerCase()] || (/^[a-z0-9]$/i.test(last) ? last.toUpperCase() : /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(last) ? last.toUpperCase() : null);
    if (!key) throw Error("Press a key, optionally with Ctrl, Alt, Shift or Command.");
    return [...order.filter(part=>modifiers.has(part)), key].join("+");
  }
  function fromEvent(event) {
    if (["Control","Alt","Shift","Meta","AltGraph"].includes(event.key) || event.isComposing || event.repeat) return null;
    // Physical letters/digits remain stable with Shift and non-US layouts.
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) :
      /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.code === "Space" ? "Space" : event.key;
    return normalize([event.ctrlKey && "Control",event.altKey && "Alt",event.shiftKey && "Shift",event.metaKey && "Super",key].filter(Boolean).join("+"));
  }
  function label(value, platform) {
    return normalize(value).split("+").map(key=>({Escape:"Esc",Control:"Ctrl",Super:platform==="darwin"?"Cmd":"Super"})[key] || key).join(" + ");
  }
  const api={normalize,fromEvent,label};
  if (typeof module==="object" && module.exports) module.exports=api; else root.MetisCancelShortcut=api;
})(globalThis);

/* Shared by Electron main and both sandboxed renderers. No Node APIs. */
(function (root) {
  const fallback = { version: 1, mode: "dark", variables: {
    "--background": "#141414", "--foreground": "#f4f4f5", "--card": "#1c1c1c",
    "--primary": "#d4d4d4", "--primary-foreground": "#171717",
    "--muted": "#262626", "--muted-foreground": "#b0b0b0", "--border": "#353535",
    "--ring": "#a3a3a3", "--destructive": "#ef8f89",
  } };
  function normalize(input) {
    if (!input || input.version !== 1 || !["dark", "light"].includes(input.mode) ||
        !input.variables || typeof input.variables !== "object" || Array.isArray(input.variables)) return null;
    const entries = Object.entries(input.variables);
    if (entries.length > 2048 || JSON.stringify(input).length > 512 * 1024) return null;
    const variables = {};
    for (const [key, value] of entries) {
      if (!/^--[a-zA-Z0-9_-]+$/.test(key) || typeof value !== "string" || !value.trim() || value.length > 4096 ||
          /[;{}<>\\\\\u0000-\u001f]|\/\*|\*\/|!important|url\s*\(|expression\s*\(|@import/i.test(value)) return null;
      variables[key] = value;
    }
    return { version: 1, mode: input.mode, variables };
  }
  const applied = new WeakMap();
  function apply(element, input) {
    const theme = normalize(input);
    if (!theme) return false;
    for (const key of applied.get(element) || []) element.style.removeProperty(key);
    for (const [key, value] of Object.entries(theme.variables)) element.style.setProperty(key, value);
    element.style.colorScheme = theme.mode;
    element.dataset.metisTheme = theme.mode;
    applied.set(element, Object.keys(theme.variables));
    return true;
  }
  const api = { fallback, normalize, apply };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MetisAppearance = api;
})(globalThis);

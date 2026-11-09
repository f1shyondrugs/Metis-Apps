/* Shared pagination contract for the sandboxed renderer and Node tests. */
(function (root) {
  const PAGE_SIZE = 10;
  function page(audit, { clientId, search = "", status = "all", page = 1 } = {}) {
    const query = String(search).trim().toLowerCase();
    const matches = clientId && Array.isArray(audit) ? audit.filter(entry =>
      entry && entry.clientId === clientId && (status === "all" || entry.status === status) &&
      (!query || `${entry.action} ${entry.requestData?.command || ""}`.toLowerCase().includes(query))) : [];
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const current = Math.min(pageCount, Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1));
    const start = (current - 1) * PAGE_SIZE;
    return { items: matches.slice(start, start + PAGE_SIZE), page: current, pageCount, total: matches.length,
      from: matches.length ? start + 1 : 0, to: Math.min(start + PAGE_SIZE, matches.length) };
  }
  const api = Object.freeze({ PAGE_SIZE, page });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MetisCommandHistory = api;
})(globalThis);

const byId = (id) => document.getElementById(id);
const state = { paired: false, clientId: "", connection: "offline", client: null, audit: [], selectedLog: "", page: 1, view: "activity", loaded: false, fetching: false };

function formatDate(value) {
  if (!value) return "Never";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "Unknown" : time.toLocaleString("en");
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en");
}

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
}

function renderView() {
  const settings = state.view === "settings";
  byId("pair-view").hidden = state.paired || settings;
  byId("hub-view").hidden = !state.paired || settings;
  byId("settings-view").hidden = !settings;
  byId("paired-settings").hidden = !state.paired;
  if (settings) byId("open-settings").setAttribute("aria-current", "page");
  else byId("open-settings").removeAttribute("aria-current");
}
function navigate(view) {
  state.view = view;
  renderView();
  window.scrollTo(0, 0);
  byId(view === "settings" ? "settings-title" : state.paired ? "device-name" : "server").focus({ preventScroll: true });
  if (view === "activity") void refresh();
}
function changeCommandPage(delta) {
  state.page += delta;
  state.selectedLog = "";
  renderCommands();
}

function setConnection(data) {
  const previousClientId = state.clientId;
  Object.assign(state, data);
  if (previousClientId !== state.clientId || !state.paired) {
    state.audit = []; state.loaded = false; state.page = 1; state.selectedLog = "";
  }
  if (data.appearance) window.MetisAppearance.apply(document.documentElement, data.appearance);
  renderView();
  byId("open-server").hidden = false;
  byId("connection-label").textContent = state.connection.charAt(0).toUpperCase() + state.connection.slice(1);
  byId("connection-dot").className = `status-dot ${state.connection}`;
  byId("update-label").textContent = data.update || "";
  if (typeof data.hideOverlayFromCapture === "boolean") renderCaptureSetting(data.hideOverlayFromCapture);
  if (data.cancelShortcut) renderCancelShortcut(data.cancelShortcut);
  renderDesktopPermission(state);
  const access=byId("windows-access"),restart=byId("restart-as-administrator");
  access.hidden=state.platform!=="win32";
  byId("windows-access-title").textContent=state.windowsElevation==="user"?"Desktop app: Standard user":"Desktop app: "+(state.windowsElevation==="administrator"?"Administrator":"Unverified");
  byId("windows-access-detail").textContent=state.accessMismatch?"Device access is paused because Windows process rights could not be verified.":state.permissionMode==="user"?"This device is paired with User access. Administrator access requires a new Administrator pairing code and Windows UAC approval.":"The Remote Client runs separately in the background. Administrator access requires Windows UAC approval; the desktop app stays in Standard user mode.";
  if(state.deviceElevation)byId("windows-access-detail").textContent+=" Remote Client process: "+(state.deviceElevation==="administrator"?"Administrator.":"Standard user.");
  restart.hidden=state.platform!=="win32"||state.windowsElevation!=="user"||state.deviceElevation==="administrator";
  if (data.error && state.paired) showHubError(data.error);
  if (data.error && !state.paired) {
    byId("pair-error").textContent = data.error;
    byId("pair-error").hidden = false;
  }
}

function renderCaptureSetting(hidden) {
  state.hideOverlayFromCapture = hidden;
  byId("hide-overlay-from-capture").checked = hidden;
  byId("capture-status").textContent = hidden ? "Hidden from supported screen captures" : "Visible in screen streams and recordings";
}

byId("hide-overlay-from-capture").addEventListener("change", async (event) => {
  const input = event.target;
  const previous = state.hideOverlayFromCapture ?? true;
  input.disabled = true;
  byId("capture-error").hidden = true;
  try {
    renderCaptureSetting(await window.metis.setOverlayCaptureHidden(input.checked));
  } catch (error) {
    renderCaptureSetting(previous);
    byId("capture-error").textContent = error.message || "Could not save capture visibility";
    byId("capture-error").hidden = false;
  } finally {
    input.disabled = false;
  }
});

function renderCancelShortcut(value = "Escape") {
  state.cancelShortcut = value;
  if (!state.recordingShortcut) byId("cancel-shortcut").value = window.MetisCancelShortcut.label(value, state.platform);
}

async function saveCancelShortcut(value) {
  const input = byId("cancel-shortcut");
  state.recordingShortcut = false;
  input.disabled = true;
  byId("reset-cancel-shortcut").disabled = true;
  byId("shortcut-error").hidden = true;
  byId("shortcut-status").textContent = "Saving shortcut…";
  try {
    renderCancelShortcut(await window.metis.setCancelShortcut(value));
    byId("shortcut-status").textContent = "Shortcut saved.";
  } catch (error) {
    renderCancelShortcut(state.cancelShortcut);
    byId("shortcut-error").textContent = error.message || "Could not save cancellation shortcut.";
    byId("shortcut-error").hidden = false;
    byId("shortcut-status").textContent = "";
  } finally {
    input.disabled = false;
    byId("reset-cancel-shortcut").disabled = false;
  }
}

byId("cancel-shortcut").addEventListener("focus", () => {
  state.recordingShortcut = true;
  byId("cancel-shortcut").value = "Press a key…";
  byId("shortcut-status").textContent = "Listening for a key or combination…";
});
byId("cancel-shortcut").addEventListener("blur", () => {
  state.recordingShortcut = false;
  renderCancelShortcut(state.cancelShortcut);
  if (!byId("cancel-shortcut").disabled) byId("shortcut-status").textContent = "";
});
byId("cancel-shortcut").addEventListener("keydown", event => {
  // Tab keeps ordinary keyboard navigation; Shift+Tab also leaves the recorder.
  if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    const value = window.MetisCancelShortcut.fromEvent(event);
    if (value) void saveCancelShortcut(value);
  } catch (error) {
    byId("shortcut-error").textContent = error.message;
    byId("shortcut-error").hidden = false;
  }
});
byId("reset-cancel-shortcut").addEventListener("click", () => void saveCancelShortcut("Escape"));

function showHubError(message) {
  const element = byId("hub-error");
  element.textContent = message;
  element.hidden = !message;
}

function commandStatus(status) {
  if (status === "error") return "Failed";
  if (status === "unknown") return "Unclear";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
}

function commandPage() {
  const search = byId("search").value;
  const status = byId("status-filter").value;
  return window.MetisCommandHistory.page(state.audit, { clientId: state.clientId, search, status, page: state.page });
}

function renderCommands() {
  const list = byId("commands-list");
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.commandId : null;
  list.replaceChildren();
  byId("commands-loading").hidden = state.loaded;
  const pagination = byId("commands-pagination");
  if (!state.loaded) { pagination.hidden = true; renderCommandDetail(null); return; }
  const page = commandPage();
  state.page = page.page;
  pagination.hidden = page.pageCount <= 1;
  byId("commands-previous").disabled = page.page <= 1;
  byId("commands-next").disabled = page.page >= page.pageCount;
  const range = `${page.from}–${page.to} of ${page.total}`;
  const label = `Page ${page.page} of ${page.pageCount}`;
  if (byId("commands-range").textContent !== range) byId("commands-range").textContent = range;
  if (byId("commands-page").textContent !== label) byId("commands-page").textContent = label;
  const selected = page.items.find(entry => entry.id === state.selectedLog);
  if (!selected) state.selectedLog = "";
  renderCommandDetail(selected);
  if (!page.items.length) {
    list.append(node("p", "empty", state.audit.length ? "No commands match these filters." : "No commands have run on this device yet."));
    byId("command-detail").hidden = true;
    return;
  }
  let restoreFocus;
  for (const entry of page.items) {
    const row = node("button", `command-row ${state.selectedLog === entry.id ? "selected" : ""}`);
    row.type = "button";
    row.dataset.commandId = entry.id;
    if (entry.id === focusedId) restoreFocus = row;
    const name = entry.requestData?.command || entry.action;
    row.append(
      node("span", "when", formatShortDate(entry.createdAt)),
      node("span", "command-name", name),
      node("span", `badge ${entry.status}`, commandStatus(entry.status)),
    );
    row.addEventListener("click", () => selectLog(entry.id));
    list.append(row);
  }
  restoreFocus?.focus({ preventScroll: true });
}

function detailField(parent, title, value) {
  if (value == null || value === "") return;
  parent.append(node("h3", "", title), node("pre", "", typeof value === "string" ? value : JSON.stringify(value, null, 2)));
}

function selectLog(id) {
  state.selectedLog = id;
  renderCommands();
}

function renderCommandDetail(entry) {
  const detail = byId("command-detail");
  detail.replaceChildren();
  if (!entry) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  const heading = node("div", "detail-heading");
  heading.append(node("strong", "", entry.action));
  const close = node("button", "text-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => {
    state.selectedLog = "";
    detail.hidden = true;
    renderCommands();
  });
  heading.append(close);
  detail.append(heading);
  detail.append(node("p", "detail-meta", `${commandStatus(entry.status)} · ${formatDate(entry.createdAt)}${entry.durationMs != null ? " · " + entry.durationMs + " ms" : ""} · ${entry.source}`));
  if (entry.error) detailField(detail, "Error", entry.error);
  if (entry.requestData && Object.keys(entry.requestData).length) detailField(detail, "Request", entry.requestData);
  if (entry.resultData && Object.keys(entry.resultData).length) detailField(detail, "Result", entry.resultData);
  if (entry.status === "unknown") detailField(detail, "Outcome", "The connection ended before Metis received a result. The command may have run. Check this device before retrying.");
}

function desktopPermissionCopy(status) {
  const lines = [];
  if (typeof status.screenRecording === "boolean") lines.push(`Screen Recording: ${status.screenRecording ? "on" : "not enabled"}`);
  if (typeof status.accessibility === "boolean") lines.push(`Accessibility: ${status.accessibility ? "on" : "not enabled"}`);
  if (status.available) {
    return { blocked: false, title: "Desktop control is ready", detail: lines.join(" · ") || "OS permissions are enabled." };
  }
  const extra = lines.length
    ? "Grant them in System Settings, then restart this app."
    : (status.reason || "Grant the required OS permissions, then restart this app.");
  return {
    blocked: true,
    title: "Desktop permissions are not enabled",
    detail: `${lines.length ? `${lines.join(". ")}. ` : ""}${extra}`,
  };
}

async function refreshDesktopPermissions(prompt = false) {
  const banner = byId("permission-banner");
  const card = byId("desktop-permissions");
  const grant = byId("grant-permissions");
  const bannerGrant = byId("banner-grant");
  if (!window.metis?.desktopPermissions) return;
  const unix = state.platform === "darwin" || state.platform === "linux";
  if (card) card.hidden = !unix || !state.paired;
  if (grant) grant.hidden = state.platform !== "darwin";
  if (bannerGrant) bannerGrant.hidden = state.platform !== "darwin";
  if (!unix) {
    if (banner) banner.hidden = true;
    return;
  }
  try {
    const status = await window.metis.desktopPermissions({ prompt });
    const copy = desktopPermissionCopy(status);
    if (prompt && !status.available) {
      copy.title = "Enable these in System Settings";
      copy.detail = "System Settings opened. Turn on Screen Recording and Accessibility for Metis only, then restart this app.";
    }
    if (banner) {
      banner.hidden = !copy.blocked;
      byId("permission-banner-title").textContent = copy.title;
      byId("permission-banner-detail").textContent = copy.detail;
    }
    if (card) {
      card.classList.toggle("is-blocked", copy.blocked);
      const title = byId("desktop-permissions-title");
      if (title) title.textContent = copy.title;
      byId("desktop-permissions-summary").textContent = copy.detail;
    }
  } catch (error) {
    const message = error.message || "Could not check desktop permissions";
    if (banner) {
      banner.hidden = false;
      byId("permission-banner-title").textContent = "Desktop permissions are not enabled";
      byId("permission-banner-detail").textContent = message;
    }
    if (byId("desktop-permissions-summary")) byId("desktop-permissions-summary").textContent = message;
  }
}

async function refresh() {
  if (!state.paired || state.fetching || document.hidden || state.view === "settings") return;
  state.fetching = true;
  try {
    const data = await window.metis.snapshot();
    state.client = data.client?.id === state.clientId ? data.client : null;
    state.audit = Array.isArray(data.audit) ? data.audit.filter((entry) => entry.clientId === state.clientId) : [];
    state.loaded = true;
    showHubError("");
    byId("device-name").textContent = state.client?.name || state.client?.hostname || "This device";
    const access = state.client?.permissionMode === "admin" ? "Administrator access" : state.client?.permissionMode === "user" ? "User access" : "Access mode unavailable";
    byId("device-meta").textContent = [state.client?.os || "", state.client?.version ? `v${state.client.version}` : null, access].filter(Boolean).join(" · ");
    byId("device-seen").textContent = state.client?.lastSeenAt ? `Last seen ${formatDate(state.client.lastSeenAt)}` : "";
    byId("sync-label").textContent = `Updated ${new Date().toLocaleTimeString("en")}`;
    void refreshDesktopPermissions();
    renderCommands();
  } catch (error) {
    showHubError(error.message || "Could not load this device's activity");
    byId("sync-label").textContent = "Could not sync this device";
    if (!state.loaded) byId("commands-loading").textContent = "Command history unavailable.";
  } finally {
    state.fetching = false;
  }
}

async function initialize() {
  if (!window.metis) {
    byId("pair-error").textContent = "Desktop integration is unavailable. Restart the app.";
    byId("pair-error").hidden = false;
    return;
  }
  // Listen before any slow native/network lookup, so reconnects remain visible.
  window.metis.onStatus((data) => {
    const wasPaired = state.paired;
    setConnection(data);
    if (!wasPaired && state.paired) void refresh();
  });
  const loginInput = byId("autostart");
  loginInput.disabled = true;
  void window.metis.getAutostart().then(value => { loginInput.checked = value; })
    .catch(error => showHubError(error.message || "Could not read login setting"))
    .finally(() => { loginInput.disabled = false; });
  try {
    setConnection(await window.metis.state());
    if (state.paired) void refresh();
    else void refreshDesktopPermissions();
  } catch (error) {
    byId("pair-error").textContent = error.message || "Could not initialize the app";
    byId("pair-error").hidden = false;
  }
}

byId("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("pair-button");
  button.disabled = true;
  byId("pair-error").hidden = true;
  try {
    const data = await window.metis.pair({ server: byId("server").value, token: byId("token").value });
    byId("token").value = "";
    setConnection(data);
    await refresh();
  } catch (error) {
    byId("pair-error").textContent = error.message || "Pairing failed";
    byId("pair-error").hidden = false;
  } finally {
    button.disabled = false;
  }
});
byId("restart-as-administrator").addEventListener("click",async()=>{
 const button=byId("restart-as-administrator");button.disabled=true;
 try{setConnection(await window.metis.restartAsAdministrator());}
 catch(error){showHubError(error.message||"Windows approval was not confirmed. The desktop app and saved pairing are unchanged.");}
 finally{button.disabled=false;}
});
byId("refresh").addEventListener("click", () => void refresh());
byId("check-permissions")?.addEventListener("click", () => void refreshDesktopPermissions(false));
byId("grant-permissions")?.addEventListener("click", () => void refreshDesktopPermissions(true));
byId("banner-grant")?.addEventListener("click", () => void refreshDesktopPermissions(true));
byId("export").addEventListener("click", async () => {
  try { await window.metis.exportAudit(); }
  catch (error) { showHubError(error.message || "Could not export logs"); }
});
function resetCommandFilters() { state.page = 1; state.selectedLog = ""; renderCommands(); }
byId("search").addEventListener("input", resetCommandFilters);
byId("status-filter").addEventListener("change", resetCommandFilters);
byId("commands-previous").addEventListener("click", () => changeCommandPage(-1));
byId("commands-next").addEventListener("click", () => changeCommandPage(1));
byId("open-settings").addEventListener("click", () => navigate("settings"));
byId("close-settings").addEventListener("click", () => navigate("activity"));
byId("open-activity").addEventListener("click", () => navigate("activity"));
byId("open-server").addEventListener("click", () => void window.metis.openServer());
byId("autostart").addEventListener("change", async (event) => {
  event.target.disabled = true;
  try { event.target.checked = await window.metis.setAutostart(event.target.checked); }
  catch (error) { showHubError(error.message || "Could not change login setting"); event.target.checked = !event.target.checked; }
  finally { event.target.disabled = false; }
});
byId("check-updates").addEventListener("click", async () => {
  const button = byId("check-updates");
  button.disabled = true;
  byId("update-label").textContent = "Checking for updates…";
  try { byId("update-label").textContent = await window.metis.checkUpdates(); }
  catch (error) { byId("update-label").textContent = ""; showHubError(error.message || "Could not check for updates."); }
  finally { button.disabled = false; }
});
byId("unpair").addEventListener("click", async () => {
  if (!window.confirm("Disconnect this device from Metis? You can pair it again from Settings → Devices.")) return;
  try {
    const data = await window.metis.unpair();
    state.client = null; state.audit = []; state.loaded = false; state.page = 1; state.selectedLog = ""; state.view = "activity";
    setConnection(data);
    byId("server").focus();
  } catch (error) { showHubError(error.message || "Could not disconnect this device."); }
});
setInterval(() => void refresh(), 5_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
void initialize();

byId("desktop-access-permissions").addEventListener("click", async () => {
  try { const next = await window.metis.desktopAccess(); renderDesktopPermission(next); }
  catch (error) { byId("desktop-permission-reason").textContent = error.message; }
});
function renderDesktopPermission(next) {
  byId("desktop-permission-notice").hidden = Boolean(next.desktopAvailable);
  byId("desktop-permission-reason").textContent = next.desktopReason || "Desktop control is unavailable. File and command access remain available.";
  byId("desktop-access-permissions").hidden = next.platform !== "darwin";
  byId("pair-note").textContent = next.platform === "win32" ? "The code expires after 15 minutes. Enter an Administrator pairing code and confirm Windows UAC to start the background Remote Client. The desktop app stays in Standard user mode." : "The code expires after 15 minutes. System actions require the permissions of your signed-in account.";
}

const {app, Menu, ipcMain, dialog, net} = require('electron');
const path = require('node:path');
const {createRecentServers, buildJumpList} = require('./recent-servers.cjs');
const {normalizeServer, sameOrigin} = require('../../policy.cjs');
const {verifyMetisServer} = require('./server-verification.cjs');

async function createDesktop(options = {}) {
  const recentServers = createRecentServers({configPath:path.join(app.getPath('userData'),'server.json'),initialServer:options.initialServer});
  const windows = new Set(), contexts = new Set(), captures = new Set();
  let active, last, installed = false;
  const focused = () => active && windows.has(active) && !active.win.isDestroyed() ? active : [...windows].find(w=>!w.win.isDestroyed());
  const report = error => { void dialog.showMessageBox({type:'error',title:'Could not open Metis window',message:error.message}); };
  function register(handlers, owns) {
    const context = {handlers, owns}; contexts.add(context);
    if (!installed) {
      for (const channel of Object.keys(handlers)) ipcMain.handle(channel, (event,...args) => {
        const owner = [...contexts].find(item=>item.owns(event));
        if (!owner) throw Error('Access denied.');
        return owner.handlers[channel](event,...args);
      });
      installed = true;
    }
    return () => {
      contexts.delete(context);
      if (!contexts.size && installed) {
        for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
        installed = false;
      }
    };
  }
  function refreshMenus() {
    for (const entry of windows) entry.refreshMenu();
    const current = focused();
    if (current) {
      Menu.setApplicationMenu(current.getMenu());
      // setApplicationMenu applies globally on Windows/Linux; restore each window's own callbacks.
      for (const entry of windows) if (!entry.win.isDestroyed()) entry.applyMenu();
      if (process.platform === 'darwin') app.dock?.setMenu(Menu.buildFromTemplate([
        {label:'New Window',click:()=>{void newWindow().catch(report);}},
        {label:'Recent Servers',submenu:recentServers.list().map(entry=>({
          label:entry.label.replace(/&/g,'&&'),click:()=>{void newWindow({serverId:entry.id}).catch(report);}
        })).concat(recentServers.list().length?[]:[{label:'No recent servers',enabled:false}])}
      ]));
    }
    if (process.platform === 'win32' && !process.env.METIS_DESKTOP_TEST_DATA) {
      try {
        const result=app.setJumpList(buildJumpList({entries:recentServers.list(),removedItems:app.getJumpListSettings().removedItems,execPath:process.execPath,appPath:app.getAppPath(),packaged:app.isPackaged}));
        if(result!=='ok')console.warn('Metis Recent Servers Jump List:',result);
      } catch(error) { console.warn('Metis Recent Servers Jump List:',error.message); }
    }
  }
  async function newWindow({serverId,serverUrl,navigationUrl}={}) {
    if (serverId !== undefined) {
      serverUrl = recentServers.resolve(serverId);
      if (!serverUrl) return null;
    }
    if (serverUrl !== undefined) serverUrl=normalizeServer(serverUrl);
    else serverUrl=focused()?.getState().server || (recentServers.hasCurrent() ? recentServers.getCurrent() : undefined);
    if (navigationUrl && (!serverUrl || !sameOrigin(navigationUrl,serverUrl))) throw Error('Access denied.');
    const captureOwner = {};
    const entry = await require('./web-window.cjs').createDesktopWindow({
      ...options,initialServer:serverUrl,recentServers,registerHandlers:register,
      onNewWindow:()=>{void newWindow().catch(report);},
      onOpenUrl:(url,currentServer)=>{void newWindow({serverUrl:currentServer,navigationUrl:url}).catch(report);},
      onChanged:refreshMenus,
      onShortcutCapture:value=>{if(value)captures.add(captureOwner);else captures.delete(captureOwner);options.onShortcutCapture?.(captures.size>0);},
      onFocus:window=>{active=window;refreshMenus();},
      onClosed:window=>{windows.delete(window);if(active===window)active=undefined;refreshMenus();},
      navigationUrl,
    });
    windows.add(entry);active=entry;last=entry;refreshMenus();
    return entry;
  }
  const requested=options.initialServerId && recentServers.resolve(options.initialServerId);
  const initial=await newWindow({serverUrl:requested || (recentServers.hasCurrent()?recentServers.getCurrent():options.initialServer)});
  const recentReady = recentServers.verifyLegacy(url => verifyMetisServer(url, {
    fetch: (address, options) => net.fetch(address, options), verifyPage: true
  }), initial.getState().server).then(refreshMenus, error => console.warn('Could not check previous Metis servers:', error.code || 'storage error'));
  return {
    get win(){return (focused()||last).win;},
    get activeWindow(){return focused();},
    getView:()=>focused()?.getView(),getState:()=>focused()?.getState()||last.getState(),
    getFileDropState:()=>focused()?.getFileDropState(),getRecentServers:()=>recentServers.list(),
    getWindows:()=>[...windows],newWindow,refreshMenus,recentReady,
    switchServer:id=>focused()?.switchServer(id)??false,
    settings:()=>focused()?.settings(),load:()=>focused()?.load(),initialLoad:initial.initialLoad,
    async openServer(serverUrl) {
      const normalized=normalizeServer(serverUrl);
      const entry=[...windows].find(w=>w.getState().server===normalized)||[...windows].find(w=>sameOrigin(w.getState().server,normalized))||await newWindow({serverUrl:normalized});
      active=entry;refreshMenus();return entry;
    },
    async show() {
      const current=focused()||await newWindow();
      active=current;
      if(current.win.isMinimized())current.win.restore();current.win.show();current.win.focus();
      refreshMenus();return current;
    },
  };
}
module.exports={createDesktop};

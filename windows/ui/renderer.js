const api = window.metisDesktop;
const byId = (id) => document.getElementById(id);
function render(state) {
  byId('form').hidden = state.mode !== 'settings';
  byId('actions').hidden = !['loading', 'error'].includes(state.mode);
  byId('retry').hidden = state.mode === 'loading';
  byId('server-label').textContent = state.server;
  byId('heading').textContent = state.mode === 'settings' ? 'Mit Metis verbinden.' : state.mode === 'error' ? 'Verbindung unterbrochen.' : 'Metis wird geöffnet.';
  byId('description').textContent = state.mode === 'settings' ? 'Nutze den öffentlichen Metis-Server oder gib die Adresse deiner eigenen Installation ein.' : state.mode === 'error' ? state.message : 'Verbindung zum Server wird hergestellt.';
  if (state.mode === 'settings') {
    byId('server').value = state.server;
    byId('validation').textContent = '';
    byId('server').focus();
  }
}
api.onState(render);
api.state().then(render);
byId('retry').addEventListener('click', () => api.retry());
byId('settings').addEventListener('click', () => api.settings());
byId('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('form').querySelector('button');
  button.disabled = true;
  try {
    const result = await api.connect(byId('server').value);
    if (!result.ok) byId('validation').textContent = result.error;
  } catch { byId('validation').textContent = 'Die Adresse konnte nicht gespeichert werden. Versuche es erneut.'; }
  finally { button.disabled = false; }
});

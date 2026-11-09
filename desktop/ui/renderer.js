const api = window.metisDesktop;
const byId = (id) => document.getElementById(id);
function render(state) {
  byId('form').hidden = state.mode !== 'settings';
  byId('actions').hidden = !['loading', 'error'].includes(state.mode);
  byId('retry').hidden = state.mode === 'loading';
  byId('server-label').textContent = state.server;
  byId('heading').textContent = state.mode === 'settings' ? 'Connect to Metis.' : state.mode === 'error' ? 'Connection interrupted.' : 'Opening Metis.';
  byId('description').textContent = state.mode === 'settings' ? 'Use the Metis server or enter the address of your own installation.' : state.mode === 'error' ? state.message : 'Connecting to the server.';
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
  } catch { byId('validation').textContent = 'The address could not be saved. Try again.'; }
  finally { button.disabled = false; }
});

// Native named pipe transport, entirely off Electron's main thread.
// Both peers are kernel-identified by PID, SID, session, token and executable.
// The High client uses IDENTIFICATION SQOS: the Medium server cannot impersonate it.
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { encode, decoder, MAX_FRAME } = require('./pipe-protocol.cjs');
let handle = 0, closed = false, verified = false, expectedPid = workerData.peerPid;
let timer, queued = [], queuedBytes = 0, connected = false;
const koffi = require('koffi'), kernel = koffi.load('kernel32.dll'), adv = koffi.load('advapi32.dll');
const close = kernel.func('bool CloseHandle(uintptr_t)');
const last = kernel.func('uint32_t GetLastError()');
const openProcess = kernel.func('uintptr_t OpenProcess(uint32_t,bool,uint32_t)');
const openToken = adv.func('bool OpenProcessToken(uintptr_t,uint32_t,void *)');
const info = adv.func('bool GetTokenInformation(uintptr_t,uint32_t,void *,uint32_t,void *)');
const image = kernel.func('bool QueryFullProcessImageNameW(uintptr_t,uint32_t,void *,void *)');
const { tokenIdentity, currentTokenIdentity } = require('../main/windows-token-identity.cjs');
const own = currentTokenIdentity();
const wide = value => Buffer.from(value + '\0', 'utf16le');
const pipe = '\\\\.\\pipe\\metis-device-' + workerData.nonce;
const invalid = value => value === -1 || BigInt(value) === 0xFFFFFFFFFFFFFFFFn || !value;
const create = kernel.func('uintptr_t CreateNamedPipeW(void *,uint32_t,uint32_t,uint32_t,uint32_t,uint32_t,uint32_t,void *)');
const connect = kernel.func('bool ConnectNamedPipe(uintptr_t,void *)');
const disconnect = kernel.func('bool DisconnectNamedPipe(uintptr_t)');
const open = kernel.func('uintptr_t CreateFileW(void *,uint32_t,uint32_t,void *,uint32_t,uint32_t,uintptr_t)');
const state = kernel.func('bool SetNamedPipeHandleState(uintptr_t,void *,void *,void *)');
const read = kernel.func('bool ReadFile(uintptr_t,void *,uint32_t,void *,void *)');
const write = kernel.func('bool WriteFile(uintptr_t,void *,uint32_t,void *,void *)');
const peek = kernel.func('bool PeekNamedPipe(uintptr_t,void *,uint32_t,void *,void *,void *)');
const peerPid = kernel.func(workerData.server ? 'bool GetNamedPipeClientProcessId(uintptr_t,void *)' : 'bool GetNamedPipeServerProcessId(uintptr_t,void *)');
function stop(error) {
  if (closed) return; closed = true; clearTimeout(timer);
  if (handle && !invalid(handle)) close(handle);
  handle = 0; queued = []; queuedBytes = 0;
  if (error) parentPort.postMessage({ type:'error', error:error.message });
  parentPort.close();
}
function verify() {
  if (!expectedPid) return false;
  const pid = Buffer.alloc(4);
  if (!peerPid(handle, pid) || pid.readUInt32LE() !== expectedPid) throw Error('Background device peer PID mismatch.');
  const processHandle = Number(openProcess(0x1000, false, expectedPid)), token = Buffer.alloc(8);
  if (!processHandle) throw Error('Could not verify background device peer.');
  try {
    if (!openToken(processHandle, 8, token)) throw Error('Could not inspect background device peer token.');
    const identity = tokenIdentity(koffi, info, Number(token.readBigUInt64LE()));
    const name = Buffer.alloc(65536), length = Buffer.alloc(4); length.writeUInt32LE(32768);
    if (!image(processHandle, 0, name, length)) throw Error('Could not inspect background device executable.');
    const executable = name.subarray(0, length.readUInt32LE()*2).toString('utf16le');
    if (identity.sid !== own.sid || identity.session !== own.session ||
        identity.elevated !== Boolean(workerData.server) ||
        path.win32.normalize(executable).toLowerCase() !== path.win32.normalize(process.execPath).toLowerCase())
      throw Error('Background device identity mismatch.');
    return true;
  } finally {
    if (token.readBigUInt64LE()) close(Number(token.readBigUInt64LE()));
    close(processHandle);
  }
}
const receive = decoder(message => parentPort.postMessage({type:'message', message}));
parentPort.on('message', message => {
  if (message.type === 'close') { stop(); return; }
  if (message.type === 'peer') { expectedPid = message.pid; return; }
  if (message.type !== 'send' || closed || !verified) return;
  try {
    const bytes = encode(message.message);
    if (queuedBytes + bytes.length > 2 * MAX_FRAME) throw Error('Background device channel is busy.');
    queued.push(bytes); queuedBytes += bytes.length;
  } catch (error) { stop(error); }
});
const deadline = Date.now() + 125000;
function tick() {
  if (closed) return;
  try {
    if (!handle) {
      if (workerData.server) {
        // FIRST_PIPE_INSTANCE prevents pipe-name squatting; no remote clients.
        handle = Number(create(wide(pipe), 0x80003, 0x9, 1, 65536, 65536, 0, null));
        if (invalid(handle)) { handle=0; throw Error('Could not create private device pipe.'); }
        parentPort.postMessage({type:'listening'});
      } else {
        // SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION (not impersonation).
        handle = Number(open(wide(pipe), 0xC0000000, 0, null, 3, 0x110000, 0));
        if (invalid(handle)) { handle=0; if (Date.now() > deadline) throw Error('Desktop device channel was not available.'); timer=setTimeout(tick,25); return; }
        const mode=Buffer.alloc(4); mode.writeUInt32LE(1);
        if (!state(handle,mode,null,null)) throw Error('Could not configure device channel.');
        connected=true;
      }
    }
    if (!connected && workerData.server) {
      if (connect(handle,null) || last()===535) connected=true;
      else if (![536,232].includes(last())) throw Error('Could not connect background device pipe.');
    }
    if (connected && !verified) {
      if (verify()) { verified=true; parentPort.postMessage({type:'connected',pid:expectedPid}); }
    }
    if (verified) {
      const available=Buffer.alloc(4);
      if (!peek(handle,null,0,null,available,null)) throw Error('Background device channel closed.');
      if (available.readUInt32LE()) {
        const data=Buffer.alloc(Math.min(65536,available.readUInt32LE())), count=Buffer.alloc(4);
        if (!read(handle,data,data.length,count,null)) throw Error('Background device read failed.');
        receive(data.subarray(0,count.readUInt32LE()));
      }
      if (queued.length) {
        const data=queued[0], count=Buffer.alloc(4);
        const ok=write(handle,data,Math.min(data.length,32768),count,null), written=count.readUInt32LE();
        if (!ok && last()!==232) throw Error('Background device write failed.');
        if (written) { queuedBytes-=written; if (written===data.length) queued.shift(); else queued[0]=data.subarray(written); }
      }
    } else if (Date.now()>deadline) throw Error('Background device approval timed out.');
    timer=setTimeout(tick,10);
  } catch (error) { stop(error); }
}
if (process.platform!=='win32' || !/^[a-f0-9]{32}$/.test(workerData.nonce||'') ||
    own.elevated !== !workerData.server) stop(Error('Invalid background device role.'));
else tick();

// Bounded JSON frames; no executable commands or paths in the local protocol.
const MAX_FRAME = 2 * 1024 * 1024;
function encode(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_FRAME) throw Error('Device message exceeds the local limit.');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
function decoder(onMessage) {
  let pending = Buffer.alloc(0);
  return chunk => {
    if (pending.length + chunk.length > MAX_FRAME + 4 + 65536) throw Error('Invalid device frame.');
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE();
      if (!length || length > MAX_FRAME) throw Error('Invalid device frame.');
      if (pending.length < length + 4) break;
      const value = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
      pending = pending.subarray(4 + length);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid device message.');
      onMessage(value);
    }
  };
}
function roleArgument(argv) {
  const matches = argv.filter(value => value.startsWith('--metis-device-host='));
  if (matches.length !== 1) throw Error('Invalid background device launch.');
  const match = /^--metis-device-host=([a-f0-9]{32}):([1-9][0-9]{0,9})$/.exec(matches[0]);
  if (!match || Number(match[2]) > 0xFFFFFFFF || Number(match[2]) === process.pid) throw Error('Invalid background device launch.');
  return { nonce: match[1], parentPid: Number(match[2]) };
}
module.exports = { MAX_FRAME, encode, decoder, roleArgument };

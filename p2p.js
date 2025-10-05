// p2p.js
const net = require('net');
const { enc, dec, sign } = require('./crypto');
const { MAX_MSG_BYTES, RATE_WINDOW_MS, RATE_MAX_MSGS, BAN_SCORE_LIMIT } = require('./config');
const { GLOBALS } = require('./blockchain');

function createP2P({ host, port, clientOnly=false, nodeKey, onNewBlock, onNewTx, onSyncAdopt }) {
  const sockets = new Set();
  const peers = new Set();
  const rate  = new Map(); // socket -> {ts,count}
  const ban   = new Map(); // socket -> score

  function addBan(socket, n=10){ const s=(ban.get(socket)||0)+n; ban.set(socket,s); if (s>=BAN_SCORE_LIMIT) try{socket.destroy();}catch{} }
  function isBanned(socket){ return (ban.get(socket)||0) >= BAN_SCORE_LIMIT; }

  function rateOk(socket, bytes) {
    if (bytes > MAX_MSG_BYTES) { addBan(socket, 50); return false; }
    const r = rate.get(socket) || { ts: Date.now(), count: 0 };
    const now = Date.now();
    if (now - r.ts > RATE_WINDOW_MS) { r.ts = now; r.count = 0; }
    r.count++;
    rate.set(socket, r);
    if (r.count > RATE_MAX_MSGS) { addBan(socket, 10); return false; }
    return true;
  }

  function send(socket, obj) {
    if (!socket || socket.destroyed) return;
    const line = enc(obj) + '\n';
    if (line.length > MAX_MSG_BYTES) return;
    socket.write(line);
  }
  function broadcast(obj) {
    const line = enc(obj) + '\n';
    if (line.length > MAX_MSG_BYTES) return;
    for (const s of sockets) if(!isBanned(s)) s.write(line);
  }

  function helloMsg() {
    // authenticated HELLO: bukti kepemilikan key (menandatangani genesis hash)
    const payload = enc({ hello: GLOBALS.GENESIS_BLOCK.hash, ts: Date.now() });
    const sig = sign(nodeKey.privateKey, payload);
    return { type:'HELLO', genesis: GLOBALS.GENESIS_BLOCK.hash, nodeId: nodeKey.id, pub: nodeKey.publicKeyPEM, sig, payload };
  }

  function askSync(socket){
    send(socket, { type:'INV', height: GLOBALS.CHAIN.length, tip: GLOBALS.CHAIN[GLOBALS.CHAIN.length-1].hash });
  }

  function wire(socket){
    let buffer=''; sockets.add(socket);
    socket.on('data', (chunk)=>{
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,idx); buffer = buffer.slice(idx+1);
        if (!line.trim()) continue;
        if (!rateOk(socket, line.length)) continue;
        let msg; try { msg = dec(line); } catch { addBan(socket, 5); continue; }
        onMsg(socket, msg);
      }
    });
    socket.on('error', ()=>{});
    socket.on('close', ()=>{ sockets.delete(socket); rate.delete(socket); ban.delete(socket); });
  }

  function connectToPeer(addr){
    if (!addr || peers.has(addr)) return;
    const [h,p] = addr.split(':');
    const s = net.createConnection({ host:h, port:Number(p) }, ()=>{
      wire(s); peers.add(addr);
      send(s, helloMsg());
      askSync(s);
    });
  }

  if (!clientOnly) {
    const server = net.createServer((socket)=>{ wire(socket); });
    server.listen(port, host, ()=> console.log(`[p2p] listening on ${host}:${port} genesis=${GLOBALS.GENESIS_BLOCK.hash.slice(0,12)}`));
  } else {
    console.log(`[p2p] client-only mode; genesis=${GLOBALS.GENESIS_BLOCK.hash.slice(0,12)}`);
  }

  function onMsg(socket, msg){
    if (!msg || typeof msg!=='object') return;
    switch (msg.type) {
      case 'HELLO': {
        // minimal auth: verify signature of payload
        const ok = require('./crypto').verifySignature(msg.pub, msg.payload, msg.sig);
        if (!ok || (dec(msg.payload).hello !== GLOBALS.GENESIS_BLOCK.hash)) { addBan(socket,50); socket.end(); return; }
        send(socket, { type:'HELLO_ACK', genesis: GLOBALS.GENESIS_BLOCK.hash, height: GLOBALS.CHAIN.length });
        break;
      }
      case 'INV': {
        if (msg.height > GLOBALS.CHAIN.length) send(socket, { type:'GET_CHAIN_FROM', from: Math.max(0, GLOBALS.CHAIN.length-256) });
        else if (msg.height < GLOBALS.CHAIN.length) send(socket, { type:'CHAIN', blocks: GLOBALS.CHAIN.slice(Math.max(0, GLOBALS.CHAIN.length-256)) });
        break;
      }
      case 'GET_CHAIN_FROM': {
        const from = Math.max(0, Math.min(GLOBALS.CHAIN.length-1, msg.from||0));
        send(socket, { type:'CHAIN', blocks: GLOBALS.CHAIN.slice(from) });
        break;
      }
      case 'CHAIN': {
        const incoming = msg.blocks; if (!Array.isArray(incoming) || incoming.length===0) break;
        let tmp = GLOBALS.CHAIN.slice(0, incoming[0].index);
        for (const b of incoming) {
          if (b.index===0) {
            if (enc(b)!==enc(GLOBALS.GENESIS_BLOCK)) return;
            tmp = [GLOBALS.GENESIS_BLOCK]; continue;
          }
          const prev = tmp[b.index-1]; if (!prev || b.prevHash !== prev.hash) { send(socket, { type:'GET_CHAIN_FROM', from:0 }); return; }
          const v = require('./blockchain').validateBlockAgainst(tmp, b);
          if (!v.ok) { addBan(socket, 2); return; }
          tmp.push(b);
        }
        const better = require('./blockchain').pickBetterChain(GLOBALS.CHAIN, tmp);
        if (better !== GLOBALS.CHAIN) {
          GLOBALS.CHAIN = better;
          require('./blockchain').persistChain();
          onSyncAdopt && onSyncAdopt();
          broadcast({ type:'INV', height: GLOBALS.CHAIN.length, tip: GLOBALS.CHAIN[GLOBALS.CHAIN.length-1].hash });
          console.log(`[sync] adopted better chain: height=${GLOBALS.CHAIN.length}`);
        }
        break;
      }
      case 'NEW_BLOCK': {
        const b = msg.block; if (!b) { askSync(socket); break; }
        const res = require('./blockchain').addBlockFromPeer(b);
        if (!res.ok) { addBan(socket, 2); askSync(socket); }
        else broadcast({ type:'INV', height: GLOBALS.CHAIN.length, tip: GLOBALS.CHAIN[GLOBALS.CHAIN.length-1].hash });
        break;
      }
      case 'TX': {
        onNewTx && onNewTx(msg.op, (relay)=> { if (relay) broadcast({ type:'TX', op: msg.op }); });
        break;
      }
      case 'ERROR': { console.warn('[peer-error]', msg.reason||''); break; }
    }
  }

  return { connectToPeer, broadcast, peers };
}

module.exports = { createP2P };
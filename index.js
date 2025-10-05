#!/usr/bin/env node
// index.js
const fs = require('fs');
const readline = require('readline');

const { PORT, HOST, GENESIS_NAME, BOOTSTRAPS, CLIENT_ONLY, DIFFICULTY_BITS, MEMPOOL_MINFEE } = require('./config');
const { enc, now, sha256, short, loadOrCreateKeypair, sign } = require('./crypto');
const bc = require('./blockchain');
const { Mempool } = require('./mempool');
const { createP2P } = require('./p2p');
const { GOV } = require('./governance');
const { GLOBALS } = require('./state');

const { dataDir } = require('./config');

// --- keys ---
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive:true });
const { publicKey, privateKey, id: NODE_ID, publicKeyPEM } = loadOrCreateKeypair(dataDir);

// --- init chain (bootstrap validators kosong; nanti di-governance bisa tambah) ---
bc.initChain({ dataDir, genesisName: GENESIS_NAME, nodeId: NODE_ID, bootstrapValidators: [] });
console.log(`[node] id=${NODE_ID}`);
console.log(`[consensus] PoW difficulty(default)=${DIFFICULTY_BITS} bits`);
console.log(`[policy] min_fee=${MEMPOOL_MINFEE}`);

// --- mempool ---
const mempool = new Mempool();

// --- p2p ---
const p2p = createP2P({
  host: HOST, port: PORT, clientOnly: CLIENT_ONLY,
  nodeKey: { id: NODE_ID, privateKey, publicKeyPEM },
  onNewTx: (op, relay) => {
    if (!quickVerifyOp(op)) return relay(false);
    if (mempool.add(op)) return relay(true);
    return relay(false);
  },
  onSyncAdopt: ()=>{} // no-op
});

// connect bootstraps
for (const p of BOOTSTRAPS) p2p.connectToPeer(p);

// --- helpers ---
function formatTime(ts) {
  const dt = new Date(ts);
  const iso = dt.toLocaleString();
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const sec = Math.floor(abs/1000);
  const min = Math.floor(sec/60);
  const hr = Math.floor(min/60);
  const day= Math.floor(hr/24);
  const rel = day? `${day}d` : hr? `${hr}h` : min? `${min}m` : `${sec}s`;
  return `${iso} (${rel}${diff>=0?'':' ahead'})`;
}
function resolveTweetIdPrefix(prefix){
  const stAll = bc.rebuildState(GLOBALS.CHAIN, { activeOnly:false });
  const out = [];
  for (const id of stAll.tweets.keys()) if (id.startsWith(prefix)) out.push(id);
  if (out.length===1) return out[0];
  if (out.length>1) { console.log(`[warn] prefix tidak unik, dipakai: ${out[0]} (total ${out.length})`); return out[0];}
  return null;
}
function newSignedOp(type, payload) {
  const ts = now();
  let base, payloadStr;
  if (type==='TWEET')  { base={ text:payload.text, fee:payload.fee||MEMPOOL_MINFEE, authorPubPEM: publicKeyPEM, ts }; payloadStr=enc({ type, text:base.text, authorPubPEM: base.authorPubPEM, ts, fee: base.fee }); }
  else if (type==='COMMENT'){ base={ ref:payload.ref, text:payload.text, fee:payload.fee||MEMPOOL_MINFEE, authorPubPEM: publicKeyPEM, ts }; payloadStr=enc({ type, ref:base.ref, text:base.text, authorPubPEM: base.authorPubPEM, ts, fee: base.fee }); }
  else if (type==='GOV_PROPOSE'){ base={ pid:payload.pid, payload:payload.payload, authorPubPEM: publicKeyPEM, ts }; payloadStr=enc({ type, pid:base.pid, payload:base.payload, authorPubPEM: base.authorPubPEM, ts }); }
  else { throw new Error('unknown op type'); }
  const id = sha256(payloadStr);
  const sig= sign(privateKey, payloadStr);
  return { type, id, ...base, authorId: NODE_ID, sig };
}
function newGovVote(pid, candidateHash) {
  const payload = enc({ pid, candidateHash });
  const sig = sign(privateKey, payload);
  return { type:'GOV_VOTE', pid, voter:NODE_ID, pubPEM: publicKeyPEM, sig };
}
function quickVerifyOp(op) {
  if (!op || !op.id || !op.authorId || !op.authorPubPEM || !op.sig || !op.ts || !op.type) return false;
  return bc.verifyOp(op);
}

// --- REPL ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();

function printHelp(){
  console.log(`Commands:
  help
  myid
  peers
  connect <host:port>
  tweet <text> [fee]
  comment <tweetId|prefix> <text> [fee]
  txpool
  mine [nOps]
  show [tweetId|prefix]
  show-all [tweetId|prefix]
  height
  tip
  export
  # governance (on-chain):
  propose-param <key> <value>        # ex: propose-param difficultyBits 20
  propose-val-add <validatorIdHex>
  propose-val-del <validatorIdHex>
  vote <pid> <candidateTipHash>
  `);
}

function splitArgs(str){
  const out=[], q='"'; let cur='', inQ=false;
  for (let i=0;i<str.length;i++){
    const ch=str[i];
    if (ch===q){ inQ=!inQ; continue; }
    if (ch===' ' && !inQ){ if (cur){ out.push(cur); cur=''; } continue; }
    cur+=ch;
  }
  if (cur) out.push(cur);
  return out;
}

rl.on('line',(line)=>{
  const cmd=line.trim(); if(!cmd){ rl.prompt(); return; }
  const [word, ...rest]=splitArgs(cmd);
  try {
    switch(word){
      case 'help': printHelp(); break;
      case 'myid': console.log(NODE_ID); break;
      case 'peers': console.log(Array.from(p2p.peers)); break;
      case 'connect': {
        const addr=rest[0]; if(!addr){ console.log('Usage: connect host:port'); break; }
        p2p.connectToPeer(addr); break;
      }
      case 'tweet': {
        const feeMaybe = Number(rest[rest.length-1]);
        const fee = Number.isFinite(feeMaybe) ? feeMaybe : MEMPOOL_MINFEE;
        const text = Number.isFinite(feeMaybe) ? rest.slice(0,-1).join(' ') : rest.join(' ');
        if (!text) { console.log('Usage: tweet <text> [fee]'); break; }
        const op=newSignedOp('TWEET',{ text, fee });
        if (mempool.add(op)) { p2p.broadcast({ type:'TX', op }); console.log(`✓ queued tweet (${short(op.id)}): ${text} fee=${op.fee}`); }
        else console.log('gagal masuk mempool (dupe/fee rendah)');
        break;
      }
      case 'comment': {
        let ref=rest.shift();
        const feeMaybe= Number(rest[rest.length-1]);
        const fee = Number.isFinite(feeMaybe) ? feeMaybe : MEMPOOL_MINFEE;
        const text = Number.isFinite(feeMaybe) ? rest.slice(0,-1).join(' ') : rest.join(' ');
        if(!ref || !text){ console.log('Usage: comment <tweetId|prefix> <text> [fee]'); break; }
        if (ref.length<64){ const full=resolveTweetIdPrefix(ref); if(!full){ console.log('tweetId tidak ditemukan'); break; } ref=full; }
        const op=newSignedOp('COMMENT',{ ref, text, fee });
        if (mempool.add(op)) { p2p.broadcast({ type:'TX', op }); console.log(`↳ queued comment on ${short(ref)} fee=${op.fee}: ${text}`); }
        else console.log('gagal masuk mempool (dupe/fee rendah)');
        break;
      }
      case 'txpool': console.log(`mempool size: ${mempool.size()}`); break;
      case 'mine': {
        const n = Math.max(1, parseInt(rest[0]||'999999',10));
        const ops = mempool.pick(n);
        if (ops.length===0){ console.log('mempool kosong'); break; }
        const bits = GLOBALS.PARAMS.difficultyBits || DIFFICULTY_BITS;
        const b = bc.mineBlock({ ops, difficultyBits: bits });
        mempool.removeMany(ops);
        p2p.broadcast({ type:'NEW_BLOCK', block:b });
        console.log(`⛏️  mined #${b.index} ops=${ops.length} hash=${short(b.hash,16)} diff=${bits}`);
        break;
      }
      case 'show': {
        let id=rest[0];
        const st=bc.rebuildState(GLOBALS.CHAIN, { activeOnly:true });
        if (!id) {
          for (const t of st.timeline.slice(0,50)) {
            console.log(`• ${t.text}  (id:${short(t.id)}, by:${short(t.authorId)}, ${formatTime(t.ts)})`);
            const cs = st.commentsByRef.get(t.id)||[];
            for (const c of cs) console.log(`   ↳ ${c.text} (by:${short(c.authorId)}, ${formatTime(c.ts)})`);
          }
        } else {
          if (id.length<64){ const full=resolveTweetIdPrefix(id); if(!full){ console.log('tweet tidak ditemukan/expired'); break; } id=full; }
          const tw = st.tweets.get(id);
          if (!tw) { console.log('tweet tidak ditemukan/expired'); break; }
          console.log(`TWEET ${tw.id}
  text: ${tw.text}
  by: ${tw.authorId}
  ts: ${formatTime(tw.ts)}`);
          const cs = st.commentsByRef.get(tw.id)||[];
          for (const c of cs) console.log(`  COMMENT ${c.id}
    text: ${c.text}
    by: ${c.authorId}
    ts: ${formatTime(c.ts)}`);
        }
        break;
      }
      case 'show-all': {
        let id=rest[0];
        const st=bc.rebuildState(GLOBALS.CHAIN, { activeOnly:false });
        if (!id) {
          for (const t of st.timeline.slice(0,50)) {
            console.log(`• ${t.text}  (id:${short(t.id)}, by:${short(t.authorId)}, ${formatTime(t.ts)})`);
            const cs = st.commentsByRef.get(t.id)||[];
            for (const c of cs) console.log(`   ↳ ${c.text} (by:${short(c.authorId)}, ${formatTime(c.ts)})`);
          }
        } else {
          if (id.length<64){ const full=resolveTweetIdPrefix(id); if(!full){ console.log('tweet tidak ditemukan'); break; } id=full; }
          const tw = st.tweets.get(id); if(!tw){ console.log('tweet tidak ditemukan'); break; }
          console.log(`TWEET ${tw.id}
  text: ${tw.text}
  by: ${tw.authorId}
  ts: ${formatTime(tw.ts)}`);
          const cs = st.commentsByRef.get(tw.id)||[];
          for (const c of cs) console.log(`  COMMENT ${c.id}
    text: ${c.text}
    by: ${c.authorId}
    ts: ${formatTime(c.ts)}`);
        }
        break;
      }
      case 'height': console.log(GLOBALS.CHAIN.length); break;
      case 'tip': console.log(GLOBALS.CHAIN[GLOBALS.CHAIN.length-1].hash); break;
      case 'export': console.log(JSON.stringify(GLOBALS.CHAIN, null, 2)); break;

      // --- Governance on-chain ---
      case 'propose-param': {
        const key=rest[0], valueRaw=rest[1];
        if (!key || valueRaw===undefined){ console.log('Usage: propose-param <key> <value>'); break; }
        const value = (/^\d+$/.test(valueRaw)) ? Number(valueRaw) : valueRaw;
        const pid = sha256(enc({k:key,v:value,ts:Date.now(),node:NODE_ID}));
        const op = newSignedOp('GOV_PROPOSE', { pid, payload:{ kind:GOV.PARAMS_SET, key, value } });
        if (mempool.add(op)) { p2p.broadcast({ type:'TX', op }); console.log(`[gov] proposed PARAMS_SET ${key}=${value} pid=${pid}`); }
        else console.log('proposal rejected by mempool');
        break;
      }
      case 'propose-val-add': {
        const vid = rest[0]; if(!vid){ console.log('Usage: propose-val-add <validatorIdHex>'); break; }
        const pid = sha256(enc({add:vid,ts:Date.now(),node:NODE_ID}));
        const op = newSignedOp('GOV_PROPOSE', { pid, payload:{ kind:GOV.VALIDATOR_ADD, id: vid } });
        if (mempool.add(op)) { p2p.broadcast({ type:'TX', op }); console.log(`[gov] propose VALIDATOR_ADD ${vid} pid=${pid}`); }
        else console.log('proposal rejected by mempool');
        break;
      }
      case 'propose-val-del': {
        const vid = rest[0]; if(!vid){ console.log('Usage: propose-val-del <validatorIdHex>'); break; }
        const pid = sha256(enc({del:vid,ts:Date.now(),node:NODE_ID}));
        const op = newSignedOp('GOV_PROPOSE', { pid, payload:{ kind:GOV.VALIDATOR_DEL, id: vid } });
        if (mempool.add(op)) { p2p.broadcast({ type:'TX', op }); console.log(`[gov] propose VALIDATOR_DEL ${vid} pid=${pid}`); }
        else console.log('proposal rejected by mempool');
        break;
      }
      case 'vote': {
        const pid = rest[0], tip = rest[1];
        if (!pid || !tip){ console.log('Usage: vote <pid> <candidateTipHash>'); break; }
        const op = newGovVote(pid, tip);
        if (mempool.add({ ...op, id: sha256(enc(op)), ts: now(), authorId: NODE_ID })) { // pack as op for mempool relay
          p2p.broadcast({ type:'TX', op: { ...op, id: sha256(enc(op)), ts: now(), authorId: NODE_ID } });
          console.log(`[gov] vote pid=${pid} tip=${tip}`);
        } else console.log('vote rejected by mempool');
        break;
      }

      default: console.log('Unknown command. Type `help`.'); break;
    }
  } catch(e){ console.error('Error:', e.message); }
  rl.prompt();
});

console.log('[ready] commands: tweet, comment, txpool, mine, show, show-all, governance (propose-*, vote), peers, myid');
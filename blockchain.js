// blockchain.js
const path = require('path');
const { enc, now, sha256 } = require('./crypto');
const { RULES, REASONS } = require('./rules');
const { atomicWriteJSON, safeReadJSON, ensureDir } = require('./storage');
const { GLOBALS, initFiles, loadSeenOps, saveSeenOps, loadParams, saveParams, loadValidators, saveValidators } = require('./state');
const { DIFFICULTY_BITS, DAILY_CHAT_LIMIT, TWEET_TTL_MS, MAX_BLOCK_OPS, MAX_CLOCK_DRIFT } = require('./config');
const { GOV, applyGovernance } = require('./governance');

// ---------- helpers ----------
function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const da= String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
function isChat(op){ return op && (op.type==='TWEET' || op.type==='COMMENT'); }

function merkleRoot(ops) {
  if (!ops || ops.length === 0) return sha256('[]');
  let layer = ops.map(o => sha256(o.id));
  while (layer.length > 1) {
    const next = [];
    for (let i=0;i<layer.length;i+=2) {
      const a = layer[i], b = layer[i+1] || layer[i];
      next.push(sha256(a+b));
    }
    layer = next;
  }
  return layer[0];
}
function blockHeaderForHash(b) {
  return {
    index: b.index,
    prevHash: b.prevHash,
    timestamp: b.timestamp,
    difficulty: b.difficulty,
    opsRoot: merkleRoot(b.ops||[]),
    nonce: b.nonce
  };
}
function blockHash(b) { return sha256(enc(blockHeaderForHash(b))); }
function meetsPow(hashHex, difficultyBits) {
  const bits = difficultyBits;
  const nBytes = Math.floor(bits/8), rem = bits%8;
  for (let i=0;i<nBytes;i++) if (hashHex.slice(i*2,i*2+2)!=='00') return false;
  if (rem===0) return true;
  const next = parseInt(hashHex.slice(nBytes*2, nBytes*2+2),16);
  const mask = 0xFF << (8-rem) & 0xFF;
  return (next & mask) === 0;
}

// ---------- persistence ----------
function chainFile(genesisName) {
  return `chain-${sha256(genesisName)}.json`;
}
function loadChain(file, genesis) {
  if (!require('fs').existsSync(file)) return [genesis];
  return safeReadJSON(file, [genesis]);
}
function saveChain(file, chain) { atomicWriteJSON(file, chain); }

// ---------- init ----------
function initChain({ dataDir, genesisName, nodeId, bootstrapValidators = [] }) {
  const genesis = {
    index:0, prevHash:'0'.repeat(64), timestamp:1720000000000,
    difficulty:1, ops:[{ type:'GENESIS', id:sha256(genesisName), ts:0, authorId:'genesis', authorPubPEM:'genesis', sig:'genesis', note:genesisName }],
    nonce:0
  };
  genesis.hash = blockHash(genesis);

  const ghash = sha256(genesisName);
  initFiles(dataDir, ghash);

  GLOBALS.GENESIS_BLOCK = genesis;
  GLOBALS.NODE_ID = nodeId;

  ensureDir(dataDir);
  const chainPath = GLOBALS.FILES.chain;
  GLOBALS.CHAIN = loadChain(chainPath, genesis);

  loadSeenOps();
  for (const b of GLOBALS.CHAIN) for (const o of (b.ops||[])) if (o.id) GLOBALS.SEEN_OPS.add(o.id);
  saveSeenOps();

  // params (difficulty can be overridden on-chain)
  loadParams({ difficultyBits: null }); // null→use config default
  // validators: start from bootstrap (once)
  loadValidators(new Set(bootstrapValidators));
  saveValidators();

  return { height: GLOBALS.CHAIN.length, tip: GLOBALS.CHAIN[GLOBALS.CHAIN.length-1].hash };
}
function persistChain() {
  saveChain(GLOBALS.FILES.chain, GLOBALS.CHAIN);
  saveSeenOps();
}

// ---------- op verification ----------
const { verifySignature, getPublicKeyHex } = require('./crypto');
function verifyOp(op) {
  try {
    if (!op || !op.type || !op.id || !op.sig || !op.authorId || !op.authorPubPEM || !op.ts) return false;
    const idHex = getPublicKeyHex(require('crypto').createPublicKey(op.authorPubPEM));
    if (idHex !== op.authorId) return false;
    let payload;
    if (op.type === 'TWEET') payload = enc({ type:'TWEET', text: op.text, authorPubPEM: op.authorPubPEM, ts: op.ts, fee: op.fee||0 });
    else if (op.type === 'COMMENT') payload = enc({ type:'COMMENT', ref: op.ref, text: op.text, authorPubPEM: op.authorPubPEM, ts: op.ts, fee: op.fee||0 });
    else if (op.type === 'GOV_PROPOSE') payload = enc({ type:'GOV_PROPOSE', pid: op.pid, payload: op.payload, authorPubPEM: op.authorPubPEM, ts: op.ts });
    else if (op.type === 'GOV_VOTE')     payload = null; // diverifikasi saat tally (butuh candidateHash)
    else return false;
    if (op.type !== 'GOV_VOTE') {
      const ok = verifySignature(op.authorPubPEM, payload, op.sig);
      return ok && sha256(payload) === op.id;
    }
    return true;
  } catch { return false; }
}

function countDaily(chain, day) {
  const m = new Map();
  for (const b of chain) {
    if (dayKey(b.timestamp) !== day) continue;
    for (const o of (b.ops||[])) {
      if (!isChat(o)) continue;
      m.set(o.authorId, (m.get(o.authorId)||0)+1);
    }
  }
  return m;
}
function wouldExceedDailyLimit(chain, block, limit=DAILY_CHAT_LIMIT) {
  const day = dayKey(block.timestamp);
  const counts = countDaily(chain, day);
  const added = new Map();
  for (const o of (block.ops||[])) {
    if (!isChat(o)) continue;
    const id = o.authorId;
    const next = (counts.get(id)||0) + (added.get(id)||0) + 1;
    if (next > limit) return true;
    added.set(id, (added.get(id)||0)+1);
  }
  return false;
}

// ---------- validation with reason ----------
function validateBlockAgainst(chainRef, block) {
  const prev = chainRef[block.index-1];

  // structure
  if (typeof block.index!=='number' || typeof block.timestamp!=='number' || typeof block.difficulty!=='number' || !Array.isArray(block.ops) || typeof block.nonce!=='number') {
    return { ok:false, reason:REASONS.STRUCT_INVALID };
  }

  if (block.index===0) {
    const same = enc(block)===enc(GLOBALS.GENESIS_BLOCK);
    return { ok:same, reason: same? null : REASONS.STRUCT_INVALID };
  }

  // linkage
  if (!prev || block.prevHash !== prev.hash) return { ok:false, reason:REASONS.PREV_MISMATCH };

  // timestamp sanity
  const drift = Math.abs(now() - block.timestamp);
  if (drift > MAX_CLOCK_DRIFT) return { ok:false, reason:REASONS.TIMESTAMP_DRIFT };
  if (block.timestamp < prev.timestamp) return { ok:false, reason:REASONS.TIMESTAMP_BACKWARD };

  // ops count
  if (block.ops.length===0 || block.ops.length>MAX_BLOCK_OPS) return { ok:false, reason:REASONS.OPS_EMPTY_OR_TOO_MANY };

  // signatures & duplicates
  for (const op of block.ops) {
    if (!verifyOp(op)) return { ok:false, reason:REASONS.OP_SIG_INVALID };
    if (GLOBALS.SEEN_OPS.has(op.id)) return { ok:false, reason:REASONS.OP_DUPLICATE };
  }

  // daily quota
  if (wouldExceedDailyLimit(chainRef, block)) return { ok:false, reason:REASONS.QUOTA_EXCEEDED };

  // PoW target: on-chain override or config default
  const targetBits = GLOBALS.PARAMS.difficultyBits || DIFFICULTY_BITS;
  const calcHash = blockHash(block);
  if (block.hash !== calcHash || !meetsPow(block.hash, targetBits)) return { ok:false, reason:REASONS.POW_INVALID };

  // opsRoot
  if (blockHeaderForHash(block).opsRoot !== merkleRoot(block.ops)) return { ok:false, reason:REASONS.OPSROOT_MISMATCH };

  // governance apply (lazy: after accepted → apply side-effects)
  return { ok:true, reason:null };
}

// ---------- append / mine / fork ----------
function totalDifficulty(chain){ return chain.reduce((a,b)=> a+(b.difficulty||0), 0); }
function pickBetterChain(a,b){
  const ta=totalDifficulty(a), tb=totalDifficulty(b);
  if (ta !== tb) return ta>tb ? a : b;
  if (a.length !== b.length) return a.length>b.length ? a : b;
  const ha=a[a.length-1].hash, hb=b[b.length-1].hash;
  return ha.localeCompare(hb)<=0? a:b;
}

function addBlockFromPeer(block) {
  const v = validateBlockAgainst(GLOBALS.CHAIN, block);
  if (!v.ok) return { ok:false, reason:v.reason };
  GLOBALS.CHAIN.push(block);
  for (const o of block.ops) if (o.id) GLOBALS.SEEN_OPS.add(o.id);
  persistChain();
  // governance application (if any)
  const proposals = block.ops.filter(o=>o.type==='GOV_PROPOSE');
  const votes     = block.ops.filter(o=>o.type==='GOV_VOTE');
  if (proposals.length || votes.length) applyGovernance(proposals, votes, block.hash);
  return { ok:true };
}

function mineBlock({ ops, difficultyBits }) {
  const last = GLOBALS.CHAIN[GLOBALS.CHAIN.length-1];
  const b = {
    index: last.index+1, prevHash:last.hash, timestamp: now(),
    difficulty: difficultyBits, ops, nonce:0
  };
  while (true) {
    b.hash = blockHash(b);
    if (meetsPow(b.hash, b.difficulty)) break;
    b.nonce++;
    if (b.nonce % 200000 === 0) b.timestamp = now();
  }
  const v = validateBlockAgainst(GLOBALS.CHAIN, b);
  if (!v.ok) throw new Error(`mined block invalid: ${v.reason}`);
  GLOBALS.CHAIN.push(b);
  for (const o of ops) if (o.id) GLOBALS.SEEN_OPS.add(o.id);
  persistChain();
  const proposals = ops.filter(o=>o.type==='GOV_PROPOSE');
  const votes     = ops.filter(o=>o.type==='GOV_VOTE');
  if (proposals.length || votes.length) applyGovernance(proposals, votes, b.hash);
  return b;
}

// ---------- state view (TTL) ----------
function rebuildState(chain, { activeOnly=true }={}){
  const tweets = new Map();
  const commentsByRef = new Map();
  const nowTs = now();
  for (const b of chain) {
    if (activeOnly && (nowTs - b.timestamp) > TWEET_TTL_MS) continue;
    for (const o of (b.ops||[])) if (o.type==='TWEET') tweets.set(o.id, o);
  }
  for (const b of chain) {
    if (activeOnly && (nowTs - b.timestamp) > TWEET_TTL_MS) continue;
    for (const o of (b.ops||[])) if (o.type==='COMMENT') {
      if (!tweets.has(o.ref)) continue;
      const arr = commentsByRef.get(o.ref)||[]; arr.push(o); commentsByRef.set(o.ref, arr);
    }
  }
  for (const [k,arr] of commentsByRef) arr.sort((a,b)=>a.ts-b.ts);
  const timeline = Array.from(tweets.values()).sort((a,b)=>b.ts-a.ts);
  return { tweets, commentsByRef, timeline };
}

module.exports = {
  initChain, persistChain,
  rebuildState, addBlockFromPeer, mineBlock, pickBetterChain,
  blockHash, merkleRoot, validateBlockAgainst,
  verifyOp,
  GLOBALS
};
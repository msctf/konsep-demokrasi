// governance.js
// On-chain parameter & validator management via voting (≥ 2/3)
const { enc, sha256, verifySignature, getPublicKeyHex } = require('./crypto');
const { GLOBALS, saveParams, saveValidators } = require('./state');

const GOV = {
  // proposal types
  PARAMS_SET: 'PARAMS_SET',      // { key, value }
  VALIDATOR_ADD: 'VALIDATOR_ADD',// { id, pubPEM }
  VALIDATOR_DEL: 'VALIDATOR_DEL' // { id }
};

// A proposal is a special OP: { type:'GOV_PROPOSE', pid, payload, authorId, sig, ... }
// Votes are OPs: { type:'GOV_VOTE', pid, voter, pubPEM, sig }
// Proposal accepted if >= 2/3 of current validators sign the same pid payload.

function verifyProposal(op) {
  if (op.type !== 'GOV_PROPOSE') return false;
  if (!op.pid || !op.payload || !op.authorPubPEM || !op.sig) return false;
  const payload = enc({ type:'GOV_PROPOSE', pid: op.pid, payload: op.payload, authorPubPEM: op.authorPubPEM, ts: op.ts });
  if (!verifySignature(op.authorPubPEM, payload, op.sig)) return false;
  const id = getPublicKeyHex(require('crypto').createPublicKey(op.authorPubPEM));
  return id === op.authorId && sha256(payload) === op.id;
}

function verifyVote(op, candidateHash) {
  if (op.type !== 'GOV_VOTE') return false;
  const payload = enc({ pid: op.pid, candidateHash }); // vote commits to block candidate hash
  return verifySignature(op.pubPEM, payload, op.sig) && getPublicKeyHex(require('crypto').createPublicKey(op.pubPEM)) === op.voter;
}

function tallyVotes(votes, validators) {
  const uniq = new Set();
  for (const v of votes) {
    if (!validators.has(v.voter)) continue;
    uniq.add(v.voter);
  }
  return uniq.size;
}

function threshold(validators) {
  const n = validators.size;
  return Math.floor((2*n)/3) + 1; // ≥ 2/3 + 1
}

function applyGovernance(proposals, votes, candidateHash) {
  // Build vote map pid -> votes[]
  const byPid = new Map();
  for (const v of votes) {
    if (!verifyVote(v, candidateHash)) continue;
    const arr = byPid.get(v.pid) || []; arr.push(v); byPid.set(v.pid, arr);
  }
  for (const p of proposals) {
    if (!verifyProposal(p)) continue;
    const vs = byPid.get(p.pid) || [];
    const ok = tallyVotes(vs, GLOBALS.VALIDATORS) >= threshold(GLOBALS.VALIDATORS);
    if (!ok) continue;
    // Apply payload
    if (p.payload && p.payload.kind === GOV.PARAMS_SET) {
      const { key, value } = p.payload;
      GLOBALS.PARAMS[key] = value;
      saveParams();
      console.log(`[governance] PARAMS_SET ${key}=${value}`);
    } else if (p.payload && p.payload.kind === GOV.VALIDATOR_ADD) {
      const { id } = p.payload;
      GLOBALS.VALIDATORS.add(id);
      saveValidators();
      console.log(`[governance] VALIDATOR_ADD ${id}`);
    } else if (p.payload && p.payload.kind === GOV.VALIDATOR_DEL) {
      const { id } = p.payload;
      GLOBALS.VALIDATORS.delete(id);
      saveValidators();
      console.log(`[governance] VALIDATOR_DEL ${id}`);
    }
  }
}

module.exports = { GOV, verifyProposal, verifyVote, applyGovernance, threshold };
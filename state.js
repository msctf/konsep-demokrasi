// state.js
// State bersama (in-memory) + loader/saver untuk seenOps, params, validators
const path = require('path');
const { atomicWriteJSON, safeReadJSON, ensureDir } = require('./storage');

let GLOBALS = {
  CHAIN: [],
  GENESIS_BLOCK: null,
  NODE_ID: null,
  SEEN_OPS: new Set(),
  PARAMS: { // on-chain modifiable params
    difficultyBits: null, // null: gunakan config default
  },
  VALIDATORS: new Set(),  // validator IDs (on-chain)
  FILES: {
    chain: null,
    seenOps: null,
    params: null,
    validators: null,
  }
};

function initFiles(dataDir, genesisHash) {
  ensureDir(dataDir);
  GLOBALS.FILES.chain = path.join(dataDir, `chain-${genesisHash}.json`);
  GLOBALS.FILES.seenOps = path.join(dataDir, `seen-${genesisHash}.json`);
  GLOBALS.FILES.params  = path.join(dataDir, `params-${genesisHash}.json`);
  GLOBALS.FILES.validators = path.join(dataDir, `validators-${genesisHash}.json`);
}

function loadSeenOps() {
  const arr = safeReadJSON(GLOBALS.FILES.seenOps, []);
  GLOBALS.SEEN_OPS = new Set(arr);
}
function saveSeenOps() {
  atomicWriteJSON(GLOBALS.FILES.seenOps, Array.from(GLOBALS.SEEN_OPS));
}

function loadParams(defaults) {
  const obj = safeReadJSON(GLOBALS.FILES.params, defaults || {});
  GLOBALS.PARAMS = { ...defaults, ...obj };
}
function saveParams() {
  atomicWriteJSON(GLOBALS.FILES.params, GLOBALS.PARAMS);
}

function loadValidators(initial) {
  const arr = safeReadJSON(GLOBALS.FILES.validators, initial ? Array.from(initial) : []);
  GLOBALS.VALIDATORS = new Set(arr);
}
function saveValidators() {
  atomicWriteJSON(GLOBALS.FILES.validators, Array.from(GLOBALS.VALIDATORS));
}

module.exports = {
  GLOBALS,
  initFiles,
  loadSeenOps, saveSeenOps,
  loadParams, saveParams,
  loadValidators, saveValidators
};
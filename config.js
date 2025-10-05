// config.js
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(kv => {
  const [k, ...rest] = kv.replace(/^--/, '').split('=');
  return [k, rest.join('=') === '' ? true : rest.join('=')];
}));

function flagBool(name, def=false){ return args[name] === undefined ? def : !!args[name]; }
function flagNum(name, def){ const v = Number(args[name]); return Number.isFinite(v) ? v : def; }
function flagStr(name, def){ const v = args[name]; return v === undefined ? def : String(v); }

const PORT             = flagNum('port', 9001);
const HOST             = flagStr('host', '0.0.0.0');
const GENESIS_NAME     = flagStr('genesis', 'p2p-tweet-pro');
const BOOTSTRAPS       = (flagStr('peers', '') || '').split(',').filter(Boolean);
const CLIENT_ONLY      = flagBool('client-only', false);

// PoW & block sizing
const DIFFICULTY_BITS  = flagNum('difficulty', 18);         // demo default
const MAX_BLOCK_OPS    = flagNum('max_ops', 2000);
const MAX_CLOCK_DRIFT  = flagNum('max_drift_ms', 10*60*1000); // ±10m

// P2P hardening
const MAX_MSG_BYTES    = flagNum('max_msg', 256*1024);
const RATE_WINDOW_MS   = flagNum('rate_window_ms', 10*1000);
const RATE_MAX_MSGS    = flagNum('rate_max', 80);
const BAN_SCORE_LIMIT  = flagNum('ban_score', 100);

// Mempool
const MEMPOOL_MAX      = flagNum('mempool_max', 10000);
const MEMPOOL_MINFEE   = flagNum('min_fee', 1);      // pseudo-credit minimal per op
const MEMPOOL_EVICT    = flagNum('mempool_evict', 500);

// App rules
const DAILY_CHAT_LIMIT = flagNum('daily_limit', 5000);
const TWEET_TTL_MS     = flagNum('ttl_ms', 24*60*60*1000);

// Data dir
const dataDir          = path.join(process.cwd(), '.p2ptweet');

module.exports = {
  args, PORT, HOST, GENESIS_NAME, BOOTSTRAPS, CLIENT_ONLY,
  DIFFICULTY_BITS, MAX_BLOCK_OPS, MAX_CLOCK_DRIFT,
  MAX_MSG_BYTES, RATE_WINDOW_MS, RATE_MAX_MSGS, BAN_SCORE_LIMIT,
  MEMPOOL_MAX, MEMPOOL_MINFEE, MEMPOOL_EVICT,
  DAILY_CHAT_LIMIT, TWEET_TTL_MS,
  dataDir
};
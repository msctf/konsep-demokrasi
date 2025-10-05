// rules.js
// Satu tempat buat aturan & alasan penolakan (reasoned validation)
const {
  DAILY_CHAT_LIMIT, TWEET_TTL_MS, MAX_BLOCK_OPS, MAX_CLOCK_DRIFT
} = require('./config');

const RULES = {
  TTL_MS: TWEET_TTL_MS,
  DAILY_LIMIT: DAILY_CHAT_LIMIT,
  MAX_OPS_PER_BLOCK: MAX_BLOCK_OPS,
  MAX_CLOCK_DRIFT_MS: MAX_CLOCK_DRIFT,
  TS_MIN_INCREASE: true, // timestamp blok harus >= prev
  REQUIRE_SIG_TWEET: true,
  REQUIRE_SIG_COMMENT: true,
  REQUIRE_POW_ALL_BLOCKS: true,
  REJECT_DUP_OP: true,
};

const REASONS = {
  STRUCT_INVALID: 'invalid_block_structure',
  PREV_MISMATCH: 'prev_hash_mismatch_or_height_gap',
  TIMESTAMP_DRIFT: 'timestamp_drift_exceeded',
  TIMESTAMP_BACKWARD: 'timestamp_backwards',
  OPS_EMPTY_OR_TOO_MANY: 'ops_empty_or_exceeds_max',
  OP_SIG_INVALID: 'op_signature_invalid',
  OP_DUPLICATE: 'op_duplicate',
  QUOTA_EXCEEDED: 'daily_chat_quota_exceeded',
  POW_INVALID: 'pow_invalid',
  OPSROOT_MISMATCH: 'ops_merkle_root_mismatch',
  GOVERNANCE_INVALID: 'governance_invalid',
};

module.exports = { RULES, REASONS };
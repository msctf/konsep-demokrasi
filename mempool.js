// mempool.js
const { MEMPOOL_MAX, MEMPOOL_MINFEE, MEMPOOL_EVICT } = require('./config');

// TX/op: {id, type, fee, ts, authorId, ...}
class Mempool {
  constructor() {
    this.map = new Map(); // id -> op
    this.order = [];      // LRU-ish: id
  }
  add(op) {
    if (!op || !op.id) return false;
    if (this.map.has(op.id)) return false;
    const fee = Number(op.fee || 0);
    if (!Number.isFinite(fee) || fee < MEMPOOL_MINFEE) return false;
    this.map.set(op.id, op);
    this.order.push(op.id);
    if (this.map.size > MEMPOOL_MAX) this.evict();
    return true;
  }
  evict() {
    // Evict the worst fee first (simple heuristic)
    const entries = [...this.map.values()];
    entries.sort((a,b)=> (a.fee||0) - (b.fee||0));
    const n = Math.min(MEMPOOL_EVICT, entries.length);
    for (let i=0;i<n;i++) {
      const id = entries[i].id;
      this.map.delete(id);
      const idx = this.order.indexOf(id);
      if (idx>=0) this.order.splice(idx,1);
    }
  }
  has(id) { return this.map.has(id); }
  removeMany(ops) { for (const op of ops) { this.map.delete(op.id); const i=this.order.indexOf(op.id); if(i>=0)this.order.splice(i,1);} }
  size(){ return this.map.size; }

  pick(max) {
    // Pick by highest fee (priority)
    const arr = [...this.map.values()];
    arr.sort((a,b)=> (b.fee||0) - (a.fee||0) || a.ts - b.ts);
    if (arr.length > max) arr.length = max;
    return arr;
  }
}

module.exports = { Mempool };
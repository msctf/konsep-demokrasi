// storage.js
const fs = require('fs');

function atomicWriteJSON(filePath, obj) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function safeReadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const s = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(s);
  } catch { return fallback; }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
}

module.exports = { atomicWriteJSON, safeReadJSON, ensureDir };
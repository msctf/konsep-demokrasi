// crypto.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const enc   = (o) => JSON.stringify(o);
const dec   = (s) => JSON.parse(s);
const now   = () => Date.now();
const sha256= (buf)=> crypto.createHash('sha256').update(buf).digest('hex');
const short = (s,n=12)=> (s && s.length>n)? s.slice(0,n) : s;

function getPublicKeyHex(pubKey) {
  const spkiDer = pubKey.export({ type: 'spki', format: 'der' });
  return sha256(spkiDer);
}
function sign(privateKey, payload) {
  const sig = crypto.sign(null, Buffer.from(payload), privateKey); // Ed25519
  return sig.toString('hex');
}
function verifySignature(pubPEM, payload, sigHex) {
  try {
    const pubKey = crypto.createPublicKey(pubPEM);
    return crypto.verify(null, Buffer.from(payload), pubKey, Buffer.from(sigHex, 'hex'));
  } catch { return false; }
}

function loadOrCreateKeypair(dataDir) {
  const keyPath = path.join(dataDir, 'keypair.json');
  if (fs.existsSync(keyPath)) {
    const { publicKeyPEM, privateKeyPEM } = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    const publicKey  = crypto.createPublicKey(publicKeyPEM);
    const privateKey = crypto.createPrivateKey(privateKeyPEM);
    return { publicKey, privateKey, id:getPublicKeyHex(publicKey), publicKeyPEM, privateKeyPEM };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPEM  = publicKey.export({ type:'spki',  format:'pem' });
  const privateKeyPEM = privateKey.export({ type:'pkcs8', format:'pem' });
  fs.writeFileSync(keyPath, JSON.stringify({ publicKeyPEM, privateKeyPEM }, null, 2));
  return { publicKey, privateKey, id:getPublicKeyHex(publicKey), publicKeyPEM, privateKeyPEM };
}

module.exports = {
  enc, dec, now, sha256, short,
  getPublicKeyHex, sign, verifySignature, loadOrCreateKeypair
};
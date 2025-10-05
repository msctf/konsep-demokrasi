
# P2P-Tweet (Prototype)

> **Freedom tech demo:** a tiny, experimental P2P microblog showing how decentralized, pseudonymous speech can work.  
> **Status:** prototype — **no moderation, no filters, no guarantees**. Use responsibly.

---

## Table of Contents
1. [What is this?](#what-is-this)
2. [Quick Start](#quick-start)
3. [Commands & Workflow](#commands--workflow)
4. [Make Tweets Visible (Fast)](#make-tweets-visible-fast)
5. [Anonymity Guide (Practical)](#anonymity-guide-practical)
6. [Security & Privacy Best Practices](#security--privacy-best-practices)
7. [Multi-Node & Governance Notes](#multi-node--governance-notes)
8. [Warnings & Mental-Health Advisory](#warnings--mental-health-advisory)
9. [Development Roadmap](#development-roadmap)
10. [License](#license)

---

## What is this?

This repo is an **educational proof-of-concept** for a P2P microblog:

- **P2P over TCP** (works behind NAT with `--client-only`).
- **Pseudonymous identities** (Ed25519 keys; tweets/comments are signed).
- **Consensus:** minimal **Proof-of-Work** per block; fork choice = **total difficulty**.
- **Anti-abuse primitives:** mempool with fees, daily per-author quota (default 5k/day), duplicate-op guard.
- **TTL view:** timeline shows “active” posts ≤ 24h (trial feeling of ephemerality).
- **Governance (prototype):** on-chain proposals/votes to change some params.

> This is **not** production software. It’s a sandbox to explore freedom-of-expression mechanics.

---

## Quick Start

**Requirements:** Node.js 16+.

```bash
# Clone your repo then run:
node index.js --port=9001 --genesis="demo-net" --difficulty=16
```

Common flags:

- `--port=<port>` (default: `9001`)
- `--host=<ip>` (default: `0.0.0.0`)
- `--genesis="<name>"` → network ID (must match peers)
- `--difficulty=<bits>` → PoW difficulty (lower = easier for dev/demo)
- `--peers=host:port,host2:port2` → bootstrap peers
- `--client-only` → no inbound listen (good behind NAT / for privacy)
- `--auto-mine` → optional auto miner (dev only; see README)

**Tip for demo:** use `--difficulty=14..16` to mine quickly on a laptop/VPS.

---

## Commands & Workflow (REPL)

You’ll see a REPL prompt `>` when the node starts.

**Core commands**
```
help
myid
peers
connect <host:port>

tweet <text> [fee]
comment <tweetId|prefix> <text> [fee]
txpool
mine [nOps]

show [tweetId|prefix]       # active (≤ 24h)
show-all [tweetId|prefix]   # archive, no TTL

height
tip
export

# governance (prototype)
propose-param <key> <value>
propose-val-add <validatorIdHex>
propose-val-del <validatorIdHex>
vote <pid> <candidateTipHash>
```

**Lifecycle**
1) `tweet "hello world" 10` → goes to **mempool**  
2) `mine` → gets included on-chain in a block  
3) `show` → now visible (within TTL window)

Use `comment <prefix> "text"` to reply using a tweet’s **id prefix** (the first ~10–12 hex chars).

---

## Make Tweets Visible (Fast)

Tweets enter **mempool** first. They appear in `show` **only after mined**.

**Option A — Manual (simplest)**
```
> tweet "mscjs" 1
> mine
> show
• mscjs (id:..., by:..., <time>)
```

**Option B — Auto-mine (dev)**
Run with:
```bash
node index.js --difficulty=16 --auto-mine
```
The node will check mempool every few seconds and mine automatically (development convenience only).

**Troubleshooting**
- `txpool` > 0 → not yet mined. Run `mine` (or enable auto-mine).
- Using multi-node? Make sure `--genesis` matches and you’re connected to peers.
- `show` hides posts older than 24h. Use `show-all` for the archive.

---

## Anonymity Guide (Practical)

> There is *no magic switch* for anonymity. You can, however, reduce tracking surface a lot.

### A. Use client-only mode (no inbound)
```bash
node index.js --client-only --peers=<relay-ip>:9001 --genesis="demo-net"
```
This prevents your node from accepting inbound connections and advertising your IP/port.

### B. Route all traffic through Tor (recommended)
Install Tor and run your node through `torsocks` or a system Tor SOCKS proxy:

```bash
torsocks node index.js --client-only --peers=<relay-onion-or-ip>:9001 --genesis="demo-net"
```

If you use a SOCKS proxy (Tor or VPN), ensure `torsocks` or environment variables are configured so Node’s TCP connects go through Tor. Using Tor will hide your IP from other peers, but remember: Tor exit/entry nodes add latency and may require additional configuration on the other side.

### C. Use a VPN you control / anonymous VPS as relay
- Host relay VPS nodes you control (paid anonymously if necessary).  
- Point your client node to those relays. The VPS sees your IP only if you connect directly; if you route your node over Tor, VPS sees only Tor exit.

### D. Encrypt / protect your private key on disk
By default the node writes `~/.p2ptweet/keypair.json` in plain. Encrypt it with a passphrase:

1. Use an OS key manager or encrypt the file with `gpg` or `openssl`:
   ```bash
   # encrypt
   openssl enc -aes-256-gcm -pbkdf2 -iter 100000 -salt -in keypair.json -out keypair.json.enc
   # decrypt before run (or add runtime decryption)
   ```
2. Or set up the code to prompt for `--passphrase` and decrypt on startup (recommended for production).

**Important:** If your VPS gets compromised and keypair is present, your node identity and past signatures are exposed.

### E. Remove identifiable metadata
- Don’t register personal domains or DNS names connected to the node.  
- Avoid tweeting personal information. The protocol replicates content to peers.

### F. Reduce fingerprinting surface
- Use the same genesis for your intended network only.  
- Avoid running other unusual services from the same IP that could link your identities.

### G. Understand limitations
- Even with Tor/VPN + client-only + encrypted keys: metadata patterns (timing, content fingerprints, local system compromise) can de-anonymize you. This is *defense in depth*, not a guarantee.

---

## Security & Privacy Best Practices

- Use a **fresh keypair** per persona; don’t reuse keys across projects.
- Encrypt key files, keep OS up-to-date, harden SSH, disable password logins.
- Treat logs, snapshots, and exports as sensitive (they can reveal timing/content).
- Prefer **client-only** if you don’t need to be a public relay.
- For production-like privacy, add transport encryption (TLS/Noise/libp2p-TLS).

---

## Multi-Node & Governance Notes

- All nodes in a network **must share the same `--genesis`** string. Different genesis = different network.
- `--peers` should include at least one public relay if some nodes are behind NAT.  
- Governance in this prototype can propose on-chain parameters (e.g., `difficultyBits`). Parameter changes require proposal + validators' votes (≥2/3).  
- If you want production-like stability, coordinate a controlled set of validators and a schedule for parameter changes. Don’t change consensus-critical flags on a single node or you’ll fork yourself off the network.

---

## Warnings & Mental-Health Advisory

**This software is a prototype. It does not moderate or filter content.** That means:

- People can publish *any* text — including abuse, hate, violent imagery/text, sexual content, or content meant to harass.  
- Exposure to toxic content can be harmful. If you feel distressed by something you see, take a break, step away, and seek help. Talk to someone you trust; consider professional support if you feel overwhelmed.

**Legal / ethical responsibility:** Running an open relay or allowing illegal content may have legal consequences depending on your jurisdiction. You are responsible for what your node stores and relays.

**Mental-health note (plain):** If reading posts causes you severe distress, stop, disconnect, and reach out to supportive people or mental health professionals in your area. If you are in immediate danger, contact local emergency services.

---

## Development Roadmap

- Transport encryption (Noise/TLS or libp2p).
- Encrypted key storage & `--passphrase` unlock.
- Snapshot / fast-sync; LevelDB/RocksDB storage.
- Parameter scheduling (activate at height) on-chain.
- Nonce-per-author + gas/weight limits for ops.
- Optional moderation plugins (opt-in, community-run).
- Observability (metrics endpoint), tests, CI.

**Contributions welcome**: open issues/PRs with clear descriptions and small, reviewable patches.

---

## License

MIT (or your preferred permissive license).  
**No warranty**. Use at your own risk.

---

### One-liner demo

```bash
# local demo with auto-mining and low difficulty
node index.js --genesis="demo-net" --difficulty=14 --auto-mine
# in the REPL:
> tweet "experimenting with freedom" 10
> show
```

Stay safe. Be kind. Enjoy the freedom — and handle it responsibly.

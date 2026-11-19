# BCH Blaze Hub — PUSD CashTokens Bridge, Paytaca BCH <-> Nostr DID & FoldingCash Merkle Covenant Suite

[![CashScript](https://img.shields.io/badge/CashScript-0.14.0-0ac18e?style=flat-square)](https://cashscript.org)
[![Tests](https://img.shields.io/badge/BCH%20VM%20Tests-100%25%20Passing-brightgreen?style=flat-square)](#running-tests)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)

**Hackathon:** [BCH BLAZE 2026](https://dorahacks.io/hackathon/bchblaze2026/detail) (`$8,000+` Prize Pool — Paid in `PUSD`, `BCH`, `CashTokens`)  
**Presentation (Widget Factory Structure):** [`SLIDES.pdf`](./SLIDES.pdf)  
**EMBER2026 Community Choice CashTokens Address:** `bitcoincash:zqau9rtdjtvsw0a4uwklfqtet6h5g67wa5psj4rk4g`

---

## Tracks & Bounties Targeted

| Track / Bounty | Contract / Module | Verification |
|---|---|---|
| **Mainnet Track (`$3,500 PUSD`)** | Full-stack CashTokens Covenant Suite + Mainnet BIP-21 / WizardConnect WC2 Tx Builder | Compiled with `cashc 0.14.0` + Live Web UI |
| **Stablecoin Bridge (`$750 PUSD`)** | [`contracts/PusdBridgeVault.cash`](./contracts/PusdBridgeVault.cash) (`138` opcodes) | Atomic HTLC + `OP_CHECKDATASIG` Oracle Attestation + Vault Covenant Continuation + Timelock Refund |
| **Paytaca Decentralised Identity (`$500 PUSD`)** | [`contracts/NostrDidBinder.cash`](./contracts/NostrDidBinder.cash) (`54` opcodes) + [`src/crypto.mjs`](./src/crypto.mjs) | Bidirectional **Bitcoin Cash &harr; Nostr** cryptographic binding (BIP-340 NIP-01 kind `30078` + BCH `OP_CHECKDATASIG` + immutable 32-byte CashTokens NFT commitment) |
| **FoldingCash Reward Claims (`26M FLDCH` / `0.5 BCH`)** | [`contracts/MerkleRewardVault.cash`](./contracts/MerkleRewardVault.cash) (`169` opcodes) | Pull-based 3-level SHA-256 Merkle proof verification + covenant pool preservation |
| **Build With XO (`0.3 BCH`)** | [`xo/pusd-bridge-template.xo.json`](./xo/pusd-bridge-template.xo.json) | Validated XO template schema linked to all 3 compiled artifacts for `blaze.xo.cash` |

---

## Architecture & Security Invariants

1. **`PusdBridgeVault.cash` (`138` BCH Script Opcodes):**
   - **Parameter-Bound Oracle Attestation:** `checkDataSig(oracleDataSig, htlcHash + recipientPkh + toPaddedBytes(bridgeAmount, 8) + toPaddedBytes(transferNonce, 8), bridgeOraclePk)` prevents amount inflation, recipient substitution, or replay.
   - **Atomic HTLC Settlement:** `sha256(htlcSecret) == htlcHash`.
   - **Paytaca DID Gate:** Input 1 must carry an immutable 32-byte Nostr-bound DID NFT from `didIssuerCategory`.
   - **Covenant Continuity:** Partial withdrawals automatically enforce that `remainingPusd = vaultPusdBalance - bridgeAmount` returns to `tx.inputs[this.activeInputIndex].lockingBytecode`.
   - **Non-Custodial Escape Hatch:** `reclaimExpired(guardianSig)` unlocks after `tx.time >= refundLocktime`.

2. **`NostrDidBinder.cash` (`54` BCH Script Opcodes):**
   - Links a user's Bitcoin Cash `secp256k1` keypair and Nostr BIP-340 `npub1...` keypair with mutual signatures:
     - **Nostr &rarr; BCH:** Signed NIP-01 `kind: 30078` event referencing the BCH CashTokens address & compressed pubkey.
     - **BCH &rarr; Nostr:** BCH `OP_CHECKDATASIG` over `(nostrXOnlyPubkey || nip01EventHash)`, minting an **immutable** 32-byte CashTokens NFT (`capability: none`, rejecting `mutable` NFTs).

3. **`MerkleRewardVault.cash` (`169` BCH Script Opcodes):**
   - Computes `sha256(recipientPkh + toPaddedBytes(rewardAmount, 8))` and verifies a 3-level SHA-256 Merkle path against the constructor-locked `merkleRoot`, releasing exact `FLDCH` CashTokens to Output 0 while returning remaining liquidity to Output 1.

---

## Quick Start & Verification

```bash
# 1. Install dependencies (cashc 0.14.0, cashscript 0.14.0, @bitauth/libauth, @noble/curves)
npm install

# 2. Compile all 3 CashScript contracts to artifacts/*.json
npm run compile

# 3. Run full Bitcoin Cash VM + API integration test suite
npm test

# 4. Launch live interactive dashboard & CashScript VM API server
npm run serve
# Open http://127.0.0.1:8097
```

## License

MIT License — Open Source for the Bitcoin Cash ecosystem.

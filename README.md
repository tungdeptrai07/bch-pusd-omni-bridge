# BCH Blaze Hub — PUSD CashTokens Bridge, Paytaca DID & SolidCash Covenant Suite

**Hackathon:** BCH BLAZE 2026 ($8,000 Prize Pool + 6 Bounties)  
**Smart Contract:** [`contracts/PusdBridgeVault.cash`](contracts/PusdBridgeVault.cash) (CashScript ^0.10.0)

## Bounties Addressed
1. **Stablecoin Bridge (`750 PUSD` — Bounty #1382)**: Uses native CashTokens introspection (`tx.inputs[this.activeInputIndex].tokenCategory`) and SHA-256 HTLC commitments to bridge ParyonUSD (`PUSD`) trustlessly.
2. **Decentralised Identity (`500 PUSD` — Paytaca Bounty #1385)**: Enforces on-chain DID verification via immutable CashTokens NFT commitments (`tx.inputs[1].nftCommitment`).
3. **XO & SolidCash Integration (`Bounties #1383/#1386`)**: Compatible with Bitcoin Cash UTXO wallet covenants.

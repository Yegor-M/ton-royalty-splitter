# Royalty Splitter Merkle (TON)

A minimal, gas-efficient **pull-based royalty distribution contract** for the TON blockchain.  
Funds are streamed into the contract (e.g., marketplace fees, protocol revenue), and then split between:

- **Creator** — receives a fixed percentage (e.g., 50%) on epoch finalization  
- **Holders** — claim their share using **Merkle proofs** for each epoch

This design ensures scalable distribution to hundreds or thousands of holders **without iterating on-chain**.

---

## ✦ Key Features

### Pull-based distribution  
Holders claim their rewards individually using Merkle proofs.  
No loops, no gas spikes.

### Epoch-based payouts  
Each epoch defines:
- `epochId`
- `merkleRoot`
- `perShare` (calculated on-chain)
- a clean claimed dictionary

### Configurable economics  
Percentage for creator payouts is set via `CREATOR_BPS`  
(default: `5000` = 50%).

### Merkle-verified claiming  
Only addresses belonging to the epoch’s Merkle tree can claim.

### Gas-efficient & safe
- Storage minimized  
- No external dependencies  
- Protection against double-claim and invalid proofs  

---

## ✦ How It Works

### Funding
Anyone (typically a treasury wallet or platform) can send TON to the contract.  
These funds accumulate until the owner initiates a new epoch.

### Finalizing an Epoch
Only the owner can call:

```text
set_epoch(epochId, totalHolders, merkleRoot)

The contract:

Calculates the pool = balance – keepAlive

Splits pool using CREATOR_BPS

Sends creator’s share immediately

Computes perShare for holders

Resets claimed dictionary

Claiming by Holders

Holders call:

claim(index, proofCell)


Merkle proof is validated on-chain

Holder receives perShare

Claim is permanently recorded in a compact dictionary

✦ Security Model

All proof verification is deterministic and stateless

Double-claiming is prevented via a persistent bit dictionary

Contract keeps a keepAlive reserve to remain deployable long-term

All mutation happens only inside epoch boundaries

✦ Repository Structure
contracts/
  royalty-splitter-merkle.fc      # FunC smart contract

wrappers/
  RoyaltySplitterMerkle.ts        # TypeScript contract wrapper

tests/
  royaltySplitterMerkle.spec.ts   # End-to-end multi-epoch test suite

utils/
  merkle.ts                       # Merkle tree builder (off-chain)

✦ Development

Install dependencies:

npm install


Run all tests:

npm test


Rebuild contract:

npx blueprint build

✦ Testing Approach

The test suite includes:

Single-epoch distribution

Multi-epoch (100 epochs × 100 holders) simulation

Merkle proof verification

Gas accounting and economic summary

Double-claim protection

It models realistic marketplace revenue flows using an external treasury wallet.

✦ License

MIT — use freely in commercial and open-source projects.

TON Royalty Splitter

Gas-aware royalty treasurer + tooling for TON NFT collections.
It collects marketplace royalties into a treasury contract and distributes them to current NFT holders in deterministic “epochs,” with off-chain indexer + scripts to generate holder snapshots and trigger on-chain payouts in chunks.

What’s inside

contracts/royalty-collector.fc – FunC contract that:

accepts marketplace royalty transfers (empty body or text comment),

tracks epochs and per-share math,

distributes to holders via batched internal sends,

supports owner ops (set_creator, set_params, batch, get_state).

Wrappers – TypeScript wrappers for deployment, interaction, and tests.

Indexer – scripts/index-nft-owners.ts builds owner snapshots from a collection (testnet/mainnet).

Batch runner – scripts/distribute-from-json.ts reads a snapshot JSON and triggers batch calls.

Blueprint – Dev UX for compiling/deploying with TonConnect.

Tests – Sandbox tests for:

deploy + single/two-chunk distributions,

marketplace-style royalty deposits (empty body / text comment),

state invariants after distribution.

Quick start
Requirements

Node.js LTS, Yarn or npm

ton, @ton/core, @ton/sandbox, @ton/blueprint

Install
yarn
# or
npm i

Build the contract
yarn build
# blueprint build => writes build/royalty-collector.compiled.json

Run tests
yarn test

Deploy (testnet with TonConnect)
yarn blueprint run --testnet --tonconnect
# choose: deployRoyaltyCollector


The deploy script opens TonConnect, you confirm in your wallet, and deployment completes.

How it works (high level)

Royalties in
Marketplaces send TON to the RoyaltyCollector—the contract accepts payments with empty body or a plain text comment.

Snapshot holders off-chain
Use scripts/index-nft-owners.ts to crawl a collection and produce a snapshot (JSON) of current owners.
Snapshots include a timestamp and network tag in the filename to track “when” you paid.

Distribute in chunks
Call batch(epoch, start, end, owners_cell) multiple times, each with a small page of addresses (3–5 per cell is safe).
On each call the contract sends pro-rata payouts until the epoch is drained.

Indexing owners

Create a .env with your TonCenter API keys:

TONCENTER_MAINNET=https://toncenter.com/api/v2/jsonRPC
TONCENTER_MAINNET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TONCENTER_TESTNET=https://testnet.toncenter.com/api/v2/jsonRPC
TONCENTER_TESTNET_KEY=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy


Run the indexer:

# testnet or mainnet; snapshot name will include chain + timestamp
npx ts-node scripts/index-nft-owners.ts <collection_address> 0 100 --out owners.json --chain testnet


Output example:

{
  "collection": "EQ...xyz",
  "total": 12,
  "start": 0,
  "count": 12,
  "owners": [
    { "index": 0, "address": "EQ...." },
    { "index": 1, "address": "EQ...." }
  ]
}


The script writes snapshots/<chain>.<timestamp>.owners.json.

Distribute from JSON

Fund the RoyaltyCollector, then:

yarn blueprint run --testnet --tonconnect
# choose: distribute-from-json
# select the snapshot file when prompted OR pass --file path


The script:

loads the snapshot,

builds an owners cell page,

invokes batch for the given epoch and index range,

repeats until the epoch is complete.

Gas & scaling notes

A single cell fits ~3–5 addresses safely. Use multiple batch calls:

100 NFTs ⇒ ~30–35 calls

1000 NFTs ⇒ paginated over time (or multiple senders)

Keep a treasury keepAlive buffer to avoid underflows.

Tests assert that the contract tolerates both empty body and text comment royalty payments.

Scripts

scripts/deployRoyaltyCollector.ts – deploy collector via TonConnect.

scripts/distribute-from-json.ts – run batched distribution from a snapshot.

scripts/index-nft-owners.ts – build owner snapshots (testnet/mainnet).

Testing matrix

tests/royaltyCollector.spec.ts
Deploy + distribute in one/two chunks; balance deltas & state invariants.

tests/royaltyCollector.fromOwners.spec.ts
Distribute from JSON-style owners cell.

tests/royaltyCollector.royaltyIn.spec.ts
Accept royalty deposits (empty/comment) then distribute.

Run:

yarn test

Environment
# .env (for scripts)
TONCENTER_MAINNET=
TONCENTER_MAINNET_KEY=
TONCENTER_TESTNET=
TONCENTER_TESTNET_KEY=

Roadmap

Merkle snapshot pages (proof-based) to lower calldata.

On-chain index paging helper (optional).

Gas benchmarking & adaptive per-page sizing.

UI for uploading snapshots and triggering epochs.

Watcher to auto-start distribution when royalties arrive.

License

MIT. Use at your own risk; mainnet values require careful paging and gas budgeting.
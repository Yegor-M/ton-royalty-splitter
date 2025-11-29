// scripts/index-nft-owners.ts
// Usage:
//   npx ts-node scripts/index-nft-owners.ts <collection> [start=0] [count=100] --chain mainnet|testnet --out-dir snapshots
//
// Env (optional):
//   TON_API_KEY_MAINNET
//   TON_API_KEY_TESTNET
//
// Output file:
//   owners.<chain>.<COLL_SHORT>.<YYYYMMDD-HHMMSS>.json

import { Address, TupleReader } from '@ton/core';
import { TonClient4 } from '@ton/ton';
import * as fs from 'fs';
import * as path from 'path';

type Chain = 'mainnet' | 'testnet';

type OwnersRow = {
  index: number;
  address: string; // base64 user-friendly
};

type Snapshot = {
  collection: string;
  chain: Chain;
  snapshotAt: string;   // ISO timestamp
  blockSeqno?: number;
  total: number;
  start: number;
  count: number;
  owners: OwnersRow[];
};

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function shortAddr(a: string) {
  // For filename friendliness
  return a.slice(0, 8);
}

function tsStamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${Y}${M}${D}-${h}${m}${s}`;
}

function clientFor(chain: Chain) {
  const endpoint =
    chain === 'mainnet'
      ? 'https://mainnet-v4.tonhubapi.com'
      : 'https://testnet-v4.tonhubapi.com';
  // TonClient4 here doesn’t need an API key for these endpoints
  return new TonClient4({ endpoint });
}

async function runMethodTR(
  client: TonClient4,
  addr: Address,
  method: string,
  stack: any[]
) {
  const r = await client.runMethod(addr, method, stack);
  // TonClient4 returns { exitCode, result: TupleItem[], reader: TupleReader ... }
  // Some versions expose .reader, some don’t — create one ourselves:
  const tr = new TupleReader(r.result);
  return { exitCode: r.exitCode, tr };
}

async function getCollectionData(
  client: TonClient4,
  collection: Address
): Promise<{ nextItemIndex: bigint }> {
  const { exitCode, tr } = await runMethodTR(client, collection, 'get_collection_data', []);
  if (exitCode !== 0) throw new Error(`get_collection_data exitCode=${exitCode}`);
  // (int next_item_index, cell collection_content, slice owner_address)
  const next = tr.readBigNumber();
  // skip content, owner
  tr.readCell();
  tr.readAddress();
  return { nextItemIndex: next };
}

async function getNftAddressByIndex(
  client: TonClient4,
  collection: Address,
  index: bigint
): Promise<Address> {
  const { exitCode, tr } = await runMethodTR(client, collection, 'get_nft_address_by_index', [
    { type: 'int', value: index }
  ]);
  if (exitCode !== 0) throw new Error(`get_nft_address_by_index(${index}) exitCode=${exitCode}`);
  // returns (slice nft_item_address)
  return tr.readAddress();
}

async function getNftOwner(
  client: TonClient4,
  item: Address
): Promise<Address | null> {
  const { exitCode, tr } = await runMethodTR(client, item, 'get_nft_data', []);
  if (exitCode !== 0) throw new Error(`get_nft_data exitCode=${exitCode}`);
  // (init?, index, collection, owner?, content)
  tr.readNumber();       // inited (0/1)
  tr.readBigNumber();    // index
  tr.readAddress();      // collection
  const owner = tr.readAddressOpt(); // can be null
  // ignore content
  return owner;
}

async function main() {
  const collectionStr = process.argv[2];
  if (!collectionStr) {
    console.error('Usage: npx ts-node scripts/index-nft-owners.ts <collection> [start=0] [count=100] --chain mainnet|testnet --out-dir snapshots');
    process.exit(1);
  }

  const start = Number(process.argv[3] ?? '0');
  const count = Number(process.argv[4] ?? '100');
  const chain: Chain = (arg('chain', 'mainnet') as Chain);
  const outDir = arg('out-dir', 'snapshots');

  const client = clientFor(chain);
  const collection = Address.parse(collectionStr);

  // Try block info (best effort)
  let blockSeqno: number | undefined = undefined;
  try {
    const last = await client.getLastBlock();
    blockSeqno = last.last.seqno;
  } catch {
    // ignore
  }

  const meta = await getCollectionData(client, collection);
  const total = Number(meta.nextItemIndex); // count of minted items (0..total-1)

  const owners: OwnersRow[] = [];
  const end = Math.min(start + count, total);

  console.log(`Collection: ${collectionStr}`);
  console.log(`Chain: ${chain}`);
  console.log(`Total items: ${total}`);
  console.log(`Range: [${start}..${end - 1}]`);

  for (let i = start; i < end; i++) {
    const idx = BigInt(i);
    try {
      const itemAddr = await getNftAddressByIndex(client, collection, idx);
      const owner = await getNftOwner(client, itemAddr);
      if (owner) {
        owners.push({
          index: i,
          address: owner.toString()
        });
        console.log(`Index ${i}: ${owner.toString({ testOnly: true })}`);
      } else {
        console.log(`Index ${i}: owner = null`);
      }
    } catch (e: any) {
      console.log(`Index ${i}: error ${e?.message ?? e}`);
    }
  }

  const snapshot: Snapshot = {
    collection: collectionStr,
    chain,
    snapshotAt: new Date().toISOString(),
    blockSeqno,
    total,
    start,
    count: end - start,
    owners
  };

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(
    outDir,
    `owners.${chain}.${shortAddr(collectionStr)}.${tsStamp()}.json`
  );
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote ${owners.length} rows -> ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

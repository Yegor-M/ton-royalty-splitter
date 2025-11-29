// scripts/distribute-from-json.ts
// Usage:
//   npx blueprint run scripts/distribute-from-json.ts -- \
//     --json snapshots/owners.mainnet.EQBBCU....20251128-123456.json \
//     --epoch 1 --chunk 3 --value 0.2 --rc EQxxxx... (or RC_ADDRESS env)
//
// Notes:
// - Run against the correct network provider (testnet/mainnet) so it matches the snapshot’s chain.

import { beginCell, Address, toNano, Cell } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import * as fs from 'fs';
import { RoyaltyCollector } from '../wrappers/RoyaltyCollector';

type Snapshot = {
  collection: string;
  chain: 'mainnet' | 'testnet';
  snapshotAt: string;
  blockSeqno?: number;
  total: number;
  start: number;
  count: number;
  owners: { index: number; address: string }[];
};

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function u16(n: number) {
  if (n < 0 || n > 0xffff) throw new Error('count out of uint16');
  return n;
}

function buildOwnersCell(addrs: Address[]): Cell {
  let b = beginCell().storeUint(u16(addrs.length), 16);
  for (const a of addrs) b = b.storeAddress(a);
  return b.endCell();
}

export async function run(provider: NetworkProvider) {
  const jsonPath = arg('json');
  if (!jsonPath) throw new Error('--json <path> is required');

  const epoch = Number(arg('epoch', '1'));
  const CHUNK_SIZE = Number(arg('chunk', '3'));
  const gasPerBatch = toNano(arg('value', '0.2')!);
  const rcAddressStr = process.env.RC_ADDRESS || arg('rc', undefined);
  if (!rcAddressStr) throw new Error('Provide RoyaltyCollector address via RC_ADDRESS or --rc');

  const snapshot: Snapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // Optional sanity log
  provider.ui().write(
    `Snapshot: chain=${snapshot.chain}, collection=${snapshot.collection}, at=${snapshot.snapshotAt}, items=${snapshot.total}, owners in file=${snapshot.owners.length}`
  );

  if (!Array.isArray(snapshot.owners) || snapshot.owners.length === 0) {
    provider.ui().write('No owners in snapshot, nothing to do.');
    return;
  }

  // Sort by index, must be contiguous inside each chunk
  const owners = [...snapshot.owners].sort((a, b) => a.index - b.index);

  const rc = provider.openAtAddress(RoyaltyCollector, Address.parse(rcAddressStr));

  let sent = 0;
  for (let i = 0; i < owners.length; i += CHUNK_SIZE) {
    const chunk = owners.slice(i, i + CHUNK_SIZE);
    const startIdx = chunk[0].index;
    const endIdx = chunk[chunk.length - 1].index + 1;

    // Verify contiguous
    for (let k = 1; k < chunk.length; k++) {
      if (chunk[k].index !== chunk[k - 1].index + 1) {
        throw new Error(`Non-contiguous indices in chunk starting at ${startIdx}`);
      }
    }

    const addrList = chunk.map(c => Address.parse(c.address));
    const ownersCell = buildOwnersCell(addrList);

    provider.ui().write(
      `Batch: epoch=${epoch}, [${startIdx}..${endIdx}) addrs=${addrList.length}, gas=${gasPerBatch.toString()}`
    );
    await rc.sendBatch(provider.sender(), epoch, startIdx, endIdx, ownersCell, gasPerBatch);

    sent += addrList.length;
  }

  provider.ui().write(`Done. Batches sent: ${Math.ceil(owners.length / CHUNK_SIZE)}, recipients: ${sent}`);
}

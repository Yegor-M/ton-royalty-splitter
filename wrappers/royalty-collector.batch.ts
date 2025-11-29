// wrappers/royalty-collector.batch.ts
// Usage (testnet/mainnet via blueprint networks):
//   RC_ADDRESS=EQC...  RC_EPOCH=1  RC_BATCH=3  RC_VALUE=0.2  blueprint run wrappers/royalty-collector.batch.ts
//   (optionally) OWNERS=owners.json  or  OWNERS_BOC=owners.pages.boc

import { Address, beginCell, Cell, toNano } from '@ton/core';
import { type NetworkProvider } from '@ton/blueprint';
import * as fs from 'fs';

// Minimal wrapper (adjust to match your RoyaltyCollector wrapper methods)
import { RoyaltyCollector } from '../wrappers/RoyaltyCollector';

type OwnersJson = { owners: { address: string; count: number }[] };

function loadOwners(): Address[] {
  const jsonPath = process.env.OWNERS;
  const bocPath = process.env.OWNERS_BOC;

  if (bocPath) {
    const pages = Cell.fromBoc(fs.readFileSync(bocPath));
    const out: Address[] = [];
    for (const c of pages) {
      const s = c.beginParse();
      const n = s.loadUint(16);
      for (let i = 0; i < n; i++) out.push(s.loadAddress());
    }
    return out;
  }

  const path = jsonPath ?? 'owners.json';
  const data = JSON.parse(fs.readFileSync(path, 'utf8')) as OwnersJson;
  const flat: Address[] = [];
  for (const row of data.owners) {
    for (let i = 0; i < row.count; i++) flat.push(Address.parse(row.address));
  }
  return flat;
}

export async function run(provider: NetworkProvider) {
  const addr = Address.parse(process.env.RC_ADDRESS!);
  const rc = provider.openContract(RoyaltyCollector.fromAddress(addr));
  const epoch = Number(process.env.RC_EPOCH ?? '1');
  const perCall = Number(process.env.RC_BATCH ?? '3');
  const value = toNano(process.env.RC_VALUE ?? '0.2'); // attach to each batch call

  const owners = loadOwners();
  if (owners.length === 0) {
    provider.ui().write('No owners found.');
    return;
  }

  provider.ui().write(`Payout epoch=${epoch}, owners=${owners.length}, perCall=${perCall}`);

  for (let i = 0; i < owners.length; i += perCall) {
    const chunk = owners.slice(i, i + perCall);
    let b = beginCell().storeUint(chunk.length, 16);
    for (const a of chunk) b = b.storeAddress(a);
    const page = b.endCell();

    // NOTE: use contiguous "global" indices [i .. i + chunk.length)
    await rc.sendBatch(provider.sender(), epoch, i, i + chunk.length, page, value);
    provider.ui().write(`✔ sent batch [${i}..${i + chunk.length - 1}]`);
  }

  const s = await rc.getState();
  provider.ui().write(`Done. lastEpoch=${s.lastEpoch} curEpoch=${s.curEpoch} remaining=${s.remaining}`);
}

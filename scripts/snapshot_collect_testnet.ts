// scripts/snapshot-collect.ts

import { Address } from '@ton/core';
import * as fs from 'fs';
import * as path from 'path';

// Node 18+ уже имеет global fetch; если что, можно подтянуть node-fetch
// import fetch from 'node-fetch';

type TonapiNftItem = {
  address: string;
  index: number;
  owner?: {
    address: string;
    is_scam?: boolean;
    is_wallet?: boolean;
  };
};

type TonapiResponse = {
  nft_items: TonapiNftItem[];
};

type SnapshotHolder = {
  index: number;
  owner: string;
  nft: string;
};

type SnapshotFile = {
  label: string;
  createdAt: string;
  collectionRaw: string;
  collectionFriendly: string;
  total: number;
  holders: SnapshotHolder[];
};

function normalizeCollectionAddress(input: string): string {
  const s = input.trim();

  // Уже raw вида "0:...." или "-1:..."
  if (s.includes(':') && !s.includes('%')) {
    return s;
  }

  // Уже URL-encoded "0%3A..."
  if (s.includes('%')) {
    return decodeURIComponent(s);
  }

  // Иначе считаем, что это friendly (EQ..., UQ...)
  const addr = Address.parse(s);
  // toRawString() даёт "0:...."
  return addr.toRawString();
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

async function main() {
  const collectionArg = process.argv[2];

  if (!collectionArg) {
    console.error('Usage: ts-node scripts/snapshot-collect.ts <collectionAddress> [label]');
    console.error('Example: ts-node scripts/snapshot-collect.ts EQB...  snapshot_2025-01-04-23-00');
    process.exit(1);
  }

  const labelArg = process.argv[3];

  const collectionRaw = normalizeCollectionAddress(collectionArg);
  const collectionFriendly = Address.parse(collectionRaw).toString();
  const label =
    labelArg ??
    `item-owners-snapshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  const encoded = encodeURIComponent(collectionRaw);
  const url = `https://testnet.tonapi.io/v2/nfts/collections/${encoded}/items?limit=1000&offset=0`;

  console.log('Fetching holders from:', url);
  console.log('Collection raw      :', collectionRaw);
  console.log('Collection friendly :', collectionFriendly);
  console.log('Snapshot label      :', label);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!res.ok) {
    console.error('Tonapi error:', res.status, await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as TonapiResponse;
  const items = (data.nft_items ?? [])

  const holders: SnapshotHolder[] = items.filter((it) => it.owner && it.owner.address)
    .map((it) => ({
      index: it.index,
      owner: it.owner!.address,
      nft: it.address,
    }));

  console.log(`Found ${holders.length} NFT items with owners.`);

  const snapshot: SnapshotFile = {
    label,
    createdAt: new Date().toISOString(),
    collectionRaw,
    collectionFriendly,
    total: holders.length,
    holders,
  };

  const outDir = path.resolve('snapshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }

  const fileName = sanitizeLabel(label) + '.json';
  const outPath = path.join(outDir, fileName);

  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log('Snapshot saved to:', outPath);
}

main().catch((err) => {
  console.error('Snapshot script failed:', err);
  process.exit(1);
});

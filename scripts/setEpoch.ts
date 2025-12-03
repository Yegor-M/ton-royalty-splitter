// scripts/setEpoch.ts

import { NetworkProvider } from '@ton/blueprint';
import { Address, fromNano, Cell } from '@ton/core';
import * as fs from 'fs';
import * as path from 'path';
import { RoyaltySplitterMerkle } from '../wrappers/RoyaltySplitterMerkle';
import { buildMerkle } from './merkle';

type SnapshotHolder = {
  index: number;
  owner: string;          // raw 0:... или friendly — парсим через Address.parse
  nft: string;
  ownerFriendly?: string;
};

type SnapshotFile = {
  label?: string;
  createdAt: string;
  collectionRaw: string;
  collectionFriendly: string;
  total: number;
  holders: SnapshotHolder[];
};

type EpochClaimHolder = {
  index: number;
  owner: string;   // friendly
  nft: string;
  proof: string[]; // массив хексов "0x..."
};

type EpochClaimFile = {
  epochId: number;
  epoch_file?: string;
  createdAt: string;
  collectionRaw: string;
  collectionFriendly: string;
  splitter: string; // friendly-адрес сплиттера
  total: number;
  holders: EpochClaimHolder[];
};
function extractProofHex(proof: unknown): string[] {
  // Вариант 1: массив bigints/чисел
  if (Array.isArray(proof)) {
    return (proof as any[]).map(p => '0x' + BigInt(p).toString(16));
  }

  // Вариант 2: цепочка Cell
  if (proof instanceof Cell) {
    const result: string[] = [];
    let cur: Cell | null = proof;

    while (cur) {
      const s = cur.beginParse();

      // Если в ячейке нет 256 бит — считаем, что proof закончился (или пустой)
      if (s.remainingBits < 256) {
        break;
      }

      const sib = s.loadUint(256);
      result.push('0x' + sib.toString(16));

      if (s.remainingRefs > 0) {
        cur = s.loadRef();
      } else {
        cur = null;
      }
    }

    return result;
  }

  throw new Error('Unsupported proof format in buildMerkle / extractProofHex');
}

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();

  ui.write('=== RoyaltySplitterMerkle :: set_epoch ===');

  // 1) Адрес сплиттера (friendly, как у тебя в mainnet/testnet)
  const splitterFriendly = 'kQDbyrYQK8JRM6eVPrrlK_Lg4U97IgL0IuigFqytk-HMzL01';
  const splitterAddress = Address.parse(splitterFriendly.trim());
  const splitter = provider.open(
    RoyaltySplitterMerkle.createFromAddress(splitterAddress),
  );

  // 2) Текущий стейт
  const state = await splitter.getState();

  ui.write('=== Current RoyaltySplitterMerkle state ===');
  ui.write(`epochId      : ${state.epochId}`);
  ui.write(`keepAlive    : ${fromNano(state.keepAlive)} TON`);
  ui.write(`minPayout    : ${fromNano(state.minPayout)} TON`);
  ui.write(`perShare     : ${fromNano(state.perShare)} TON`);
  ui.write(`claimedCount : ${state.claimedCount}`);
  ui.write(`rootHash     : 0x${state.rootHash.toString(16)}`);
  ui.write('');

  // 3) Путь к снапшоту с холдерами (из snapshot_collect.ts)
  const snapshotPathInput =
    './snapshots/item-owners-snapshot-2025-12-02T20-48-14.json';
  const snapshotPath = path.resolve(snapshotPathInput.trim());

  if (!fs.existsSync(snapshotPath)) {
    ui.write(`File not found: ${snapshotPath}`);
    return;
  }

  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  const snap: SnapshotFile = JSON.parse(raw);

  ui.write('=== Loaded snapshot ===');
  ui.write(`label      : ${snap.label ?? '(no label)'}`);
  ui.write(`createdAt  : ${snap.createdAt}`);
  ui.write(`collection : ${snap.collectionFriendly} (${snap.collectionRaw})`);
  ui.write(`total      : ${snap.total}`);
  ui.write('');

  if (snap.holders.length !== snap.total) {
    ui.write(
      `WARNING: holders.length (${snap.holders.length}) != total (${snap.total})`,
    );
  }

  // 4) Строим Merkle по холдерам
  const leaves = snap.holders.map(h => ({
    index: h.index,
    owner: Address.parse(h.ownerFriendly ?? h.owner),
  }));

  const { rootHash, proofs } = buildMerkle(leaves);

  ui.write('=== Computed Merkle root ===');
  ui.write(`rootHash (dec) : ${rootHash.toString()}`);
  ui.write(`rootHash (hex) : 0x${rootHash.toString(16)}`);
  ui.write('');

  // 5) epochId — по умолчанию следующий
  const suggestedEpoch = state.epochId + 1;
  ui.write(
    `Current epochId: ${state.epochId}, suggested next epochId: ${suggestedEpoch}`,
  );

  // Можно сделать интерактив, а можно просто взять suggestedEpoch:
  // const epochStr = await ui.input(`Enter epochId [${suggestedEpoch}]: `);
  // const epochId = epochStr.trim() === '' ? suggestedEpoch : Number(epochStr.trim());
  const epochId = suggestedEpoch;
  const total = snap.total;

  ui.write('=== set_epoch params ===');
  ui.write(`epochId  : ${epochId}`);
  ui.write(`total    : ${total}`);
  ui.write(`rootHash : 0x${rootHash.toString(16)}`);
  ui.write('');

  // 6) Готовим epoch_claim_<epochId>.json для TMA/бэка

  const claimFile: EpochClaimFile = {
    epochId,
    epoch_file: snap.label,
    createdAt: new Date().toISOString(),
    collectionRaw: snap.collectionRaw,
    collectionFriendly: snap.collectionFriendly,
    splitter: splitter.address.toString(),
    total,
    holders: snap.holders.map((h, i) => ({
      index: h.index,
      owner: Address.parse(h.ownerFriendly ?? h.owner).toString(),
      nft: h.nft,
      proof: extractProofHex((proofs as any)[i]),   // ← вот тут магия
    })),
  };

  const epochsDir = path.resolve('./epochs');
  if (!fs.existsSync(epochsDir)) {
    fs.mkdirSync(epochsDir);
  }

  const claimPath = path.join(epochsDir, `epoch_claim_${epochId}.json`);
  fs.writeFileSync(claimPath, JSON.stringify(claimFile, null, 2), 'utf-8');

  ui.write(`Saved epoch claim file: ${claimPath}`);
  ui.write('');

  // 7) Подтверждение на отправку set_epoch

  const ownerSender = provider.sender();
  ui.write(`Using sender (owner wallet): ${ownerSender.address!.toString()}`);
  ui.write('');

  const confirm = await ui.input('Type "yes" to send set_epoch: ');
  if (confirm.trim().toLowerCase() !== 'yes') {
    ui.write('Aborted.');
    return;
  }

  await splitter.sendSetEpoch(ownerSender, {
    epochId,
    total,
    rootHash,
  });

  ui.write('set_epoch message sent.');
  ui.write('');
}

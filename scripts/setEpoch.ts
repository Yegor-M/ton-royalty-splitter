// scripts/setEpoch.ts

import { NetworkProvider } from '@ton/blueprint';
import { Address, fromNano } from '@ton/core';
import * as fs from 'fs';
import * as path from 'path';
import { RoyaltySplitterMerkle } from '../wrappers/RoyaltySplitterMerkle';
import snapshot from '../snapshots/item-owners-snapshot-2025-12-02T20-48-14.json';
import { buildMerkle } from './merkle'; 

type EpochSnapshot = {
  epochId: number;
  label?: string;
  total: number;
  rootHash: string; // "0x..." or decimal string
  // holders / proofs можем игнорить для set_epoch
};

function parseRootHash(str: string): bigint {
  const s = str.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) {
    return BigInt(s);
  }
  return BigInt(s);
}

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();

  ui.write('=== RoyaltySplitterMerkle :: set_epoch ===');

  // адрес контракта
  const addrStr = "kQDbyrYQK8JRM6eVPrrlK_Lg4U97IgL0IuigFqytk-HMzL01";
  const splitterAddress = Address.parse(addrStr.trim());
  const splitter = provider.open(RoyaltySplitterMerkle.createFromAddress(splitterAddress));

  const state = await splitter.getState();

  ui.write('=== Current RoyaltySplitterMerkle state ===');
  ui.write(`epochId      : ${state.epochId}`);
  ui.write(`keepAlive    : ${fromNano(state.keepAlive)} TON`);
  ui.write(`minPayout    : ${fromNano(state.minPayout)} TON`);
  ui.write(`perShare     : ${fromNano(state.perShare)} TON`);
  ui.write(`claimedCount : ${state.claimedCount}`);
  ui.write(`rootHash     : 0x${state.rootHash.toString(16)}`);
  ui.write('');


  // путь до снапшота
  const snapshotPathInput = "./snapshots/item-owners-snapshot-2025-12-02T20-48-14.json";// = await ui.input(
  //   'Path to epoch snapshot JSON (e.g. ./snapshots/epoch_1.json): ',
  // );
  const snapshotPath = path.resolve(snapshotPathInput.trim());

  if (!fs.existsSync(snapshotPath)) {
    ui.write(`File not found: ${snapshotPath}`);
    return;
  }

  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  const snap: EpochSnapshot = JSON.parse(raw);
  console.log(raw);

  const epochId = snap.epochId;
  const total = snap.total;
  const leaves = snapshot.holders.map((h: any) => ({
    index: h.index,
    owner: Address.parse(h.ownerFriendly ?? h.owner),
  }));
  
  const { rootHash } = buildMerkle(leaves);

  ui.write(`Loaded snapshot: ${snap.label ?? '(no label)'}`);
  ui.write(`epochId = ${epochId}`);
  ui.write(`total   = ${total}`);
  ui.write(`rootHash = ${rootHash.toString(16)} (hex)`);

  const ownerSender = provider.sender();
  ui.write(`Using sender (owner wallet): ${ownerSender.address!.toString()}`);

  const confirm = await ui.input('Type "yes" to send set_epoch: ');
  if (confirm.trim().toLowerCase() !== 'yes') {
    ui.write('Aborted.');
    return;
  }

  // Аналогично, как и в deploy:
  // если wrapper с auto-injected provider через provider.open(...),
  // достаточно передать только sender и args.
  await splitter.sendSetEpoch(ownerSender, {
    epochId,
    total,
    rootHash,
  });

  ui.write('set_epoch message sent.');

  // можно глянуть состояние после
  const state_ = await splitter.getState();
  ui.write('State after set_epoch:');
  ui.write(
    JSON.stringify(
      {
        epochId: state_.epochId,
        keepAlive: state_.keepAlive.toString(),
        minPayout: state_.minPayout.toString(),
        perShare: state_.perShare.toString(),
        claimedCount: state_.claimedCount,
        rootHash: state_.rootHash.toString(16),
      },
      null,
      2,
    ),
  );
}

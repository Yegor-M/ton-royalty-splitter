// scripts/setEpoch.ts

import { NetworkProvider } from '@ton/blueprint';
import { Address, fromNano } from '@ton/core';
import { RoyaltySplitterMerkle } from '../wrappers/RoyaltySplitterMerkle';

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();

  ui.write('=== RoyaltySplitterMerkle :: set_epoch ===');

  // адрес контракта
  const addrStr = "kQDbyrYQK8JRM6eVPrrlK_Lg4U97IgL0IuigFqytk-HMzL01"; // TESTNET
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
}

// scripts/deployRoyaltySplitter.ts

import { compile, NetworkProvider } from '@ton/blueprint';
import { Address, fromNano, toNano } from '@ton/core';
import {
  RoyaltySplitterMerkle,
  royaltySplitterConfigToCell,
  RoyaltySplitterConfig,
} from '../wrappers/RoyaltySplitterMerkle';

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();

  ui.write('=== RoyaltySplitterMerkle :: deploy ===');

  const keepAlive = toNano('1');
  const minPayout = toNano('0.15');


  const ownerSender = provider.sender();
  const creatorInput = await ui.input(
    'Creator address (leave empty to use owner address): ',
  );
  const creator =
    creatorInput && creatorInput.trim().length > 0
      ? Address.parse(creatorInput.trim())
      : ownerSender.address;

  const config: RoyaltySplitterConfig = {
    owner: ownerSender.address!,
    creator: creator!,
    keepAlive: keepAlive,
    minPayout: minPayout,
  };

  const code = await compile('royalty-splitter-merkle');
  const splitter = provider.open(RoyaltySplitterMerkle.createFromConfig(config, code));

  const toTon  = (x: bigint) => Number(fromNano(x));

  ui.write(`Owner   : ${ownerSender.address!.toString()}`);
  ui.write(`Creator : ${creator!.toString()}`);
  ui.write(`KeepAlive : ${keepAlive.toString()} nanoTON ~ ${toTon(keepAlive)} TON`);
  ui.write(`MinPayout: ${minPayout.toString()} nanoTON ~ ${toTon(minPayout)} TON`);
  ui.write(`Planned contract address: ${splitter.address.toString()}`);

  const confirm = await ui.input('Type "yes" to deploy: ');
  if (confirm.trim().toLowerCase() !== 'yes') {
    ui.write('Aborted.');
    return;
  }

  // IMPORTANT:
  // В зависимости от версии wrapper'а:
  // 1) Если методы вида sendDeploy(via: Sender, value?: bigint) — вызываем так:
  //    await splitter.sendDeploy(ownerSender, toNano('0.3'));
  // 2) Если sendDeploy(provider: ContractProvider, via: Sender, value?: bigint) —
  //    при использовании provider.open(...) первый аргумент (provider) подставится автоматически.
  // В твоём случае, раз тесты работают с sandbox через openContract, должно быть достаточно:
  await splitter.sendDeploy(ownerSender, toNano('0.3'));

  await provider.waitForDeploy(splitter.address);

  ui.write('Deployed successfully!');
  ui.write(`Splitter address: ${splitter.address.toString()}`);
}

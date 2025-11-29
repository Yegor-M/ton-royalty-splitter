// tests/royaltyCollector.fromOwners.spec.ts
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, beginCell, fromNano, toNano } from '@ton/core';
import { RoyaltyCollector } from '../wrappers/RoyaltyCollector';
import { hex } from '../build/royalty-collector.compiled.json';

// ВАЖНО: текущий формат контракта = все адреса в ОДНОМ cell (без refs).
// Чтобы не ловить BitBuilder overflow, держим ≤ 3 адресов.
function ownersCellAll(addresses: { address: Address }[]) {
  if (addresses.length > 3) {
    throw new Error(`ownersCellAll(): current single-cell format supports up to 3 addresses, got ${addresses.length}`);
  }
  let b = beginCell().storeUint(addresses.length, 16);
  for (const a of addresses) b = b.storeAddress(a.address);
  return b.endCell();
}

async function readBalances(chain: Blockchain, ws: SandboxContract<TreasuryContract>[]) {
  const states = await Promise.all(ws.map(w => chain.getContract(w.address)));
  return states.map(s => s.balance as bigint);
}

function printBalances(
  label: string,
  holders: SandboxContract<TreasuryContract>[],
  balances: bigint[],
  baseline?: bigint[]
) {
  console.log(`\n=== ${label} ===`);
  balances.forEach((b, i) => {
    const delta = baseline ? b - (baseline[i] ?? 0n) : undefined;
    const parts = [
      `#${i}`,
      holders[i].address.toString({ testOnly: true }),
      fromNano(b),
      baseline ? `Δ ${delta! >= 0n ? '+' : ''}${fromNano(delta!)}` : ''
    ].filter(Boolean);
    console.log(parts.join(' | '));
  });
}

describe('RoyaltyCollector (from owners list)', () => {
  it('distributes to all holders in one batch', async () => {
    const chain = await Blockchain.create();

    const owner   = await chain.treasury('owner');
    const creator = await chain.treasury('creator');

    // Ровно 3 держателя — гарантировано помещаются в один cell
    const holders: SandboxContract<TreasuryContract>[] = [];
    for (let i = 0; i < 3; i++) holders.push(await chain.treasury('h' + i));

    const code = Cell.fromBoc(Buffer.from(hex, 'hex'))[0];
    const keepAlive = toNano('0.1');
    const minPayout = toNano('0.01');

    const initData = beginCell()
      .storeAddress(owner.address)
      .storeAddress(creator.address)
      .storeCoins(keepAlive)
      .storeCoins(minPayout)
      .storeUint(0, 32) // lastEpoch
      .storeUint(0, 32) // curEpoch
      .storeUint(0, 1)  // epochStarted
      .storeCoins(0)    // epochPerItemShare
      .storeCoins(0)    // epochRemaining
      .endCell();

    const collector = chain.openContract(RoyaltyCollector.createFromCode(code, initData));

    // DEPLOY
    await collector.sendDeploy(owner.getSender(), toNano('0.3'));
    const postDeploy = await chain.getContract(collector.address);
    const stateType = postDeploy.accountState?.type ?? 'none';
    expect(stateType).toBe('active');

    // FUND POOL — чтобы было с чего платить
    await owner.send({ to: collector.address, value: toNano('100') });

    // BALANCES BEFORE
    const creatorBefore = (await chain.getContract(creator.address)).balance;
    const holdersBefore = await readBalances(chain, holders);
    printBalances('Holders BEFORE', holders, holdersBefore);
    console.log('\n=== Creator BEFORE ===', fromNano(creatorBefore));

    // Один батч (все адреса в ОДНОМ cell)
    const ownersRef = ownersCellAll(holders);
    // epoch = 1, индексы 0..3 (end=3 — как “последняя позиция” по текущей сигнатуре)
    await collector.sendBatch(owner.getSender(), 1, 0, 3, ownersRef, toNano('0.2'));

    // BALANCES AFTER
    const creatorAfter = (await chain.getContract(creator.address)).balance;
    const holdersAfter = await readBalances(chain, holders);
    printBalances('Holders AFTER (one-batch)', holders, holdersAfter, holdersBefore);
    console.log('\n=== Creator AFTER ===', fromNano(creatorAfter));
    console.log('=== Creator Δ ===', fromNano(creatorAfter - creatorBefore));

    // Проверки — кто-то из держателей должен получить больше, и креатор тоже
    const totalHoldersDelta = holdersAfter.reduce((acc, v, i) => acc + (v - holdersBefore[i]), 0n);
    expect(totalHoldersDelta > 0n).toBe(true);
    expect(creatorAfter > creatorBefore).toBe(true);
  });
});

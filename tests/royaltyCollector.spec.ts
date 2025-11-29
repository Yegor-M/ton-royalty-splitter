import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, beginCell, fromNano, toNano } from '@ton/core';
import { RoyaltyCollector } from '../wrappers/RoyaltyCollector';
import { hex } from '../build/royalty-collector.compiled.json';

// helpers
function ownersCellChunk(addresses: { address: Address }[], start: number, count: number) {
  let b = beginCell().storeUint(count, 16);
  for (let i = 0; i < count; i++) b = b.storeAddress(addresses[start + i].address);
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

describe('RoyaltyCollector', () => {
  it('deploys and distributes in chunks', async () => {
    const chain = await Blockchain.create();

    const owner   = await chain.treasury('owner');
    const creator = await chain.treasury('creator');

    const holders: SandboxContract<TreasuryContract>[] = [];
    for (let i = 0; i < 5; i++) holders.push(await chain.treasury('h' + i));

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
    if (stateType !== 'active') {
      console.error('--- deploy state dump ---', {
        address: collector.address.toString({ testOnly: true }),
        stateType,
        balance: fromNano(postDeploy.balance),
      });
    }
    expect(stateType).toBe('active');

    // FUND POOL
    await owner.send({ to: collector.address, value: toNano('100') });

    // BALANCES BEFORE
    const creatorBefore = (await chain.getContract(creator.address)).balance;
    const holdersBefore = await readBalances(chain, holders);
    printBalances('Holders BEFORE', holders, holdersBefore);
    console.log('\n=== Creator BEFORE ===', fromNano(creatorBefore));

    const ownersRef1 = ownersCellChunk(holders, 0, 3);
    await collector.sendBatch(owner.getSender(), 1, 0, 3, ownersRef1, toNano('0.2'));

// EPOCH 1 — chunk B (3..4

    const s1 = await collector.getState();
    console.log('after chunk A:', s1);
    
    // chunk B has 2 addrs
    const ownersRef2 = ownersCellChunk(holders, 3, 2);
  await collector.sendBatch(owner.getSender(), 1, 3, 5, ownersRef2, toNano('0.2')); 

    const s2 = await collector.getState();
    console.log('after chunk B:', s2);

    // BALANCES AFTER
    const creatorAfter = (await chain.getContract(creator.address)).balance;
    const holdersAfter = await readBalances(chain, holders);
    printBalances('Holders AFTER', holders, holdersAfter, holdersBefore);
    console.log('\n=== Creator AFTER ===', fromNano(creatorAfter));
    console.log('=== Creator Δ ===', fromNano(creatorAfter - creatorBefore));

    expect(creatorAfter > creatorBefore).toBe(true);
    expect(holdersAfter.some((b, i) => b > holdersBefore[i])).toBe(true);
  });
});

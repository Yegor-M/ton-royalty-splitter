// import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
// import { Address, Cell, beginCell, toNano } from '@ton/core';
// import { RoyaltyCollector } from '../wrappers/RoyaltyCollector';
// import { hex } from '../build/royalty-collector.compiled.json';

// // утилиты
// async function readBalances(chain: Blockchain, ws: SandboxContract<TreasuryContract>[]) {
//   const states = await Promise.all(ws.map(w => chain.getContract(w.address)));
//   return states.map(s => s.balance as bigint);
// }
// function ownersCellAll(addresses: { address: Address }[]) {
//   let b = beginCell().storeUint(addresses.length, 16);
//   for (const a of addresses) b = b.storeAddress(a.address);
//   return b.endCell();
// }

// describe('RoyaltyCollector — marketplace royalty compatibility', () => {
//   it('accepts empty body and Text Comment without aborts, then distributes', async () => {
//     const chain = await Blockchain.create();
//     const owner = await chain.treasury('owner');
//     const market = await chain.treasury('market'); // эмуляция маркетплейса
//     const h0 = await chain.treasury('h0');
//     const h1 = await chain.treasury('h1');
//     const h2 = await chain.treasury('h2');
//     const holders = [h0, h1, h2];

//     // код и init данных
//     const code = Cell.fromBoc(Buffer.from(hex, 'hex'))[0];
//     const keepAlive = toNano('0.1');
//     const minPayout = toNano('0.01');
//     const initData = beginCell()
//       .storeAddress(owner.address)           // owner
//       .storeAddress(owner.address)           // creator (не важен для теста)
//       .storeCoins(keepAlive)                 // keepAlive
//       .storeCoins(minPayout)                 // minPayout
//       .storeUint(0, 32)                      // lastEpoch
//       .storeUint(0, 32)                      // curEpoch
//       .storeUint(0, 1)                       // epochStarted
//       .storeCoins(0)                         // epochPerItemShare
//       .storeCoins(0)                         // epochRemaining
//       .endCell();

//     const collector = chain.openContract(RoyaltyCollector.createFromCode(code, initData));

//     // деплой
//     await collector.sendDeploy(owner.getSender(), toNano('0.3'));
//     const postDeploy = await chain.getContract(collector.address);
//     expect(postDeploy.accountState?.type).toBe('active');

//     // баланс до
//     const bal0 = (await chain.getContract(collector.address)).balance;

//     // 1) пустое тело (как делают площадки при роялти)
//     await market.send({ to: collector.address, value: toNano('0.22') });
//     const bal1 = (await chain.getContract(collector.address)).balance;
//     expect(bal1 > bal0).toBe(true); // деньги зашли

//     // 2) текстовый комментарий (часто встречается)
//     await market.send({
//       to: collector.address,
//       value: toNano('0.11'),
//       body: beginCell().storeUint(0, 32).storeStringTail('Royalty payout').endCell(),
//     });
//     const bal2 = (await chain.getContract(collector.address)).balance;
//     expect(bal2 > bal1).toBe(true); // деньги зашли

//     // теперь распределение в один батч на 3 адреса
//     const holdersBefore = await readBalances(chain, holders);
//     const ownersRef = ownersCellAll(holders);

//     // epoch = 1, локальные индексы [0..3)
//     await collector.sendBatch(owner.getSender(), 1, 0, 3, ownersRef, toNano('0.2'));

//     const holdersAfter = await readBalances(chain, holders);
//     for (let i = 0; i < holders.length; i++) {
//       expect(holdersAfter[i] > holdersBefore[i]).toBe(true);
//     }

//     // состояние должно «закрыть» эпоху и не оставлять хвостов
//     const s = await collector.getState();
//     expect(s.lastEpoch).toBe(1);
//     expect(s.curEpoch).toBe(0);
//     expect(s.perShare).toBe(0n);
//     expect(s.remaining).toBe(0n);
//   });
// });

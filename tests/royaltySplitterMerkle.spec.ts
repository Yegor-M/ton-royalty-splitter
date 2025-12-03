import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, beginCell, fromNano, toNano } from '@ton/core';
import { RoyaltySplitterMerkle } from '../wrappers/RoyaltySplitterMerkle';
import { hex as codeHex } from '../build/royalty-splitter-merkle.compiled.json';

// ---------- helpers for merkle ----------

function leafHash(index: number, owner: Address): bigint {
  const c = beginCell().storeUint(index, 32).storeAddress(owner).endCell();
  return BigInt('0x' + c.hash().toString('hex'));
}

function pairHash(h1: bigint, h2: bigint): bigint {
  const lo = h1 < h2 ? h1 : h2;
  const hi = h1 < h2 ? h2 : h1;
  const c = beginCell().storeUint(lo, 256).storeUint(hi, 256).endCell();
  return BigInt('0x' + c.hash().toString('hex'));
}

function buildMerkle(leaves: { index: number; owner: Address }[]) {
  const leafHashes = leaves.map(l => leafHash(l.index, l.owner));

  let level = leafHashes.slice();
  const tree: bigint[][] = [level];

  while (level.length > 1) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(pairHash(a, b));
    }
    tree.push(next);
    level = next;
  }

  const rootHash = level[0];

  const proofs: bigint[][] = leafHashes.map((_, idx) => {
    const proof: bigint[] = [];
    let pos = idx;
    for (let depth = 0; depth < tree.length - 1; depth++) {
      const layer = tree[depth];
      const sib = pos ^ 1;
      proof.push(layer[Math.min(sib, layer.length - 1)]);
      pos = Math.floor(pos / 2);
    }
    return proof;
  });

  return { rootHash, proofs };
}

function proofToCell(proof: bigint[]): Cell {
  let cur: Cell | null = null;
  for (let i = proof.length - 1; i >= 0; i--) {
    const b = beginCell().storeUint(proof[i], 256);
    if (cur) b.storeRef(cur);
    cur = b.endCell();
  }
  return cur ?? beginCell().endCell();
}

// ---------- TEST ----------

describe('RoyaltySplitterMerkle (base)', () => {
  it('splits pool between creator and holders claim via merkle', async () => {
    const blockchain = await Blockchain.create();
    const owner = await blockchain.treasury('owner');
    const creator = await blockchain.treasury('creator');

    const treasuryAmount = 100;
    const shareRatio = 1 / 2;

    const holders: SandboxContract<TreasuryContract>[] = [];
    for (let i = 0; i < 5; i++) {
      holders.push(await blockchain.treasury('h' + i));
    }

    const code = Cell.fromBoc(Buffer.from(codeHex, 'hex'))[0];

    const config = {
      owner: owner.address,
      creator: creator.address,
      keepAlive: toNano('0.05'),
      minPayout: toNano('0.01'),
    };

    const splitter = blockchain.openContract(
      RoyaltySplitterMerkle.createFromConfig(config, code),
    );

    // deploy
    await splitter.sendDeploy(owner.getSender(), toNano('0.3'));
    console.log('Deployed splitter with address', splitter.address);

    // залили в пул 100 TON
    await owner.send({
      to: splitter.address,
      value: toNano(treasuryAmount.toString()),
    });

    const splitterBefore = (await blockchain.getContract(splitter.address)).balance;
    const creatorBefore = (await blockchain.getContract(creator.address)).balance;

    const stateBefore = await splitter.getState();
    console.log('State BEFORE setEpoch:', {
      epochId: stateBefore.epochId,
      keepAlive: stateBefore.keepAlive.toString(),
      minPayout: stateBefore.minPayout.toString(),
      perShare: stateBefore.perShare.toString(),
      rootHash: stateBefore.rootHash.toString(16),
      claimedCount: stateBefore.claimedCount,
      balance: fromNano(splitterBefore),
    });
    console.log('Creator balance BEFORE setEpoch :', fromNano(creatorBefore));

    // ожидаемый пул для холдеров (теоретический, без учёта газа контракта)
    const theoreticalHoldersPool = toNano((treasuryAmount * shareRatio).toString());
    const theoreticalEach = theoreticalHoldersPool / BigInt(holders.length);

    // собираем меркл-дерево по адресам
    const leaves = holders.map((h, i) => ({ index: i, owner: h.address }));
    const { rootHash, proofs } = buildMerkle(leaves);

    // финализируем эпоху
    await splitter.sendSetEpoch(owner.getSender(), {
      epochId: 1,
      total: holders.length,
      rootHash,
    });

    const splitterAfterEpoch = (await blockchain.getContract(splitter.address)).balance;
    const creatorAfter = (await blockchain.getContract(creator.address)).balance;

    console.log('Creator balance AFTER setEpoch :', fromNano(creatorAfter));

    const deltaCreator = creatorAfter - creatorBefore;
    console.log('Δcreator =', fromNano(deltaCreator));

    const stateAfter = await splitter.getState();
    console.log('State AFTER setEpoch:', {
      epochId: stateAfter.epochId,
      keepAlive: stateAfter.keepAlive.toString(),
      minPayout: stateAfter.minPayout.toString(),
      perShare: stateAfter.perShare.toString(),
      rootHash: stateAfter.rootHash.toString(16),
      claimedCount: stateAfter.claimedCount,
      balance: fromNano(splitterAfterEpoch),
    });

    // --- дополнительная проверка состояния после setEpoch ---

    // epochId обновился
    expect(stateAfter.epochId).toBe(1);

    // perShare > 0
    expect(stateAfter.perShare > 0n).toBe(true);

    // perShare хотя бы около теоретического each (ниже — очень мягкая нижняя граница)
    expect(stateAfter.perShare > theoreticalEach / 2n).toBe(true);

    // креатор получил примерно половину пула (допускаем потери на газ)
    const minCreatorGain = toNano((treasuryAmount * shareRatio * 0.8).toString()); // 80% от теории
    expect(deltaCreator > minCreatorGain).toBe(true);

    // --- Claims ---

    const beforeH = await Promise.all(
      holders.map(async h => (await blockchain.getContract(h.address)).balance),
    );

    const provider = blockchain.provider(splitter.address);

    for (let i = 0; i < holders.length; i++) {
      const proofCell = proofToCell(proofs[i]);

      // debug verify (геттер)
      const debugRes = await RoyaltySplitterMerkle.debugVerifyRaw(provider, {
        index: i,
        owner: holders[i].address,
        proof: proofCell,
      });
      console.log('debug_verify result:', debugRes);

      // настоящий клейм
      await splitter.sendClaim(holders[i].getSender(), {
        index: i,
        proof: proofCell,
      });
    }

    const afterH = await Promise.all(
      holders.map(async h => (await blockchain.getContract(h.address)).balance),
    );

        let totalHoldersGain = 0n;
        let minDelta: bigint | null = null;
        let maxDelta: bigint | null = null;
    
        for (let i = 0; i < holders.length; i++) {
          const delta = afterH[i] - beforeH[i];
          console.log(`holder[${i}] Δ=`, fromNano(delta));
          expect(delta > 0n).toBe(true);
    
          totalHoldersGain += delta;
          if (minDelta === null || delta < minDelta) minDelta = delta;
          if (maxDelta === null || delta > maxDelta) maxDelta = delta;
        }
    
        // холдеры получили примерно одинаково (разброс < 1 TON)
        if (minDelta !== null && maxDelta !== null) {
          const spread = maxDelta - minDelta;
          expect(spread < toNano('1')).toBe(true);
        }
    
        // --- повторный клейм: не должен дать больше денег ---
    
        const h0BeforeSecond = (await blockchain.getContract(holders[0].address)).balance;
    
        await splitter.sendClaim(holders[0].getSender(), {
          index: 0,
          proof: proofToCell(proofs[0]),
        });
    
        const h0AfterSecond = (await blockchain.getContract(holders[0].address)).balance;
        const deltaSecond = h0AfterSecond - h0BeforeSecond;
    
        console.log('holder[0] Δ on second claim =', fromNano(deltaSecond));
        // второй клейм не даёт ничего (или строго меньше minPayout — т.е. пыль)
        expect(deltaSecond <= toNano('0.009')).toBe(true);
    
        const finalState = await splitter.getState();
        const splitterFinal = (await blockchain.getContract(splitter.address)).balance;
    
        // claimedCount совпадает с количеством успешных клеймов
        expect(finalState.claimedCount).toBe(holders.length);
    
        // --- сводка по экономике и газу ---
    
        const poolBefore = splitterBefore - config.keepAlive;
        const poolLockedFinal = splitterFinal - config.keepAlive;
    
        const accounted = deltaCreator + totalHoldersGain + poolLockedFinal;
        const diff =
          poolBefore >= accounted ? poolBefore - accounted : accounted - poolBefore;
    
        console.log('--- Distribution summary ---');
        console.log({
          treasuryAmount,
          poolBefore: fromNano(poolBefore),
          distributedToCreator: fromNano(deltaCreator),
          distributedToHolders: fromNano(totalHoldersGain),
          contractLockedFinal: fromNano(poolLockedFinal),
          absDiffGasAndFees: fromNano(diff),
        });
    
        // расхождение (газ + округления) < 1 TON
        expect(diff < toNano('1')).toBe(true);    
  });

  it.skip('handles many epochs (100) and sparse claims for 100 holders', async () => {
    const blockchain = await Blockchain.create();
    const owner    = await blockchain.treasury('owner');
    const creator  = await blockchain.treasury('creator');

    const N_HOLDERS = 100;
    const N_EPOCHS  = 100;
    const EPOCH_FUND = toNano('100'); // 100 TON в эпоху

    const holders: SandboxContract<TreasuryContract>[] = [];
    for (let i = 0; i < N_HOLDERS; i++) {
      holders.push(await blockchain.treasury('h' + i));
    }

    const code = Cell.fromBoc(Buffer.from(codeHex, 'hex'))[0];
    const config = {
      owner: owner.address,
      creator: creator.address,
      keepAlive: toNano('1'),
      minPayout: toNano('0.05'),
    };
    const splitter = blockchain.openContract(
      RoyaltySplitterMerkle.createFromConfig(config, code),
    );

    await splitter.sendDeploy(owner.getSender(), toNano('2'));

    // общий меркл по всем 100 holders (одинаковый для всех эпох)
    const leaves = holders.map((h, i) => ({ index: i, owner: h.address }));
    const { rootHash, proofs } = buildMerkle(leaves);

    const creatorStart = (await blockchain.getContract(creator.address)).balance;

    for (let epoch = 1; epoch <= N_EPOCHS; epoch++) {
      await owner.send({
        to: splitter.address,
        value: EPOCH_FUND,
      });

      await splitter.sendSetEpoch(owner.getSender(), {
        epochId: epoch,
        total: N_HOLDERS,
        rootHash,
      });

      const state = await splitter.getState();
      expect(state.epochId).toBe(epoch);
      expect(state.perShare > 0n).toBe(true);

      // В каждой эпохе дают клеймить только 10 разных holders:
      // индексы (epoch * 10 + k) % N_HOLDERS, k = 0..9
      const claimedThisEpoch = new Set<number>();

      for (let k = 0; k < 10; k++) {
        const idx = (epoch * 10 + k) % N_HOLDERS;
        if (claimedThisEpoch.has(idx)) continue;
        claimedThisEpoch.add(idx);

        const proofCell = proofToCell(proofs[idx]);
        const before = (await blockchain.getContract(holders[idx].address)).balance;

        await splitter.sendClaim(holders[idx].getSender(), {
          index: idx,
          proof: proofCell,
        });

        const after = (await blockchain.getContract(holders[idx].address)).balance;
        const delta = after - before;

        // клейм должен что-то принести
        expect(delta > 0n).toBe(true);

        // повторный claim в той же эпохе не должен дать прироста
        const beforeSecond = (await blockchain.getContract(holders[idx].address)).balance;
        await splitter.sendClaim(holders[idx].getSender(), {
          index: idx,
          proof: proofCell,
        });
        const afterSecond = (await blockchain.getContract(holders[idx].address)).balance;
        expect(afterSecond - beforeSecond <= config.minPayout).toBe(true);
      }
    }

    const creatorEnd = (await blockchain.getContract(creator.address)).balance;
    const deltaCreator = creatorEnd - creatorStart;

    // Creator суммарно забрал в районе половины всех epoch_fund (минус газ)
    const totalFund = EPOCH_FUND * BigInt(N_EPOCHS);
    expect(deltaCreator > totalFund / 3n).toBe(true);  // хотя бы ~1/3
    expect(deltaCreator < totalFund).toBe(true);       // но не больше, чем всё
  });

  it.skip('multi-epoch royalties with separate treasury and full economic summary', async () => {
    const blockchain = await Blockchain.create();
  
    const owner    = await blockchain.treasury('owner');
    const creator  = await blockchain.treasury('creator');
    const treasury = await blockchain.treasury('treasury'); // кошелёк, который заливает TON в пул
  
    const N_HOLDERS  = 100;
    const N_EPOCHS   = 100;
    const EPOCH_FUND = toNano('100'); // 100 TON в каждую эпоху
  
    const holders: SandboxContract<TreasuryContract>[] = [];
    for (let i = 0; i < N_HOLDERS; i++) {
      holders.push(await blockchain.treasury('h' + i));
    }
  
    const code = Cell.fromBoc(Buffer.from(codeHex, 'hex'))[0];
    const config = {
      owner: owner.address,
      creator: creator.address,
      keepAlive: toNano('1'),
      minPayout: toNano('0.1'),
    };
  
    const splitter = blockchain.openContract(
      RoyaltySplitterMerkle.createFromConfig(config, code),
    );
  
    // ---- стартовые балансы всех участников ----
    const ownerStart    = (await blockchain.getContract(owner.address)).balance;
    const creatorStart  = (await blockchain.getContract(creator.address)).balance;
    const treasuryStart = (await blockchain.getContract(treasury.address)).balance;
    const splitterStart = (await blockchain.getContract(splitter.address)).balance;
    const holdersStart  = await Promise.all(
      holders.map(async h => (await blockchain.getContract(h.address)).balance),
    );
  
    await splitter.sendDeploy(owner.getSender(), toNano('2'));
  
    // общий Merkle для всех holders (одинаковый для всех эпох)
    const leaves = holders.map((h, i) => ({ index: i, owner: h.address }));
    const { rootHash, proofs } = buildMerkle(leaves);
  
    const creatorBeforeEpochs = (await blockchain.getContract(creator.address)).balance;
  
    for (let epoch = 1; epoch <= N_EPOCHS; epoch++) {
      // 1) Treasury заливает фонд эпохи
      await treasury.send({
        to: splitter.address,
        value: EPOCH_FUND,
      });
  
      const balanceBeforeSet = (await blockchain.getContract(splitter.address)).balance;
  
      // 2) Owner выставляет эпоху
      await splitter.sendSetEpoch(owner.getSender(), {
        epochId: epoch,
        total: N_HOLDERS,
        rootHash,
      });
  
      const balanceAfterSet = (await blockchain.getContract(splitter.address)).balance;
      const state = await splitter.getState();
  
      // epochId должен обновиться
      expect(state.epochId).toBe(epoch);
      // perShare > 0 (хотя бы что-то достаётся holder'ам)
      expect(state.perShare > 0n).toBe(true);
  
      // Разница баланса контракта ≈ фонд эпохи минус отданное creator'у и газ
      // (строгих чисел не ждём, просто sanity check)
      expect(balanceAfterSet <= balanceBeforeSet).toBe(true);
  
      // 3) В этой эпохе даём клеймить 10 различным держателям
      const claimedThisEpoch = new Set<number>();
  
      for (let k = 0; k < 100; k++) {
        const idx = (epoch * 100 + k) % N_HOLDERS;
        if (claimedThisEpoch.has(idx)) continue;
        claimedThisEpoch.add(idx);
  
        const proofCell = proofToCell(proofs[idx]);
        const holder    = holders[idx];
  
        const before = (await blockchain.getContract(holder.address)).balance;
  
        await splitter.sendClaim(holder.getSender(), {
          index: idx,
          proof: proofCell,
        });
  
        const after = (await blockchain.getContract(holder.address)).balance;
        const delta = after - before;
  
        // клейм в этой эпохе должен что-то принести
        expect(delta > 0n).toBe(true);
  
        // повторный клейм не должен приносить значимого прироста
        const beforeSecond = (await blockchain.getContract(holder.address)).balance;
        await splitter.sendClaim(holder.getSender(), {
          index: idx,
          proof: proofCell,
        });
        const afterSecond = (await blockchain.getContract(holder.address)).balance;
  
        // либо 0, либо максимум "пыль" меньше minPayout
        expect(afterSecond - beforeSecond <= config.minPayout).toBe(true);
      }
    }
  
    const creatorEnd = (await blockchain.getContract(creator.address)).balance;
    const deltaCreator = creatorEnd - creatorBeforeEpochs;
  
    // общий фонд, который вносил treasury
    const totalFund = EPOCH_FUND * BigInt(N_EPOCHS);
  
    // creator в сумме должен забрать значимую долю фонда (≈ 50% - газ)
    expect(deltaCreator > totalFund / 3n).toBe(true);  // хотя бы ~ треть
    expect(deltaCreator < totalFund).toBe(true);       // но не больше самого фонда
  
    // ---- ФИНАЛЬНАЯ ЭКОНОМИКА ----
  
    const ownerEnd    = (await blockchain.getContract(owner.address)).balance;
    const treasuryEnd = (await blockchain.getContract(treasury.address)).balance;
    const splitterEnd = (await blockchain.getContract(splitter.address)).balance;
    const holdersEnd  = await Promise.all(
      holders.map(async h => (await blockchain.getContract(h.address)).balance),
    );
  
    const sumBig = (arr: bigint[]) => arr.reduce((a, b) => a + b, 0n);
  
    const holdersStartSum = sumBig(holdersStart);
    const holdersEndSum   = sumBig(holdersEnd);
  
    const totalStart =
      ownerStart +
      creatorStart +
      treasuryStart +
      splitterStart +
      holdersStartSum;
  
    const totalEnd =
      ownerEnd +
      creatorEnd +
      treasuryEnd +
      splitterEnd +
      holdersEndSum;
  
    const gasBurned = totalStart - totalEnd; // всё, что «исчезло» — ушло валидаторам
  
    const creatorGain   = creatorEnd  - creatorStart;
    const holdersGain   = holdersEndSum   - holdersStartSum;
    const splitterGain  = splitterEnd - splitterStart;
    const treasurySpend = treasuryStart - treasuryEnd; // сколько реально влил treasury
  
    // sanity: газ не отрицательный
    expect(gasBurned >= 0n).toBe(true);
  
    const toTon  = (x: bigint) => Number(fromNano(x));
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const pct    = (part: number, total: number) =>
      total > 0 ? round2((part / total) * 100) : 0;
  
    const inflowT   = toTon(treasurySpend);      // считаем, что только treasury – донор пула
    const creatorT  = toTon(creatorGain);
    const holdersT  = toTon(holdersGain);
    const splitterT = toTon(splitterGain);
    const gasT      = toTon(gasBurned);
  
    console.log('--- ECONOMIC SUMMARY (multi-epoch) ---');
    console.log('Total treasury spend:  ', round2(inflowT),   'TON');
    console.log('Creator received:      ', round2(creatorT),  'TON',
                `(${pct(creatorT, inflowT)}%)`);
    console.log('Holders received:      ', round2(holdersT),  'TON',
                `(${pct(holdersT, inflowT)}%)`);
    console.log('Splitter leftover:     ', round2(splitterT), 'TON',
                `(${pct(splitterT, inflowT)}%)`);
    console.log('Gas burned (fees):     ', round2(gasT),      'TON',
                `(${pct(gasT, inflowT)}%)`);
  
    const sumPct =
      pct(creatorT, inflowT) +
      pct(holdersT, inflowT) +
      pct(splitterT, inflowT) +
      pct(gasT, inflowT);
  
    console.log('Sum of percentages ≈', sumPct, '%');
  
    // допускаем ±1% из-за округлений
    expect(sumPct).toBeGreaterThanOrEqual(99);
    expect(sumPct).toBeLessThanOrEqual(101);
  });

  it('restrict owner from claiming if they are not in merkle tree', async () => {
    const blockchain = await Blockchain.create();
    const owner   = await blockchain.treasury('owner');
    const creator = await blockchain.treasury('creator');
  
    const holders: SandboxContract<TreasuryContract>[] = [];
    for (let i = 0; i < 5; i++) {
      holders.push(await blockchain.treasury('h' + i));
    }
  
    const code = Cell.fromBoc(Buffer.from(codeHex, 'hex'))[0];
  
    const config = {
      owner: owner.address,
      creator: creator.address,
      keepAlive: toNano('0.1'),
      minPayout: toNano('0.01'),
    };
  
    const splitter = blockchain.openContract(
      RoyaltySplitterMerkle.createFromConfig(config, code),
    );
  
    await splitter.sendDeploy(owner.getSender(), toNano('0.3'));
  
    await owner.send({
      to: splitter.address,
      value: toNano('100'),
    });
  
    const leaves = holders.map((h, i) => ({ index: i, owner: h.address }));
    const { rootHash, proofs } = buildMerkle(leaves);
  
    await splitter.sendSetEpoch(owner.getSender(), {
      epochId: 1,
      total: holders.length,
      rootHash,
    });
  
    const stateBefore = await splitter.getState();
    expect(stateBefore.epochId).toBe(1);
    expect(stateBefore.perShare > 0n).toBe(true);
  
    const ownerBefore = (await blockchain.getContract(owner.address)).balance;
    const claimedBefore = stateBefore.claimedCount;
  
    // proof[0] валиден для holders[0], но мы проверим его на owner
    const proofCell = proofToCell(proofs[0]);
  
    // 1) Убедимся, что debug_verify говорит "невалидно"
    const provider = blockchain.provider(splitter.address);
    const dbg = await RoyaltySplitterMerkle.debugVerifyRaw(provider, {
      index: 0,
      owner: owner.address,
      proof: proofCell,
    });
    console.log('debug_verify(owner, idx=0) =', dbg);
    expect(dbg).toBe(0); // 0 = fail, 1 = ok
  
    // 2) Пробуем заклеймить – промис резолвится, но транза будет с throw внутри контракта
    await splitter.sendClaim(owner.getSender(), {
      index: 0,
      proof: proofCell,
    });
  
    const ownerAfter = (await blockchain.getContract(owner.address)).balance;
    const stateAfter = await splitter.getState();
  
    // Он не должен ПОЛУЧИТЬ профит (баланс не растёт, максимум – немного упал из-за газа)
    const deltaOwner = ownerAfter - ownerBefore;
    console.log('owner Δ=', fromNano(deltaOwner));
  
    // Не заработал ни наноТОНа
    expect(deltaOwner <= 0n).toBe(true);
    // И не сжёг безумный газ (просто sanity bound)
    expect(deltaOwner > -toNano('0.3')).toBe(true);
  
    // claim не должен засчитаться – счётчик клеймов не меняется
    expect(stateAfter.claimedCount).toBe(claimedBefore);
  });  
});

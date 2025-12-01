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
});
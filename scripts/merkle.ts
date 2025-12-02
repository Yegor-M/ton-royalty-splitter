import { beginCell, Cell, Address } from '@ton/core';

function cellHashToBigInt(cell: Cell): bigint {
  const buf = cell.hash();           // 32 bytes
  let r = 0n;
  for (const b of buf) {
    r = (r << 8n) + BigInt(b);
  }
  return r;
}

type Leaf = { index: number; owner: Address };

function makeLeafCell(leaf: Leaf): Cell {
  return beginCell()
    .storeUint(leaf.index, 32)
    .storeAddress(leaf.owner)
    .endCell();
}

function buildMerkle(leaves: Leaf[]): { rootHash: bigint; proofs: Cell[] } {
  if (leaves.length === 0) {
    return { rootHash: 0n, proofs: [] };
  }

  // levelCells[i] = Cell for i-th leaf
  let levelCells: Cell[] = leaves.map(makeLeafCell);
  const tree: Cell[][] = [levelCells];

  // build up the tree
  while (levelCells.length > 1) {
    const next: Cell[] = [];
    for (let i = 0; i < levelCells.length; i += 2) {
      if (i + 1 === levelCells.length) {
        // odd one – duplicate last
        next.push(levelCells[i]);
      } else {
        const left = levelCells[i];
        const right = levelCells[i + 1];

        // child cell hashes -> sorted pair (as in contract hash_pair)
        const h1 = cellHashToBigInt(left);
        const h2 = cellHashToBigInt(right);
        const lo = h1 < h2 ? h1 : h2;
        const hi = h1 < h2 ? h2 : h1;

        const parent = beginCell()
          .storeUint(lo, 256)
          .storeUint(hi, 256)
          .endCell();

        next.push(parent);
      }
    }
    levelCells = next;
    tree.push(levelCells);
  }

  const rootCell = levelCells[0];
  const rootHash = cellHashToBigInt(rootCell);

  // build proofs: for each leaf, collect sibling hashes along the way
  const proofs: Cell[] = leaves.map(() => new Cell()); // will overwrite

  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    const siblings: Cell[] = [];

    let idx = leafIndex;
    for (let level = 0; level < tree.length - 1; level++) {
      const nodes = tree[level];

      const pairIndex = idx ^ 1; // sibling index: flip last bit
      if (pairIndex < nodes.length) {
        siblings.push(nodes[pairIndex]);
      }
      idx = Math.floor(idx / 2); // parent index
    }

    // encode siblings as the linked-cell chain that your FunC verify_merkle expects:
    // proof: cell0 { sib0:uint256, ref->cell1 }, ..., last cell { sibN:uint256 }
    let proofCell: Cell | null = null;
    for (let i = siblings.length - 1; i >= 0; i--) {
      const sibHash = cellHashToBigInt(siblings[i]);
      const b = beginCell().storeUint(sibHash, 256);
      if (proofCell) {
        b.storeRef(proofCell);
      }
      proofCell = b.endCell();
    }

    proofs[leafIndex] = proofCell ?? beginCell().endCell();
  }

  return { rootHash, proofs };
}


export { buildMerkle};
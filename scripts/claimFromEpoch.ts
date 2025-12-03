import { NetworkProvider } from '@ton/blueprint';
import { Address, beginCell, Cell } from '@ton/core';
import { RoyaltySplitterMerkle } from '../wrappers/RoyaltySplitterMerkle';
import claimFile from '../epochs/epoch_claim_3.json'; // пример

function proofFromHexArray(arr: string[]): Cell {
  // здесь именно "цепочка ячеек", как в контракте
  if (!arr.length) {
    return beginCell().endCell();
  }

  // siblings → chain-of-cells: [sib0]->[sib1]->...
  let tail: Cell | null = null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const sib = BigInt(arr[i]); // "0x..." → bigint
    const b = beginCell().storeUint(sib, 256);
    if (tail) b.storeRef(tail);
    tail = b.endCell();
  }
  // tail теперь голова цепи
  return tail!;
}

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();

  const splitterAddr = Address.parse(claimFile.splitter);
  const splitter = provider.open(RoyaltySplitterMerkle.createFromAddress(splitterAddr));

  const sender = provider.sender();
  ui.write('Loaded claim file for epoch ' + claimFile.epochId);
  ui.write('Collection: ' + claimFile.collectionFriendly);
  ui.write('Splitter:   ' + splitter.address.toString());
  ui.write('Sender:     ' + sender.address!.toString());

  // Ищем запись для этого sender’а
  const holder = claimFile.holders.find(h =>
    Address.parse(h.owner).equals(sender.address!)
  );

  if (!holder) {
    ui.write('Sender is not in claim file – claim will revert.');
    return;
  }

  const proofCell = proofFromHexArray(holder.proof);
  ui.write(
    `Found holder index=${holder.index}, nft=${holder.nft}, proofLen=${holder.proof.length}`,
  );

  // debug_verify перед отправкой
  const dbg = await splitter.debugVerify(provider, {
    index: holder.index,
    owner: Address.parse(holder.owner),
    proof: proofCell,
  });

  ui.write(`debug_verify result: ${dbg} (1 = ok, 0 = invalid proof)`);

  if (dbg !== 1) {
    ui.write('Proof is invalid for current rootHash – claim will bounce. Abort.');
    return;
  }

  const confirm = await ui.input('Ready to send claim. Proceed? (yes/no)\n? > ');
  if (confirm.trim().toLowerCase() !== 'yes') {
    ui.write('Aborted by user.');
    return;
  }

  await splitter.sendClaim(sender, {
    index: holder.index,
    proof: proofCell,
  });

  ui.write('Claim sent. Check balance / get_state on splitter.');
}

import { Address, beginCell, Cell } from '@ton/core';

export function encodeOwners(addresses: Address[]): Cell {
  const b = beginCell();
  b.storeUint(addresses.length, 16);
  for (const a of addresses) b.storeAddress(a);
  return b.endCell();
}

import {
  Address,
  Cell,
  Contract,
  ContractProvider,
  Sender,
  SendMode,
  beginCell,
  contractAddress,
  toNano,
} from '@ton/core';

const OPCODE_SET_EPOCH  = 0x7a11c100;
const OPCODE_CLAIM      = 0x7a11c101;

export type RoyaltySplitterConfig = {
  owner: Address;
  creator: Address;
  keepAlive: bigint;
  minPayout: bigint;
};

export function royaltySplitterConfigToCell(cfg: RoyaltySplitterConfig): Cell {
  return beginCell()
    .storeAddress(cfg.owner)
    .storeAddress(cfg.creator)
    .storeCoins(cfg.keepAlive)
    .storeCoins(cfg.minPayout)
    .storeUint(0, 32)    // epochId
    .storeCoins(0n)      // perShare
    .storeDict(null)     // claimed
    .storeUint(0n, 256)  // rootHash
    .endCell();
}

export class RoyaltySplitterMerkle implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromConfig(
    config: RoyaltySplitterConfig,
    code: Cell,
    workchain = 0,
  ) {
    const data = royaltySplitterConfigToCell(config);
    const init = { code, data };
    const address = contractAddress(workchain, init);
    return new RoyaltySplitterMerkle(address, init);
  }

  static createFromAddress(address: Address) {
    return new RoyaltySplitterMerkle(address);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value = toNano('0.3')) {
    await provider.internal(via, {
      value,
      bounce: false,
      body: beginCell().endCell(),
    });
  }

  private async sendInternal(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    body: Cell,
  ) {
    await provider.internal(via, {
      value,
      bounce: true,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async sendSetEpoch(
    provider: ContractProvider,
    via: Sender,
    args: { epochId: number; total: number; rootHash: bigint },
    value = toNano('0.1'),
  ) {
    const body = beginCell()
      .storeUint(OPCODE_SET_EPOCH, 32)
      .storeUint(args.epochId, 32)
      .storeUint(args.total, 16)
      .storeUint(args.rootHash, 256)
      .endCell();

    await this.sendInternal(provider, via, value, body);
  }

  async sendClaim(
    provider: ContractProvider,
    via: Sender,
    args: { index: number; proof: Cell },
    value = toNano('0.1'),
  ) {
    const body = beginCell()
      .storeUint(OPCODE_CLAIM, 32)
      .storeUint(args.index, 32)
      .storeRef(args.proof)
      .endCell();

    await this.sendInternal(provider, via, value, body);
  }

  static async debugVerifyRaw(
    provider: ContractProvider,
    args: { index: number; owner: Address; proof: Cell },
  ): Promise<number> {
    const res = await provider.get('debug_verify', [
      { type: 'int',   value: BigInt(args.index) },
      { type: 'slice', cell: beginCell().storeAddress(args.owner).endCell() },
      { type: 'cell',  cell: args.proof },
    ]);
    return res.stack.readNumber();
  }

  async getState(provider: ContractProvider) {
    const r = await provider.get('get_state', []);
    const epochId      = r.stack.readNumber();
    const keepAlive    = r.stack.readBigNumber();
    const minPayout    = r.stack.readBigNumber();
    const perShare     = r.stack.readBigNumber();
    const claimedCount = r.stack.readNumber();
    const rootHash     = r.stack.readBigNumber();
    const _reserved    = r.stack.readNumber();

    return { epochId, keepAlive, minPayout, perShare, claimedCount, rootHash };
  }
}
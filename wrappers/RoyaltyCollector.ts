import { Address, Cell, Slice, beginCell, contractAddress, Contract, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export const OPCODES = {
  batch:      0x7a11c0de,
  setCreator: 0x7a11c001,
  setParams:  0x7a11c002,
};

export class RoyaltyCollector implements Contract {
  readonly address: Address;
  readonly init?: { code: Cell; data: Cell };

  private constructor(address: Address, init?: { code: Cell; data: Cell }) {
    this.address = address;
    this.init = init;
  }

  static createFromCode(code: Cell, data: Cell, workchain = 0) {
    const init = { code, data };
    const address = contractAddress(workchain, init);
    return new RoyaltyCollector(address, init);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value = toNano('0.2')) {
    await provider.internal(via, { value, sendMode: SendMode.PAY_GAS_SEPARATELY, body: beginCell().endCell() });
  }

  async sendSetCreator(provider: ContractProvider, via: Sender, newCreator: Address, value = toNano('0.05')) {
    const body = beginCell()
      .storeUint(OPCODES.setCreator, 32)
      .storeUint(0, 64)
      .storeAddress(newCreator)
      .endCell();
    await provider.internal(via, { value, sendMode: SendMode.PAY_GAS_SEPARATELY, body });
  }

  async sendSetParams(provider: ContractProvider, via: Sender, keepAlive: bigint, minPayout: bigint, value = toNano('0.05')) {
    const body = beginCell()
      .storeUint(OPCODES.setParams, 32)
      .storeUint(0, 64)
      .storeCoins(keepAlive)
      .storeCoins(minPayout)
      .endCell();
    await provider.internal(via, { value, sendMode: SendMode.PAY_GAS_SEPARATELY, body });
  }

  async sendBatch(
    provider: ContractProvider,
    via: Sender,
    epoch: number,
    start: number,
    end: number,
    ownersRef: Cell,
    value = toNano('0.1')
  ) {
    const body = beginCell()
      .storeUint(OPCODES.batch, 32)
      .storeUint(0, 64)
      .storeUint(epoch, 32)
      .storeUint(start, 16)
      .storeUint(end, 16)
      .storeRef(ownersRef)
      .endCell();
    await provider.internal(via, { value, sendMode: SendMode.PAY_GAS_SEPARATELY, body });
  }

  async getState(provider: ContractProvider) {
    const { stack } = await provider.get('get_state', []);
    const lastEpoch   = stack.readNumber();     // int
    const creator     = stack.readAddress();    // slice->Address
    const keepAlive   = stack.readBigNumber();  // coins
    const minPayout   = stack.readBigNumber();  // coins
    const curEpoch    = stack.readNumber();     // int
    const epochStart  = stack.readNumber();     // int (0/1)
    const perShare    = stack.readBigNumber();  // coins
    const remaining   = stack.readBigNumber();  // coins
    return { lastEpoch, creator, keepAlive, minPayout, curEpoch, epochStart, perShare, remaining };
  }
}

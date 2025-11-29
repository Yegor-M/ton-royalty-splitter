// scripts/deployRoyaltyCollector.ts
import { Address, beginCell, toNano, Cell } from '@ton/core';
import { compile, type NetworkProvider } from '@ton/blueprint';
import { RoyaltyCollector } from '../wrappers/RoyaltyCollector';

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();

  // Env:
  //   RC_CREATOR   — destination for creator share (required)
  //   RC_KEEPALIVE — reserve to keep on contract (default 0.1)
  //   RC_MINPAYOUT — min payout per transfer (default 0.01)
  //   RC_DEPLOY    — deploy value (default 0.3)
  const owner = provider.sender().address!;
  const creator = provider.sender().address!;
  const keepAlive = toNano(process.env.RC_KEEPALIVE ?? '0.1');
  const minPayout = toNano(process.env.RC_MINPAYOUT ?? '0.01');
  const deployValue = toNano(process.env.RC_DEPLOY ?? '0.3');

  // 1) Compile RoyaltyCollector code by name from wrappers/royalty-collector.compile.ts
  const code: Cell = await compile('royalty-collector');

  // 2) Build init data (must match the FunC storage layout)
  const initData = beginCell()
    .storeAddress(owner)        // owner
    .storeAddress(creator)      // creator
    .storeCoins(keepAlive)      // keepAlive
    .storeCoins(minPayout)      // minPayout
    .storeUint(0, 32)           // lastEpoch
    .storeUint(0, 32)           // curEpoch
    .storeUint(0, 1)            // epochStarted
    .storeCoins(0)              // epochPerItemShare
    .storeCoins(0)              // epochRemaining
    .endCell();

  // 3) Open via provider.open(...)
  const collector = provider.open(
    RoyaltyCollector.createFromCode(code, initData)
  );


  // 4) Send deploy from the connected wallet (tonconnect or mnemonic)
  await collector.sendDeploy(provider.sender(), deployValue);

  // 5) Confirm deployment (optional but helpful)
   provider.waitForDeploy(collector.address);

  ui.write(`RoyaltyCollector deployed at: ${collector.address.toString()}`);
}

import type { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
  lang: 'func',
  targets: ['contracts/royalty-collector.fc', 'contracts/op-codes-royalty.fc'],
  // include: ['imports'] // enable if you have includes
};

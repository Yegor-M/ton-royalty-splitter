import type { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
  lang: 'func',
  targets: [
    'contracts/royalty-collector.fc',
    'contracts/op-codes-royalty.fc'
  ],
  // Optional: include directory for #include files
  // include: ['imports']  // uncomment if you use includes like ./imports/stdlib.fc
};

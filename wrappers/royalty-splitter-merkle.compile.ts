import type { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
  lang: 'func',
  targets: [
    'contracts/royalty-splitter-merkle.fc'
  ]
};

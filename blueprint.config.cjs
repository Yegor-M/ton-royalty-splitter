/** @type {import('@ton/blueprint').BlueprintConfig} */
module.exports = {
  projects: {
    contracts: {
      path: './contracts',
      sources: [
        'royalty-collector.fc',
        'op-codes-royalty.fc'
      ],
      // include: ['imports'] // uncomment if #include "imports/..." is used
    }
  }
};

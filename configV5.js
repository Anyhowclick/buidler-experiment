module.exports = {
  solc: {
    version: "0.5.9",
    optimizer: {
      enabled: true,
      runs: 200
    },
    evmVersion: 'petersburg'
  },

  paths: {
    sources: './contracts/V5'
  }
};

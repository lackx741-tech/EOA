require("@nomicfoundation/hardhat-toolbox");
const path = require("path");

// Use the bundled soljson.js to avoid downloading a compiler
// (useful in air-gapped / network-restricted environments).
const LOCAL_SOLC = path.resolve(
  __dirname,
  "node_modules/solc/soljson.js"
);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  paths: {
    compilers: [{ version: "0.8.24", path: LOCAL_SOLC }],
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
  },
};

"use strict";

const { ethers } = require("hardhat");

/**
 * Deployment script for DelegateEOA.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network <network>
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying DelegateEOA...");
  console.log("  Deployer:", deployer.address);
  console.log(
    "  Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  const DelegateEOA = await ethers.getContractFactory("DelegateEOA");
  const contract = await DelegateEOA.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const network = await ethers.provider.getNetwork();

  console.log("\nDeployed successfully!");
  console.log("  Address         :", address);
  console.log("  Chain ID        :", network.chainId.toString());
  console.log(
    "  DOMAIN_SEPARATOR:",
    await contract.DOMAIN_SEPARATOR()
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

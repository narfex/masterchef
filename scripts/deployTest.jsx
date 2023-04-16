const hre = require("hardhat");
const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

const gasPrice = ethers.utils.parseUnits("10", "gwei");  // warning

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// const NARFEX_TOKEN_ADDRESS = '0xF13786C8B8Ef7836808b0384F582e7d394d192ff'; // https://polygonscan.com/address/0xF13786C8B8Ef7836808b0384F582e7d394d192ff#code
const NARFEX_TOKEN_ADDRESS = '0xfa76d0dc8E020098B3f22f67d8AADda6FDc7164e'; // https://testnet.bscscan.com/address/0xfa76d0dc8E020098B3f22f67d8AADda6FDc7164e#code

const repoPath = path.join(__dirname, "..");
const narfexRepos = path.join(repoPath, "..");
const mockNarfexTokenArtifactPath = path.join(narfexRepos, "fiat-factory/artifacts/contracts/mock/MockNarfexToken.sol/MockNarfexToken.json");
const mockNarfexTokenArtifactData = fs.readFileSync(mockNarfexTokenArtifactPath);
const mockNarfexTokenArtifactJSON = JSON.parse(mockNarfexTokenArtifactData);

const main = async () => {
  let tx;

  const owner = '0x40115Ad8F8925495fE3cd552e02ba9DE58A456A1'
  console.log('owner address:', owner);

  const narfexToken = await ethers.getContractAtFromArtifact(
    mockNarfexTokenArtifactJSON,
    NARFEX_TOKEN_ADDRESS
  );
  let balance = await narfexToken.balanceOf(owner);
  if (balance.lt(ethers.utils.parseEther("10000"))) {
    console.log('owner NRFX balance is less than 10000 NRFX, minting 10000 NRFX to owner');
    tx = await narfexToken.mint(owner, ethers.utils.parseEther("10000"), {
      gasPrice: gasPrice
    });
    await tx.wait();
  }
  balance = await narfexToken.balanceOf(owner);
  console.log('owner NRFX balance:', balance);

  const MasterChefContract = await ethers.getContractFactory("MasterChef");
  const args = [
    NARFEX_TOKEN_ADDRESS, // _rewardToken: Mock Narfex Token
	  ethers.utils.parseEther("0.00001"), // _rewardPerBlock: 1/100000 NRFX
    owner, // _feeTreasury: test narfex acc - owner
  ]
  console.log('start deploy masterChef with args:', args);
  const masterChef = await MasterChefContract.deploy(...args, {gasPrice: gasPrice});
  await masterChef.deployed();
  console.log("MasterChef deployed to:", masterChef.address);

  console.log('sleep before verify')
  await sleep(60000);

  console.log("MasterChef verify started");
  await hre.run(`verify:verify`, {
    address: masterChef.address,
    constructorArguments: args,
  });
  console.log("MasterChef verify finished");

  console.log('setMasterChef')
  tx = await narfexToken.setMasterChef(masterChef.address, {
    gasPrice: gasPrice
  });
  await tx.wait();

  console.log('setBlockchainBlocksPerDay')
  tx = await masterChef.setBlockchainBlocksPerDay('40000', {
    gasPrice: gasPrice
  });
  await tx.wait();

  console.log('setEstimationRewardPeriodDays')
  tx = await masterChef.setEstimationRewardPeriodDays('30', {
    gasPrice: gasPrice
  });
  await tx.wait();

  console.log('setEarlyHarvestCommissionInterval')
  tx = await masterChef.setEarlyHarvestCommissionInterval('60', {
    gasPrice: gasPrice
  });
  await tx.wait();

  console.log('setHarvestInterval')
  tx = await masterChef.setHarvestInterval('60', {
    gasPrice: gasPrice
  });
  await tx.wait();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
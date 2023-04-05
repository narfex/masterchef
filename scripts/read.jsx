const hre = require("hardhat");
const { ethers } = require("hardhat");
const path = require("path");
const fs = require("fs");

const gasPrice = ethers.utils.parseUnits("10", "gwei");  // warning

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const NARFEX_TOKEN_ADDRESS = '0xfa76d0dc8E020098B3f22f67d8AADda6FDc7164e'; // https://testnet.bscscan.com/address/0xfa76d0dc8E020098B3f22f67d8AADda6FDc7164e#code
const MASTERCHEF_ADDRESS = '0xDf8951a64a0eaF51216B72C4f4Fdd2BE8d98589E'
const LP_ADDRESS = '0x571839f49403f92483078e0bbc918cec3bae28f7'

const repoPath = path.join(__dirname, "..");
const narfexRepos = path.join(repoPath, "..");
const mockNarfexTokenArtifactPath = path.join(narfexRepos, "fiat-factory/artifacts/contracts/mock/MockNarfexToken.sol/MockNarfexToken.json");
const mockNarfexTokenArtifactData = fs.readFileSync(mockNarfexTokenArtifactPath);
const mockNarfexTokenArtifactJSON = JSON.parse(mockNarfexTokenArtifactData);


const main = async () => {
  let tx;
  let receipt;

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

  const MasterChef = await ethers.getContractFactory("MasterChef");
  const masterChef = await MasterChef.attach(MASTERCHEF_ADDRESS);
  console.log('use deployed masterChef at:', MASTERCHEF_ADDRESS);

  const lp = await ethers.getContractAt("IERC20", LP_ADDRESS);
  console.log('use LP at:', LP_ADDRESS);

  console.log('endBlock:', await masterChef.endBlock());
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
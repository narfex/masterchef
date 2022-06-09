const { ethers } = require("hardhat");

const main = async () => {
	
  const NarfexTokenContract = await ethers.getContractFactory("NarfexToken");
  const narfexToken = await NarfexTokenContract.deploy();
  await narfexToken.deployed();
  console.log("NarfexToken deployed:", narfexToken.address);
	
  const MasterChefContract = await ethers.getContractFactory("MasterChef");
  const masterChef = await MasterChefContract.deploy(
	narfexToken.address, // Narfex Token
	0, // defaultRewardPerBlock
	60 * 20, // commissionInterval
	60 * 5, // harvestInterval
	0, // earlyHarvestCommission
	false, // isUnrewardEarlyWithdrawals
	0, // rewardCancelInterval
  0, // referralPercent
  );
  await masterChef.deployed();
  console.log("MasterChef deployed:", masterChef.address);
  
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
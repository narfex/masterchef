const { ethers } = require("hardhat");

const main = async () => {
	
  /**
  const NarfexTokenContract = await ethers.getContractFactory("NarfexToken");
  const narfexToken = await NarfexTokenContract.deploy();
  await narfexToken.deployed();
  console.log("NarfexToken deployed:", narfexToken.address);
  **/
	
  const MasterChefContract = await ethers.getContractFactory("MasterChef");
  const masterChef = await MasterChefContract.deploy(
	'0xcDA8eD22bB27Fe84615f368D09B5A8Afe4a99320', // Narfex Token
	1000000000000000, // defaultRewardPerBlock
	60 * 60, // commissionInterval
	60 * 10, // harvestInterval
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
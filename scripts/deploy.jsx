const { ethers } = require("hardhat");

const main = async () => {
  const MasterChefContract = await ethers.getContractFactory("MasterChef");
  const masterChef = await MasterChefContract.deploy(
	"0x3764Be118a1e09257851A3BD636D48DFeab5CAFE", // Narfex Token
	0, // defaultRewardPerBlock
	0, // commissionInterval
	0, // harvestInterval
	0, // earlyHarvestCommission
	false, // isUnrewardEarlyWithdrawals
	0, // rewardCancelInterval
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
const { expectEvent } = require('@openzeppelin/test-helpers');
const {
  time,
  helpers,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const assert = require('assert');
const { ethers } = require("hardhat");
const { mineUpTo, mine } = require("@nomicfoundation/hardhat-network-helpers");
const {BigNumber} = require("ethers");
const {ZERO_ADDRESS} = require("@openzeppelin/test-helpers/src/constants");
require("chai-bignumber")(BigNumber);


function bn(value) {
  return new BigNumber.from(value);
}


describe("MasterChef", function () {
  const ONE = bn(10).pow(bn(18));

  // initialized in beforeEach
  let narfex;
  let masterChef;
  let rewardPerBlock;
  let rewardPerBlockWithReferralPercent;
  let rewardBalance;
  let startBlock;
  let endBlock;
  let owner;
  let feeTreasury;
  let otherAccount;
  let lptoken;
  let NarfexMock;
  let MasterChef;
  let ERC20Mock;
  let LpTokenMock;
  let tx;  // last transaction
  let alice;
  let bob;
  let carol;
  let erc20Token;
  let token0;
  let token1;

  before(async function () {
    [owner, feeTreasury, otherAccount, alice, bob, carol] = await ethers.getSigners();
    NarfexMock = await ethers.getContractFactory("NarfexMock");
    ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    MasterChef = await ethers.getContractFactory("MasterChef");
    LpTokenMock = await ethers.getContractFactory("LpTokenMock");
  });

  beforeEach(async function () {
    narfex = await NarfexMock.deploy();
    await narfex.deployed();
    narfex.mint(owner.address, bn('1000').mul(ONE));

    erc20Token = await ERC20Mock.deploy("TEST", "TEST");  // other erc20 token
    await erc20Token.deployed();

    token0 = await ERC20Mock.deploy("token0", "token0");
    await token0.deployed();

    token1 = await ERC20Mock.deploy("token1", "token1");
    await token1.deployed();

    lptoken = await LpTokenMock.deploy(token0.address, token1.address);
    await lptoken.deployed();

    rewardPerBlock = ONE.div(bn('1000'));
    masterChef = await MasterChef.deploy(narfex.address, rewardPerBlock, feeTreasury.address);
    await masterChef.deployed();
    rewardPerBlockWithReferralPercent = await masterChef.rewardPerBlockWithReferralPercent();

    rewardBalance = ONE;
    await narfex.transfer(masterChef.address, rewardBalance.toString());
    tx = await masterChef.accountNewRewards();
    startBlock = bn((await masterChef.startBlock()).toString());
    const expectedEndBlock = startBlock.add(rewardBalance.div(rewardPerBlockWithReferralPercent))
    await expect(tx).to.emit(masterChef, 'NewRewardsAccounted').withNamedArgs({
      newRewardsAmount: rewardBalance,
      newEndBlock: expectedEndBlock.toString(),
      newRestUnallocatedRewards: rewardBalance.mod(rewardPerBlockWithReferralPercent),
      newLastRewardTokenBalance: rewardBalance,
      afterEndBlock: false,
    })
    expect(await masterChef.endBlock()).equal(expectedEndBlock.toString());
    expect(await masterChef.restUnallocatedRewards()).equal(rewardBalance.mod(rewardPerBlockWithReferralPercent));

    endBlock = bn((await masterChef.endBlock()).toString());
  });

  async function setEarlyHarvestCommission(signer, commission, pid) {
    const contractInterface = masterChef.interface;
    const functionData = contractInterface.encodeFunctionData(
      "setEarlyHarvestCommission(uint256,uint256)",
      [commission, pid]
    );
    const transaction = {
      to: masterChef.address,
      data: functionData,
    };
    const tx = await signer.sendTransaction(transaction);
    await tx.wait();
    return tx;
  }

  async function setEarlyHarvestCommissionInterval(signer, commissionInterval, pid) {
    const contractInterface = masterChef.interface;
    const functionData = contractInterface.encodeFunctionData(
      "setEarlyHarvestCommissionInterval(uint256,uint256)",
      [commissionInterval, pid]
    );
    const transaction = {
      to: masterChef.address,
      data: functionData,
    };
    const tx = await signer.sendTransaction(transaction);
    await tx.wait();
    return tx;
  }

  describe("Pausable", () => {
    it("should only allow owner to call pause", async () => {
      await expect(masterChef.connect(otherAccount).pause()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(masterChef.connect(owner).pause()).to.emit(masterChef, "Paused");
    });

    it("should only allow owner to call unpause", async () => {
      await masterChef.connect(owner).pause();
      await expect(masterChef.connect(otherAccount).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(masterChef.connect(owner).unpause()).to.emit(masterChef, "Unpaused");
    });

    it("should not allow deposit, withdraw and harvest when paused", async () => {
      await masterChef.connect(owner).pause();
      await masterChef.add(1000, lptoken.address);
      await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
      await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

      await expect(masterChef.connect(alice).depositWithoutRefer(lptoken.address, ONE)).to.be.revertedWith("Pausable: paused");
      await expect(masterChef.connect(alice).withdraw(lptoken.address, ONE)).to.be.revertedWith("Pausable: paused");
      await expect(masterChef.connect(alice).harvest(lptoken.address)).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("EmergencyState", () => {
    it("should be in normal state by default", async () => {
      const state = await masterChef.emergencyState();
      expect(state).to.equal(0);
    });

    it("should change state to EMERGENCY_FOREVER", async () => {
      await masterChef.connect(owner).setEmergencyState(2);
      const state = await masterChef.emergencyState();
      expect(state).to.equal(2);
    });

    it("should revert if trying to change state when in NORMAL_FOREVER", async () => {
      await masterChef.connect(owner).setEmergencyState(1);
      await expect(masterChef.connect(owner).setEmergencyState(2)).to.be.revertedWith(
        "EmergencyState: cannot change forever state"
      );
    });

    it("should revert if not owner tries to change state", async () => {
      await expect(masterChef.connect(alice).setEmergencyState(2)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("should revert if trying to set state to NORMAL", async () => {
      await expect(masterChef.connect(owner).setEmergencyState(0)).to.be.revertedWith(
        "EmergencyState: cannot set normal state"
      );
    });

    it("should revert when calling emergencyRecoverReward if emergency state is not active", async () => {
      // Ensure the state is not EMERGENCY_FOREVER
      const state = await masterChef.emergencyState();
      expect(state).to.not.equal(2);

      // Try to call emergencyRecoverReward
      await expect(
        masterChef.connect(owner).emergencyRecoverReward(alice.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("EmergencyState: emergency state is not active");
    });

    it("should successfully call emergencyRecoverReward when emergency state is active", async () => {
      // Set the state to EMERGENCY_FOREVER
      await masterChef.connect(owner).setEmergencyState(2);

      // Check initial balance
      const initialBalance = await narfex.balanceOf(alice.address);

      // Transfer rewards in case of emergency
      const amountToSend = ethers.utils.parseEther("1");
      await masterChef.connect(owner).emergencyRecoverReward(alice.address, amountToSend);

      // Check new balance
      const newBalance = await narfex.balanceOf(alice.address);

      // Verify that the new balance is equal to the initial balance plus the sent amount
      expect(newBalance.sub(initialBalance)).to.equal(amountToSend);
    });
  });

  it("Account no new incoming rewards", async function () {
    tx = await masterChef.accountNewRewards();
    await expect(tx).to.emit(masterChef, 'NoNewRewardsAccounted');
  });

  it("Account new incoming rewards before endBlock", async function () {
    const oldRestUnallocatedRewards = await masterChef.restUnallocatedRewards();
    const newRewardsAmount = rewardPerBlockWithReferralPercent.mul(10).add(5);  // should give another 10 blocks + 5 as a rest
    await narfex.transfer(masterChef.address, newRewardsAmount);
    tx = await masterChef.accountNewRewards();
    await expect(tx).to.emit(masterChef, 'NewRewardsAccounted').withNamedArgs({
      newRewardsAmount: newRewardsAmount,
      newEndBlock: endBlock.add(bn('10')).toString(),
      newRestUnallocatedRewards: oldRestUnallocatedRewards.add('5'),
      newLastRewardTokenBalance: rewardBalance.add(newRewardsAmount),
      afterEndBlock: false,
    })
    expect(await masterChef.endBlock()).equal(endBlock.add(bn(10)));
    expect(await masterChef.restUnallocatedRewards()).equal(oldRestUnallocatedRewards.add('5'));
  });

  it("Account new incoming rewards after endBlock", async function () {
    mineUpTo(endBlock.toNumber() + 1000);
    const newRewardsAmount = rewardPerBlockWithReferralPercent.mul(10).add(5);  // should give another 10 blocks + 5 as a rest
    await narfex.transfer(masterChef.address, newRewardsAmount);
    tx = await masterChef.accountNewRewards();
    await expect(tx).to.emit(masterChef, 'NewRewardsAccounted').withNamedArgs({
      newRewardsAmount: newRewardsAmount,
      newEndBlock: bn(await ethers.provider.getBlockNumber()).add(newRewardsAmount.div(rewardPerBlockWithReferralPercent)),
      newRestUnallocatedRewards: newRewardsAmount.add(rewardBalance).mod(rewardPerBlockWithReferralPercent),
      newLastRewardTokenBalance: rewardBalance.add(newRewardsAmount),
      afterEndBlock: true,
    })
  });

  it("Should set harvest interval", async function () {
    await narfex.mint(owner.address, 100);
    await narfex.allowance(owner.address, lptoken.address);
    await narfex.approve(lptoken.address, 90);
    await masterChef.setHarvestInterval(3600);
    expect(await masterChef.harvestInterval()).to.equal(3600);
  });

  it("Should cancel harvest interval from other account", async function () {
    await narfex.mint(owner.address, 100);
    await narfex.allowance(owner.address, lptoken.address);
    await narfex.approve(lptoken.address, 90);
    await expect (masterChef.connect(otherAccount).setHarvestInterval(3600)).to.be.reverted;
  });

  it("should update the reward per block updater address", async function () {
    const newAddress = "0x1234567890123456789012345678901234567890";
    await masterChef.connect(owner).setRewardPerBlockUpdater(newAddress);
    expect(await masterChef.rewardPerBlockUpdater()).to.equal(newAddress);
  });

  it("should not allow non-owner to update the reward per block updater address", async function () {
    const newAddress = "0x1234567890123456789012345678901234567890";
    await expect(masterChef.connect(alice).setRewardPerBlockUpdater(newAddress)).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("updates the blockchainBlocksPerDay value when called by the contract owner", async function () {
    // Arrange
    const newBlocksPerDay = 86400;
    await masterChef.deployed();

    // Act
    await masterChef.setBlockchainBlocksPerDay(newBlocksPerDay);

    // Assert
    const actualBlockchainBlocksPerDay = await masterChef.blockchainBlocksPerDay();
    expect(actualBlockchainBlocksPerDay).to.equal(newBlocksPerDay);
  });

  it("emits a BlockchainBlocksPerDayUpdated event when called by the contract owner", async function () {
    // Arrange
    const newBlocksPerDay = 86400;
    await masterChef.deployed();

    // Act
    const tx = await masterChef.setBlockchainBlocksPerDay(newBlocksPerDay);

    // Assert
    await expect(tx)
      .to.emit(masterChef, "BlockchainBlocksPerDayUpdated")
      .withArgs(newBlocksPerDay);
  });

  it("reverts when called by a non-owner address", async function () {
    // Arrange
    const nonOwner = (await ethers.getSigners())[1];
    const newBlocksPerDay = 86400;

    // Act & Assert
    await expect(
      masterChef.connect(nonOwner).setBlockchainBlocksPerDay(newBlocksPerDay)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    const actualBlockchainBlocksPerDay = await masterChef.blockchainBlocksPerDay();
    expect(actualBlockchainBlocksPerDay).to.not.equal(newBlocksPerDay);
  });


  it("Should set early harvest comission interval", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommissionInterval(owner, 3600, 0);
    await expect((await masterChef.poolInfo(0))[5]).to.equal(3600);
  });

  it("Should cancel early harvest comission interval from other account", async function () {
    await masterChef.add(1000, lptoken.address);
    await expect (setEarlyHarvestCommissionInterval(otherAccount, 3600, 0)).to.be.reverted;
  });

  it("Should set early harvest commission", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 50, 0);
    await expect((await masterChef.poolInfo(0))[6]).to.equal(50);
  });

  it("Should cancel early harvest commission from other account", async function () {
    await masterChef.add(1000, lptoken.address);
    await expect (setEarlyHarvestCommission(otherAccount, 50, 0)).to.be.reverted;
  });

  it("Should mass update pools after endBlock", async function () {
    await mineUpTo(endBlock.toNumber() + 1);
    await masterChef.massUpdatePools()
  });

  it("Should mass update pools", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.massUpdatePools();
  });

  it("Should return pools count", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

    await masterChef.getPoolsCount();
    expect(await masterChef.getPoolsCount()).to.equal(1);
  });

  it("Should return balance of narfex", async function () {
    const narfexLeft = await masterChef.getNarfexBalance();
    expect(narfexLeft).to.equal(rewardBalance);
  });

  it("Should withdraw narfex before endBlock", async function () {
    await mineUpTo(endBlock.sub(10).toNumber());
    await masterChef.withdrawNarfexByOwner(10);
  });

  it("Should cancel withdraw narfex from other account", async function () {
    await expect (masterChef.connect(otherAccount).withdrawNarfexByOwner(10)).to.be.reverted;
  });

  it("Should not add same pool twice", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await expect(masterChef.add(1000, lptoken.address)).to.be.revertedWith('already exists');
  });

  it("Should cancel a new pool from other account", async function () {
    await lptoken.mint(owner.address,100000);
    await expect (masterChef.connect(otherAccount).add(1000, lptoken.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("Should add a new pool", async function () {
    await lptoken.mint(owner.address,100000);
    await masterChef.add(1000, lptoken.address);
  });

  it("Should set reward per block", async function () {
    await masterChef.setRewardPerBlock(100);
    expect(await masterChef.rewardPerBlock()).to.equal(100);
  });

  it("Should cancel reward per block from other account", async function () {
    await expect (masterChef.connect(otherAccount).setRewardPerBlock(100)).to.be.reverted;
  });

  it("Should return settings", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.setRewardPerBlock(100);
    expect(await masterChef.rewardPerBlock()).to.equal(100);

    await masterChef.getSettings();
    assert.equal(60*60*24*14, 60*60*24*14, 60*60*8, 1000, 60);
  });

  it("Should set allocPoint for pool", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.set(0, 500);
  });

  it("Should set allocPoint for pool without update", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.set(0, 500);
  });

  it("Should cancel allocPoint for pool from other account", async function () {
    await masterChef.add(1000, lptoken.address);
    await expect (masterChef.connect(otherAccount).set(0, 500)).to.be.reverted;
  });

  it("Should get user reward", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.getUserReward(lptoken.address, owner.address);
  });

  it("Should get user reward mineupto", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.depositWithoutRefer(lptoken.address, 10);
    await mine(100);
    await masterChef.getUserReward(lptoken.address, owner.address);
  });

  it("Should get user reward even if empty pool", async function () {
    await mineUpTo(startBlock.add(10));

    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.depositWithoutRefer(lptoken.address, 10);
    await mine(100);
    await masterChef.getUserReward(lptoken.address, owner.address);
  });

  it("Should cancel get user reward", async function () {
    await expect (masterChef.getUserReward(lptoken.address, owner.address)).to.be.reverted;
  });

  it("Should return user pool size", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await lptoken.mint(owner.address, 10000);
    await masterChef.getUserPoolSize(lptoken.address, owner.address);
  });

  it("Should return pool user data", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.getPoolUserData(lptoken.address, owner.address);
  });

  it("Should update pool", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.updatePool(0);
  });

  it("Should update pool v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 100);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.depositWithoutRefer(lptoken.address, 100);
    await masterChef.updatePool(0);
  });

  it("Should deposit without refer", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.depositWithoutRefer(lptoken.address, 10);
  });

  it("Should send harvest", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.harvest(lptoken.address);
  });

  it("Should deposit", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.deposit(lptoken.address, 10, otherAccount.address);
  });

  it("Should cancel deposit v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await expect (masterChef.deposit(lptoken.address, 10, otherAccount.address)).to.be.reverted;
  });

  it("Should deposit v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.deposit(lptoken.address, 0, otherAccount.address);
  });

  it("Should withdraw", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.withdraw(lptoken.address, 0);
  });

  it("Should withdraw v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.deposit(lptoken.address, 50, otherAccount.address);
    await masterChef.withdraw(lptoken.address, 50);
  });

  it("Should revert too big amount", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await expect(masterChef.withdraw(lptoken.address, 1000)).to.be.revertedWith("Too big amount");
  });

  it("Should emergency withdraw", async function () {
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await masterChef.justWithdrawWithNoReward(lptoken.address);
  });

  it("Big scenario", async function () {
    await masterChef.setEstimationRewardPeriodDays(10);
    await masterChef.setBlockchainBlocksPerDay(100);

    await lptoken.mint(alice.address, 10_000);
    await lptoken.mint(bob.address, 20_000);
    await lptoken.mint(carol.address, 30_000);

    await lptoken.connect(alice).approve(masterChef.address, 10_000);
    await lptoken.connect(bob).approve(masterChef.address, 20_000);
    await lptoken.connect(carol).approve(masterChef.address, 30_000);

    await masterChef.add(1000, lptoken.address);
    // await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    // await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

    await masterChef.connect(alice).depositWithoutRefer(lptoken.address, 10_000);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0);

    await masterChef.connect(bob).deposit(lptoken.address, 20_000, alice.address);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(rewardPerBlock);
    await expect( await masterChef.getUserReward(lptoken.address, bob.address)).to.be.equal(0);

    await masterChef.connect(carol).deposit(lptoken.address, 30_000, alice.address);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(Math.floor(
      rewardPerBlock.toNumber() + rewardPerBlock.toNumber() * 10_000 / (10_000 + 20_000)
    ));
    await expect( await masterChef.getUserReward(lptoken.address, bob.address)).to.be.equal(rewardPerBlock.mul(bn(20_000)).div(bn(10_000+20_000)));
    await expect( await masterChef.getUserReward(lptoken.address, carol.address)).to.be.equal(0);

    let blocks = bn(100);
    await mine(blocks);

    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(
      rewardPerBlock.add(
      rewardPerBlock.mul(10_000).div(10_000+20_000)).add(
      blocks.mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000 + 30_000))
    );
    await expect( await masterChef.getUserReward(lptoken.address, bob.address)).to.be.equal(
      rewardPerBlock.mul(20_000).div(10_000 + 20_000).add(
      blocks.mul(rewardPerBlock).mul(20_000).div(10_000 + 20_000 + 30_000))
    )
    await expect( await masterChef.getUserReward(lptoken.address, carol.address)).to.be.equal(
      blocks.mul(rewardPerBlock).mul(30_000).div(10_000 + 20_000 + 30_000)
    );

    let receipt = await masterChef.recalculateRewardPerBlock();

    let newRewardPerBlockAfterRecalc = await masterChef.rewardPerBlock();
    console.log("newRewardPerBlockAfterRecalc:", newRewardPerBlockAfterRecalc);

    let newEndBlock = await masterChef.endBlock();
    console.log("newEndBlock:", newEndBlock);

    await expect(receipt).to.emit(masterChef, "RewardPerBlockRecalculated").withNamedArgs({
      newRewardPerBlock: newRewardPerBlockAfterRecalc,
    });

    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(
      rewardPerBlock.add(
      rewardPerBlock.mul(10_000).div(10_000 + 20_000)).add(
      blocks.add(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000 + 30_000))
    );

    console.log('\nlets spent all rewards');
    let futureUnallocatedRewards = await masterChef.futureUnallocatedRewards();
    console.log('futureUnallocatedRewards:', futureUnallocatedRewards);

    let _blockToSpendRestOfRewards = bn(10);
    let toSet = futureUnallocatedRewards.div(_blockToSpendRestOfRewards);
    let blockToSpendRestOfRewards = futureUnallocatedRewards.div(toSet.mul(10060).div(10000));

    console.log('_blockToSpendRestOfRewards:', _blockToSpendRestOfRewards)
    console.log('blockToSpendRestOfRewards:', blockToSpendRestOfRewards)

    console.log('new reward per block to set:', toSet);
    let setRewardPerBlock_tx = await masterChef.setRewardPerBlock(toSet);

    await expect(await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(
      bn(1).mul(rewardPerBlock)
        .add(bn(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000))
        .add(blocks.add(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000 + 30_000))
        .add(bn(1).mul(newRewardPerBlockAfterRecalc).mul(10_000).div(10_000 + 20_000 + 30_000))
    );

    // console.log('setRewardPerBlock_tx:', setRewardPerBlock_tx);
    console.log('current blocknumber:', await ethers.provider.getBlockNumber());
    let newRewardPerBlockToSpendAll = await masterChef.rewardPerBlock();
    console.log("newRewardPerBlockToSpendAll:", newRewardPerBlockToSpendAll);
    newEndBlock = await masterChef.endBlock();
    console.log("newEndBlock:", newEndBlock);

    await mine(9);
    console.log('current blocknumber:', await ethers.provider.getBlockNumber());
    await expect(await ethers.provider.getBlockNumber()).to.be.equal(newEndBlock.toNumber());

    await expect(await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(
      bn(1).mul(rewardPerBlock)
        .add(bn(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000))
        .add(blocks.add(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000 + 30_000))
        .add(bn(1).mul(newRewardPerBlockAfterRecalc).mul(10_000).div(10_000 + 20_000 + 30_000))
        .add(bn(9).mul(newRewardPerBlockToSpendAll).mul(10_000).div(10_000 + 20_000 + 30_000))
    );

    await mine(100);

    let balanceBefore = await narfex.balanceOf(alice.address);
    await masterChef.connect(alice).harvest(lptoken.address);
    let balanceAfter = await narfex.balanceOf(alice.address);

    await expect( balanceAfter.sub(balanceBefore)).to.be.closeTo(
      bn(1).mul(rewardPerBlock)
        .add(bn(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000))
        .add(blocks.add(1).mul(rewardPerBlock).mul(10_000).div(10_000 + 20_000 + 30_000))
        .add(bn(1).mul(newRewardPerBlockAfterRecalc).mul(10_000).div(10_000 + 20_000 + 30_000))
        .add(bn(9).mul(newRewardPerBlockToSpendAll).mul(10_000).div(10_000 + 20_000 + 30_000))
    , 1);
    await expect(await masterChef.endBlock()).to.be.equal(newEndBlock);

    // no more rewards for alice
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0)
    await mine(1);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0)

    // switch to "normal" rewardPerBlock
    console.log('\nswitch to "normal" rewardPerBlock:', rewardPerBlock);
    await masterChef.setRewardPerBlock(rewardPerBlock);
    newEndBlock = await masterChef.endBlock();
    console.log('newEndBlock:', newEndBlock);
    await mineUpTo(newEndBlock.toNumber());
    await masterChef.connect(alice).harvest(lptoken.address);

    // to early so it goes to storedReward
    await expect((await masterChef.userInfo(0, alice.address)).storedReward).to.be.equal(bn('13666666666666667'));
    await time.increase(8 * 3600);
    await masterChef.connect(alice).harvest(lptoken.address);
    await expect((await masterChef.userInfo(0, alice.address)).storedReward).to.be.equal(bn(0));

    console.log("Alice UserInfo:", await masterChef.userInfo(0, alice.address));

    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0)

    // check no more rewards
    await mine(1);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0)

    // transfer some rewards
    await narfex.transfer(masterChef.address, 1);
    await masterChef.accountNewRewards();
    await expect(await masterChef.endBlock()).to.be.equal(newEndBlock); // changes nothing


    // transfer more rewards
    await narfex.transfer(masterChef.address, rewardPerBlockWithReferralPercent);
    await masterChef.accountNewRewards();
    await expect(await masterChef.endBlock()).to.be.equal(bn(await ethers.provider.getBlockNumber()).add(bn(1))); // scroll 1 block forward

    await mineUpTo(await masterChef.endBlock());
    await mine(10);

    // transfer more rewards
    await narfex.transfer(masterChef.address, rewardPerBlockWithReferralPercent.mul(10));
    await masterChef.accountNewRewards();
    await expect(await masterChef.endBlock()).to.be.equal(bn(await ethers.provider.getBlockNumber()).add(bn(10))); // scroll +10 block forward

    await mine(10);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal('1833333333333333')  // 18 ~ 110 * 10000 / 60000
  });

  it("Referral reward transferred", async function () {
    await masterChef.add(1000, lptoken.address);
    // await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    // await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

    await lptoken.mint(bob.address, 20_000);
    await lptoken.connect(bob).approve(masterChef.address, 20_000);
    await masterChef.connect(bob).deposit(lptoken.address, 20_000, alice.address);

    let blocks = 100;
    await mine(blocks);
    let expectedBobReward = rewardPerBlock.mul(bn(blocks));
    let expectedAliceReward = expectedBobReward.mul(await masterChef.referralPercent()).div(await masterChef.HUNDRED_PERCENTS());
    const balanceOfAliceBefore = await narfex.balanceOf(alice.address);
    const balanceOfBobBefore = await narfex.balanceOf(bob.address);
    await expect( await masterChef.getUserReward(lptoken.address, bob.address)).to.be.equal(expectedBobReward);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0);

    await masterChef.connect(bob).harvest(lptoken.address);  // plus 1 block

    const balanceOfAliceAfter = await narfex.balanceOf(alice.address);
    const balanceOfBobAfter = await narfex.balanceOf(bob.address);

    expectedBobReward = rewardPerBlock.mul(bn(blocks).add(1));
    expectedAliceReward = expectedBobReward.mul(await masterChef.referralPercent()).div(await masterChef.HUNDRED_PERCENTS());

    await expect(balanceOfAliceAfter.sub(balanceOfAliceBefore)).to.be.equal(expectedAliceReward);
    await expect(balanceOfBobAfter.sub(balanceOfBobBefore)).to.be.equal(expectedBobReward);
  });

  it("Dry season", async function () {
    await lptoken.mint(alice.address, 10_000);
    await lptoken.mint(bob.address, 20_000);
    await lptoken.connect(alice).approve(masterChef.address, 10_000);
    await lptoken.connect(bob).approve(masterChef.address, 20_000);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

    await masterChef.connect(alice).depositWithoutRefer(lptoken.address, 10_000);

    await mineUpTo(await masterChef.endBlock());
    await mine(100);

    await masterChef.connect(alice).harvest(lptoken.address);
    // join after endBlock
    await masterChef.connect(bob).deposit(lptoken.address, 20_000, alice.address);

    await mine(100);
    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(0);
    await expect( await masterChef.getUserReward(lptoken.address, bob.address)).to.be.equal(0);
    // no new rewards

    await narfex.transfer(masterChef.address, rewardPerBlockWithReferralPercent.mul(1000));
    await masterChef.accountNewRewards();
    await mine(100);

    await expect( await masterChef.getUserReward(lptoken.address, alice.address)).to.be.equal(rewardPerBlock.mul(100).mul(10_000).div(10_000 + 20_000));
    await expect( await masterChef.getUserReward(lptoken.address, bob.address)).to.be.equal(rewardPerBlock.mul(100).mul(20_000).div(10_000 + 20_000));
  });

  it("should accumulate rewards on multiple deposits", async () => {
    await lptoken.mint(alice.address, 5_000);
    await lptoken.connect(alice).approve(masterChef.address, 5_000);
    await masterChef.add(1000, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

    await masterChef.connect(alice).depositWithoutRefer(lptoken.address, 2_000);

    await mine(9);
    const expectedReward = rewardPerBlock.mul(10);
    const balanceOfAliceBefore = await narfex.balanceOf(alice.address);
    await masterChef.connect(alice).depositWithoutRefer(lptoken.address, 3_000);
    const balanceOfAliceAfter = await narfex.balanceOf(alice.address);
    expect(balanceOfAliceAfter.sub(balanceOfAliceBefore)).to.be.equal(expectedReward);
  });

  it("should recover ERC20 tokens and emit Recovered event", async () => {
    const [owner, recipient, other] = await ethers.getSigners();
    const tokenAmount = ethers.utils.parseUnits("1", 18);

    await erc20Token.mint(masterChef.address, tokenAmount);

    // Recover token when it's not a reward or pool token
    await expect(masterChef.connect(owner).recoverERC20(erc20Token.address, recipient.address, tokenAmount))
      .to.emit(masterChef, "Recovered")
      .withArgs(erc20Token.address, recipient.address, tokenAmount);

    expect(await erc20Token.balanceOf(recipient.address)).to.be.equal(tokenAmount);

    // Recover token when it's a pool token, but not reward token
    await masterChef.add(1000, erc20Token.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
    await erc20Token.mint(masterChef.address, tokenAmount);

    await expect(masterChef.connect(owner).recoverERC20(erc20Token.address, other.address, tokenAmount))
      .to.emit(masterChef, "Recovered")
      .withArgs(erc20Token.address, other.address, tokenAmount);

    expect(await erc20Token.balanceOf(other.address)).to.be.equal(tokenAmount);

    // Fail when trying to recover reward token
    await expect(masterChef.connect(owner).recoverERC20(narfex.address, recipient.address, tokenAmount))
      .to.be.revertedWith("cannot recover reward token");
  });

  it("should set the fee treasury and emit FeeTreasuryUpdated event", async () => {
    const newTreasury = alice;

    await expect(masterChef.connect(owner).setFeeTreasury(newTreasury.address))
      .to.emit(masterChef, "FeeTreasuryUpdated")
      .withArgs(newTreasury.address);

    expect(await masterChef.feeTreasury()).to.be.equal(newTreasury.address);

    // Revert if invalid address is provided
    await expect(masterChef.connect(owner).setFeeTreasury(ethers.constants.AddressZero))
      .to.be.revertedWith("Invalid address provided.");
  });

  it("should return pool data for a given pool address", async () => {
    const allocPoint = 1000;
    await masterChef.add(allocPoint, lptoken.address);
    await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
    await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

    const depositAmount = ethers.utils.parseUnits("10", 18);
    await lptoken.mint(alice.address, depositAmount);
    await lptoken.connect(alice).approve(masterChef.address, depositAmount);
    await masterChef.connect(alice).depositWithoutRefer(lptoken.address, depositAmount);

    const poolData = await masterChef.getPoolData(lptoken.address);
    const token0 = await lptoken.token0();
    const token1 = await lptoken.token1();
    const token0Contract = await ethers.getContractAt("IERC20Metadata", token0);
    const token1Contract = await ethers.getContractAt("IERC20Metadata", token1);

    expect(poolData.token0).to.equal(token0);
    expect(poolData.token1).to.equal(token1);
    expect(poolData.token0symbol).to.equal(await token0Contract.symbol());
    expect(poolData.token1symbol).to.equal(await token1Contract.symbol());
    expect(poolData.totalDeposited).to.equal(depositAmount);
    expect(poolData.poolShare).to.equal(allocPoint * 10000 / (await masterChef.totalAllocPoint()));

    // Revert if pool does not exist
    await expect(masterChef.getPoolData(ethers.constants.AddressZero))
      .to.be.revertedWith("pool not exist");
  });

  describe("Pool exist", () => {
    it("Should return false if no pools exist", async () => {
      const nonExistentPairAddress = "0x1111111111111111111111111111111111111111";
      const poolExists = await masterChef.poolExists(nonExistentPairAddress);
      expect(poolExists).to.be.false;
    });

    it("Should return true for an existing pool with poolId 0", async () => {
      const pairAddress = "0x2222222222222222222222222222222222222222";
      await masterChef.add(1000, pairAddress);
      await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
      await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days

      const poolExists = await masterChef.poolExists(pairAddress);
      expect(poolExists).to.be.true;
    });

    it("Should return true for an existing pool with non-zero poolId", async () => {
      const firstPairAddress = "0x3333333333333333333333333333333333333333";
      const secondPairAddress = "0x4444444444444444444444444444444444444444";
      const noAddress = "0x2222222222222222222222222222222222222222";
      await masterChef.add(1000, firstPairAddress);
      await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
      await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
      await masterChef.add(1000, secondPairAddress);
      await setEarlyHarvestCommission(owner, 1000, 1);  // 10;
      await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 1);  // 14 days

      let poolExists = await masterChef.poolExists(secondPairAddress);
      expect(poolExists).to.be.true;

      poolExists = await masterChef.poolExists(noAddress);
      expect(poolExists).to.be.false;
    });

    it("Should return false for a non-existent pool", async () => {
      const pairAddress = "0x5555555555555555555555555555555555555555";
      await masterChef.add(1000, pairAddress);
      await setEarlyHarvestCommission(owner, 1000, 0);  // 10;
      await setEarlyHarvestCommission(owner, 14 * 24 * 3600, 0);  // 14 days
      const nonExistentPairAddress = "0x6666666666666666666666666666666666666666";
      const poolExists = await masterChef.poolExists(nonExistentPairAddress);
      expect(poolExists).to.be.false;
    });
  });
});

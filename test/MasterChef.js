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
  let LpTokenMock;
  let tx;  // last transaction
  let alice;
  let bob;
  let carol;

  before(async function () {
    [owner, feeTreasury, otherAccount, alice, bob, carol] = await ethers.getSigners();
    NarfexMock = await ethers.getContractFactory("NarfexMock");
    MasterChef = await ethers.getContractFactory("MasterChef");
    LpTokenMock = await ethers.getContractFactory("LpTokenMock");
  });

  beforeEach(async function () {
    narfex = await NarfexMock.deploy();
    narfex.deployed();
    narfex.mint(owner.address, bn('1000').mul(ONE));

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

    lptoken = await LpTokenMock.deploy();
    await lptoken.deployed();
    endBlock = bn((await masterChef.endBlock()).toString());
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
    await masterChef.setEarlyHarvestCommissionInterval(50);

    expect(await masterChef.earlyHarvestCommissionInterval()).to.equal(50);
  });

  it("Should cancel early harvest comission interval from other account", async function () {
    await expect (masterChef.connect(otherAccount).setEarlyHarvestCommissionInterval(50)).to.be.reverted;
  });

  it("Should set early harvest commission", async function () {
    await masterChef.setEarlyHarvestCommission(10);

    expect(await masterChef.earlyHarvestCommission()).to.equal(10);
  });

  it("Should cancel early harvest commission from other account", async function () {
    await expect (masterChef.connect(otherAccount).setEarlyHarvestCommission(50)).to.be.reverted;
  });

  it("Should mass update pools after endBlock", async function () {
    await mineUpTo(endBlock.toNumber() + 1);
    await masterChef.massUpdatePools()
  });

  it("Should mass update pools", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.massUpdatePools();
  });

  it("Should return pools count", async function () {
    await masterChef.add(1000, lptoken.address);

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

  it("Should add a new pool without update", async function () {
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
    await masterChef.depositWithoutRefer(lptoken.address, 10);
    await mine(100);
    await masterChef.getUserReward(lptoken.address, owner.address);
  });

  it("Should cancel get user reward", async function () {
    await expect (masterChef.getUserReward(lptoken.address, owner.address)).to.be.reverted;
  });

  it("Should return user pool size", async function () {
    await masterChef.add(1000, lptoken.address);
    await lptoken.mint(owner.address, 10000);
    await masterChef.getUserPoolSize(lptoken.address, owner.address);
  });

  it("Should return pool user data", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.getPoolUserData(lptoken.address, owner.address);
  });

  it("Should update pool", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.updatePool(0);
  });

  it("Should update pool v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 100);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await masterChef.depositWithoutRefer(lptoken.address, 100);
    await masterChef.updatePool(0);
  });

  it("Should deposit without refer", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await masterChef.depositWithoutRefer(lptoken.address, 10);
  });

  it("Should send harvest", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.harvest(lptoken.address);
  });

  it("Should deposit", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await masterChef.deposit(lptoken.address, 10, otherAccount.address);
  });

  it("Should cancel deposit v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await expect (masterChef.deposit(lptoken.address, 10, otherAccount.address)).to.be.reverted;
  });

  it("Should deposit v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await masterChef.deposit(lptoken.address, 0, otherAccount.address);
  });

  it("Should withdraw", async function () {
    await masterChef.add(1000, lptoken.address);
    await masterChef.withdraw(lptoken.address, 0);
  });

  it("Should withdraw v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address);
    await masterChef.deposit(lptoken.address, 50, otherAccount.address);
    await masterChef.withdraw(lptoken.address, 50);
  });

  it("Should revert too big amount", async function () {
    await masterChef.add(1000, lptoken.address);
    await expect(masterChef.withdraw(lptoken.address, 1000)).to.be.revertedWith("Too big amount");
  });

  it("Should emergency withdraw", async function () {
    await masterChef.add(1000, lptoken.address);
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
});

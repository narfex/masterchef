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
  // initialized in beforeEach
  let narfex;
  let masterChef;
  let rewardPerBlock;
  let rewardBalance;
  let startBlock;
  let endBlock;
  let owner;
  let otherAccount;
  let lptoken;
  let NarfexMock;
  let MasterChef;
  let LpTokenMock;
  let tx;  // last transaction

  before(async function () {
    [owner, otherAccount] = await ethers.getSigners();
    NarfexMock = await ethers.getContractFactory("NarfexMock");
    MasterChef = await ethers.getContractFactory("MasterChef");
    LpTokenMock = await ethers.getContractFactory("LpTokenMock");
  });

  beforeEach(async function () {
    narfex = await NarfexMock.deploy();
    narfex.deployed();
    narfex.mint(owner.address, bn('10').pow(bn('18')));

    rewardPerBlock = bn('10');
    masterChef = await MasterChef.deploy(narfex.address, rewardPerBlock);
    await masterChef.deployed();

    rewardBalance = bn('100000');
    await narfex.transfer(masterChef.address, rewardBalance.toString());
    tx = await masterChef.accountNewRewards();
    startBlock = bn((await masterChef.startBlock()).toString());
    const expectedEndBlock = startBlock.add(rewardBalance.div(rewardPerBlock))
    await expect(tx).to.emit(masterChef, 'NewRewardsAccounted').withNamedArgs({
      newRewardsAmount: rewardBalance,
      newEndBlock: expectedEndBlock.toString(),
      newRestUnallocatedRewards: bn('0'),
      newLastRewardTokenBalance: rewardBalance,
      afterEndBlock: false,
    })
    expect(await masterChef.endBlock()).equal(expectedEndBlock.toString());
    expect(await masterChef.restUnallocatedRewards()).equal('0');

    lptoken = await LpTokenMock.deploy();
    await lptoken.deployed();
    endBlock = bn((await masterChef.endBlock()).toString());
  });

    it("Account no new incoming rewards", async function () {
      tx = await masterChef.accountNewRewards();
      await expect(tx).to.emit(masterChef, 'NoNewRewardsAccounted');
    });

  it("Account new incoming rewards before endBlock", async function () {
    const newRewardsAmount = bn('105');  // should give another 10 blocks + 5 as a rest
    await narfex.transfer(masterChef.address, newRewardsAmount);
    tx = await masterChef.accountNewRewards();
    await expect(tx).to.emit(masterChef, 'NewRewardsAccounted').withNamedArgs({
      newRewardsAmount: newRewardsAmount,
      newEndBlock: endBlock.add(bn('10')).toString(),
      newRestUnallocatedRewards: bn('5'),
      newLastRewardTokenBalance: rewardBalance.add(newRewardsAmount),
      afterEndBlock: false,
    })
    expect(await masterChef.endBlock()).equal(endBlock.add(bn(10)));
    expect(await masterChef.restUnallocatedRewards()).equal('5');
  });

  it("Account new incoming rewards after endBlock", async function () {
    mineUpTo(endBlock.toNumber() + 1);
    const newRewardsAmount = bn('105');  // should give another 10 blocks + 5 as a rest
    await narfex.transfer(masterChef.address, newRewardsAmount);
    tx = await masterChef.accountNewRewards();
    await expect(tx).to.emit(masterChef, 'NewRewardsAccounted').withNamedArgs({
      newRewardsAmount: newRewardsAmount,
      newEndBlock: endBlock,
      newRestUnallocatedRewards: bn('105'),
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

  it("Should set referral percent", async function () {
    await masterChef.setReferralPercent(5);

    expect(await masterChef.referralPercent()).to.equal(5);
  });

  it("Should cancel referral percent from other account", async function () {
    await expect (masterChef.connect(otherAccount).setReferralPercent(5)).to.be.reverted;
  });

  it("Should not mass update pools after endBlock", async function () {
    await mineUpTo(endBlock.toNumber() + 1);
    await expect(masterChef.add(1000, lptoken.address, 0)).to.be.revertedWith('endBlock passed');
  });

  it("Should mass update pools", async function () {
    await masterChef.add(1000, lptoken.address, 0);
    await masterChef.massUpdatePools();
  });

  it("Should return pools count", async function () {
    await masterChef.add(1000, lptoken.address, 1);

    await masterChef.getPoolsCount();
    expect(await masterChef.getPoolsCount()).to.equal(1);
  });

  it("Should return balance of narfex", async function () {
    const narfexLeft = await masterChef.getNarfexLeft();
    expect(narfexLeft).to.equal(rewardBalance);
  });

  it("Should withdraw narfex before endBlock", async function () {
    await mineUpTo(endBlock.sub(10).toNumber());
    await masterChef.withdrawNarfexByOwner(10);
  });

  // it("Should withdraw narfex after endBlock", async function () {
  //   await mineUpTo(endBlock.add(10).toNumber());
  //   await masterChef.withdrawNarfexByOwner(1);
  // });

  it("Should cancel withdraw narfex from other account", async function () {
    await expect (masterChef.connect(otherAccount).withdrawNarfexByOwner(10)).to.be.reverted;
  });

  it("Should not add same pool twice", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await expect(masterChef.add(1000, lptoken.address, 1)).to.be.revertedWith('already exists');
  });

  it("Should cancel a new pool from other account", async function () {
    await lptoken.mint(owner.address,100000);
    await expect (masterChef.connect(otherAccount).add(1000, lptoken.address, 1)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("Should add a new pool", async function () {
    await lptoken.mint(owner.address,100000);
    await masterChef.add(1000, lptoken.address, 1);
  });

  it("Should add a new pool without update", async function () {
    await lptoken.mint(owner.address,100000);
    await masterChef.add(1000, lptoken.address, 0);
  });

  it("Should set reward per block", async function () {
    await masterChef.setRewardPerBlock(100);
    expect(await masterChef.rewardPerBlock()).to.equal(100);
  });

  it("Should cancel reward per block from other account", async function () {
    await expect (masterChef.connect(otherAccount).setRewardPerBlock(100)).to.be.reverted;
  });

  it("Should return settings", async function () {
    await masterChef.add(1000, lptoken.address, 0);
    await masterChef.setRewardPerBlock(100);
    expect(await masterChef.rewardPerBlock()).to.equal(100);

    await masterChef.getSettings();
    assert.equal(60*60*24*14, 60*60*24*14, 60*60*8, 1000, 60);
  });

  it("Should set allocPoint for pool", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.set(0, 500, 1);
  });

  it("Should set allocPoint for pool without update", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.set(0, 500, 0);
  });

  it("Should cancel allocPoint for pool from other account", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await expect (masterChef.connect(otherAccount).set(0, 500, 1)).to.be.reverted;;
  });

  it("Should get user reward", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.getUserReward(lptoken.address, owner.address);
  });

  it("Should get user reward mineupto", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.depositWithoutRefer(lptoken.address, 10);
    await mine(100);
    await masterChef.getUserReward(lptoken.address, owner.address);
  });

  it("Should cancer get user reward", async function () {
    await expect (masterChef.getUserReward(lptoken.address, owner.address)).to.be.reverted;
  });

  it("Should return user pool size", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await lptoken.mint(owner.address, 10000);
    await masterChef.getUserPoolSize(lptoken.address, owner.address);
  });

  it("Should return pool user data", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.getPoolUserData(lptoken.address, owner.address);
  });

  it("Should update pool", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.updatePool(0);
  });

  it("Should update pool v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 100);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.depositWithoutRefer(lptoken.address, 100);
    await masterChef.updatePool(0);
  });

  it("Should deposit without refer", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.depositWithoutRefer(lptoken.address, 10);
  });

  it("Should send harvest", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.harvest(lptoken.address);
  });

  it("Should deposit", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.deposit(lptoken.address, 10, otherAccount.address);
  });

  it("Should cancel deposit v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await expect (masterChef.deposit(lptoken.address, 10, otherAccount.address)).to.be.reverted;
  });

  it("Should deposit v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.deposit(lptoken.address, 0, otherAccount.address);
  });

  it("Should withdraw", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.withdraw(lptoken.address, 0);
  });

  it("Should withdraw v2", async function () {
    await lptoken.allowance(owner.address, masterChef.address);
    await lptoken.approve(masterChef.address, 90);
    await lptoken.mint(owner.address, 100);
    await lptoken.mint(otherAccount.address, 100);
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.deposit(lptoken.address, 50, otherAccount.address);
    await masterChef.withdraw(lptoken.address, 50);
  });

  it("Should revert too big amount", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await expect(masterChef.withdraw(lptoken.address, 1000)).to.be.revertedWith("Too big amount");
  });

  it("Should emergency withdraw", async function () {
    await masterChef.add(1000, lptoken.address, 1);
    await masterChef.emergencyWithdraw(lptoken.address);
  });
});

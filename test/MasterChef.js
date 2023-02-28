const {
    time,
    helpers,
    loadFixture,
  } = require("@nomicfoundation/hardhat-network-helpers");
  const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
  const { expect } = require("chai");
  const assert = require('assert');
  const { ethers } = require("hardhat");
  const { mineUpTo } = require("@nomicfoundation/hardhat-network-helpers");

  describe("MasterChef", function () {
    async function deployMasterChef() {
      // Contracts are deployed using the first signer/account by default
      const [owner, otherAccount] = await ethers.getSigners();
  
      const NarfexMock = await ethers.getContractFactory("NarfexMock");
      const narfex = await NarfexMock.deploy();
      await narfex.deployed();
    
      const MasterChef = await ethers.getContractFactory("MasterChef");
      const masterChef = await MasterChef.deploy(narfex.address, 10);
      await masterChef.deployed();

      const LpTokenMock = await ethers.getContractFactory("LpTokenMock");
      const lptoken = await LpTokenMock.deploy();
      await lptoken.deployed();
    
        return { masterChef, narfex, lptoken, owner, otherAccount };
      };


    describe("All tests", function () {
        it("Should set harvest interval", async function () {
        const { masterChef, narfex, owner, lptoken } = await loadFixture(deployMasterChef);

          await narfex.mint(owner.address, 100);
          await narfex.allowance(owner.address, lptoken.address);
          await narfex.approve(lptoken.address, 90);

          await masterChef.setHarvestInterval(3600);

          expect(await masterChef.harvestInterval()).to.equal(3600);
        });

        it("Should cancel harvest interval from other account", async function () {
        const { masterChef, narfex, owner, lptoken, otherAccount } = await loadFixture(deployMasterChef);

          await narfex.mint(owner.address, 100);
          await narfex.allowance(owner.address, lptoken.address);
          await narfex.approve(lptoken.address, 90);
          await expect (masterChef.connect(otherAccount).setHarvestInterval(3600)).to.be.reverted;
        });

        it("Should set early harvest comission interval", async function () {
          const { masterChef } = await loadFixture(deployMasterChef);
  
            await masterChef.setEarlyHarvestCommissionInterval(50);
  
            expect(await masterChef.earlyHarvestCommissionInterval()).to.equal(50);
          });

        it("Should cancel early harvest comission interval from other account", async function () {
          const { masterChef, otherAccount } = await loadFixture(deployMasterChef);
            await expect (masterChef.connect(otherAccount).setEarlyHarvestCommissionInterval(50)).to.be.reverted;
          });

        it("Should set early harvest commission", async function () {
            const { masterChef } = await loadFixture(deployMasterChef);
    
              await masterChef.setEarlyHarvestCommission(10);
    
              expect(await masterChef.earlyHarvestCommission()).to.equal(10);
            });

        it("Should cancel early harvest commission from other account", async function () {
            const { masterChef, otherAccount } = await loadFixture(deployMasterChef);
            await expect (masterChef.connect(otherAccount).setEarlyHarvestCommission(50)).to.be.reverted;
            });

        it("Should set referral percent", async function () {
            const { masterChef } = await loadFixture(deployMasterChef);

              await masterChef.setReferralPercent(5);

          expect(await masterChef.referralPercent()).to.equal(5);
        });

        it("Should cancel referral percent from other account", async function () {
            const { masterChef, otherAccount } = await loadFixture(deployMasterChef);
            await expect (masterChef.connect(otherAccount).setReferralPercent(5)).to.be.reverted;
        });

        it("Should mass update pools", async function () {
            const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
            await masterChef.add(1000, lptoken.address, 0);
    
              await masterChef.massUpdatePools();
            });

        it("Should return pools count", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
    
              await masterChef.getPoolsCount();
              expect(await masterChef.getPoolsCount()).to.equal(1);
            });

        it("Should return balance of narfex", async function () {
            const { masterChef } = await loadFixture(deployMasterChef);
    
              await masterChef.getNarfexLeft();
              expect(await masterChef.getNarfexLeft()).to.equal(0);
            });
        it("Should withdraw narfex", async function () {
            const { masterChef } = await loadFixture(deployMasterChef);
    
              await masterChef.withdrawNarfex(0);
            });

        it("Should cancel withdraw narfex from other account", async function () {
            const { masterChef, otherAccount } = await loadFixture(deployMasterChef);
              await expect (masterChef.connect(otherAccount).withdrawNarfex(0)).to.be.reverted;
            });

        it("Should cancel a new pool from other account", async function () {
            const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
            await lptoken.mint(owner.address,100000);
            await expect (masterChef.connect(otherAccount).add(1000, lptoken.address, 1)).to.be.reverted;
          });

        it("Should add a new pool", async function () {
            const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
            await lptoken.mint(owner.address,100000);

            await masterChef.add(1000, lptoken.address, 1);
          });

        it("Should add a new pool without update", async function () {
            const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
            await lptoken.mint(owner.address,100000);

            await masterChef.add(1000, lptoken.address, 0);
          });

        it("Should set reward per block", async function () {
            const { masterChef } = await loadFixture(deployMasterChef);
    
              await masterChef.setRewardPerBlock(100, 1);
              expect(await masterChef.rewardPerBlock()).to.equal(100);
            });

        it("Should cancel reward per block from other account", async function () {
            const { masterChef, otherAccount } = await loadFixture(deployMasterChef);
              await expect (masterChef.connect(otherAccount).setRewardPerBlock(100, 1)).to.be.reverted;
            });

        it("Should set reward per block without update", async function () {
            const { masterChef } = await loadFixture(deployMasterChef);
    
              await masterChef.setRewardPerBlock(100, 0);
              expect(await masterChef.rewardPerBlock()).to.equal(100);
            });

        it("Should return settings", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 0);

          await masterChef.setRewardPerBlock(100, 1);
          expect(await masterChef.rewardPerBlock()).to.equal(100);

          await masterChef.getSettings();
          assert.equal(60*60*24*14, 60*60*24*14, 60*60*8, 1000, 60);
        });

        it("Should set allocPoint for pool", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.set(0, 500, 1);
          });

        it("Should set allocPoint for pool without update", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.set(0, 500, 0);
          });
          
        it("Should cancel allocPoint for pool from other account", async function () {
          const { masterChef, lptoken, otherAccount } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await expect (masterChef.connect(otherAccount).set(0, 500, 1)).to.be.reverted;;
          });

        it("Should get user reward", async function () {
          const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.getUserReward(lptoken.address, owner.address);
            });

        it("Should get user reward mineupto", async function () {
          const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 90);
          await lptoken.mint(owner.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.depositWithoutRefer(lptoken.address, 10);
          await mineUpTo(10000);
          await masterChef.getUserReward(lptoken.address, owner.address);
            });

        it("Should cancer get user reward", async function () {
          const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
          await expect (masterChef.getUserReward(lptoken.address, owner.address)).to.be.reverted;
            });

        it("Should return user pool size", async function () {
          const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await lptoken.mint(owner.address, 10000);
          await masterChef.getUserPoolSize(lptoken.address, owner.address);
            });

        it("Should return pool user data", async function () {
          const { masterChef, lptoken, owner } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.getPoolUserData(lptoken.address, owner.address);
            });

        it("Should update pool", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.updatePool(0);
            });

        it("Should update pool v2", async function () {
          const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 100);
          await lptoken.mint(owner.address, 100);
          await lptoken.mint(otherAccount.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.depositWithoutRefer(lptoken.address, 100);
          await masterChef.updatePool(0);
            });

        it("Should deposit without refer", async function () {
          const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 90);
          await lptoken.mint(owner.address, 100);
          await lptoken.mint(otherAccount.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.depositWithoutRefer(lptoken.address, 10);
            });

        it("Should send harvest", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.harvest(lptoken.address);
            });

        it("Should deposit", async function () {
          const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 90);
          await lptoken.mint(owner.address, 100);
          await lptoken.mint(otherAccount.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.deposit(lptoken.address, 10, otherAccount.address);
            });

        it("Should cancel deposit v2", async function () {
          const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 90);
          await lptoken.mint(otherAccount.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await expect (masterChef.deposit(lptoken.address, 10, otherAccount.address)).to.be.reverted;
            });

        it("Should deposit v2", async function () {
          const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 90);
          await lptoken.mint(owner.address, 100);
          await lptoken.mint(otherAccount.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.deposit(lptoken.address, 0, otherAccount.address);
          });

        it("Should withdraw", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.withdraw(lptoken.address, 0);
            });

        it("Should withdraw v2", async function () {
          const { masterChef, lptoken, owner, otherAccount } = await loadFixture(deployMasterChef);
          await lptoken.allowance(owner.address, masterChef.address);
          await lptoken.approve(masterChef.address, 90);
          await lptoken.mint(owner.address, 100);
          await lptoken.mint(otherAccount.address, 100);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.deposit(lptoken.address, 50, otherAccount.address);
          await masterChef.withdraw(lptoken.address, 50);
            });

        it("Should revert too big amount", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await expect(masterChef.withdraw(lptoken.address, 1000)).to.be.revertedWith("Too big amount");
            });  

        it("Should emergency withdraw", async function () {
          const { masterChef, lptoken } = await loadFixture(deployMasterChef);
          await masterChef.add(1000, lptoken.address, 1);
          await masterChef.emergencyWithdraw(lptoken.address);
            });
    });
});
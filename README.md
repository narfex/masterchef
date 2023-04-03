# MasterChef

Farming contract for minted Narfex Token.
Distributes a reward from the balance instead of minting it.

## Install Dependencies

`npm i`

## Compile

`npm run compile`

## Prepare account before deploy

Create a file names 'accounts.js' with the following contents
to the one level above the project directory

`
module.exports = {
	bsc: {
		address: 'your_wallet_address',
		privateKey: 'your_wallet_private_key'
	},
	bscscan: 'your_bscscan_api_key',
};
`

## Deploy to BSC

`npm run deployBSC`

## Verify

`npx hardhat verify --network bsc --constructor-args arguments.js "your_contract_address"`

## Human Readable explanations of MasterChef

MasterChef is a smart contract that allows users to deposit and withdraw LP tokens.
It also allows users to earn rewards in the form of NRFX token.
The rewards are distributed among stakers.

### State


### Functions

#### deposit
	- accountNewRewards
						~lastRewardTokenBalance = currentBalance;
						if ((block.number > endBlock) && (startBlock != endBlock)) {
							~restUnallocatedRewards = newRewardsToAccount;
							return;
						}
						uint256 deltaBlocks = newRewardsToAccount / rewardPerBlock;
						~endBlock += deltaBlocks;
						~restUnallocatedRewards = newRewardsToAccount - deltaBlocks * rewardPerBlock;

	- _updatePool
						if (block.number <= pool.lastRewardBlock) {
							return;
						}
						uint256 lpSupply = pool.totalDeposited;
						uint256 rightBlock = Math.min(block.number, endBlock);
						if (rightBlock <= pool.lastRewardBlock) {
						   pool.lastRewardBlock = block.number;
						   return;
						}
						uint256 blocks = rightBlock - pool.lastRewardBlock;
						uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
						pool.accRewardPerShare += reward * ACC_REWARD_PRECISION / lpSupply;
						pool.lastRewardBlock = block.number;

	- _rewardTransfer
						if (isEarlyHarvest) {
							user.storedReward = _amount;
						} else {
							uint amount = isWithdraw && isEarlyHarvestCommission
								? _amount * (HUNDRED_PERCENTS - earlyHarvestCommission) / HUNDRED_PERCENTS
								: _amount;
							uint narfexLeft = getNarfexBalance();
							if (narfexLeft < amount) {
								amount = narfexLeft;
							}
							if (amount > 0) {
								rewardToken.safeTransfer(msg.sender, amount);
								emit Harvest(msg.sender, _pid, amount);
								/// Send referral reward
								address referral = referrals[msg.sender];
								if (referral != address(0)) {
									amount = amount * referralPercent / HUNDRED_PERCENTS;
									narfexLeft = getNarfexBalance();
									if (narfexLeft < amount) {
										amount = narfexLeft;
									}
									if (amount > 0) {
										rewardToken.safeTransfer(referral, amount);
										emit ReferralRewardPaid(referral, amount);
									}
								}
							}
							user.storedReward = 0;
							user.harvestTimestamp = block.timestamp;
						}

	~user.amount += _amount;
	~user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;
	~user.depositTimestamp = block.timestamp;

#### withdraw
	- accountNewRewards();
						~lastRewardTokenBalance = currentBalance;
						if ((block.number > endBlock) && (startBlock != endBlock)) {
							~restUnallocatedRewards = newRewardsToAccount;
							return;
						}
						uint256 deltaBlocks = newRewardsToAccount / rewardPerBlock;
						~endBlock += deltaBlocks;
						~restUnallocatedRewards = newRewardsToAccount - deltaBlocks * rewardPerBlock;

	- _updatePool(_pid);
						if (block.number <= pool.lastRewardBlock) {
							return;
						}
						uint256 lpSupply = pool.totalDeposited;
						uint256 rightBlock = block.number > endBlock ? endBlock : block.number;
						if (rightBlock <= pool.lastRewardBlock) {
						   pool.lastRewardBlock = block.number;
						   return;
						}	
						uint256 blocks = rightBlock - pool.lastRewardBlock;
						uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
						pool.accRewardPerShare += reward * ACC_REWARD_PRECISION / lpSupply;
						pool.lastRewardBlock = block.number;


	- _harvest(_pairAddress);
				_updatePool(_pid);
				uint256 pending = _calculateUserReward(user, pool.accRewardPerShare);
				if (pending > 0) {
					_rewardTransfer({user: user, _amount: pending, isWithdraw: true, _pid: _pid});
				}
				user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;

	uint256 pending = _calculateUserReward(user, pool.accRewardPerShare);
	_rewardTransfer({user: user, _amount: pending, isWithdraw: true, _pid: _pid});
	user.amount -= _amount;
	pool.pairToken.safeTransfer(address(msg.sender), _amount);
	user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;


#### recalculateRewardPerBlock
        uint256 _futureUnallocatedRewards = futureUnallocatedRewards();
        uint256 newRewardPerBlock = _futureUnallocatedRewards / (estimationRewardPeriodDays * blockchainBlocksPerDay);
        
		_setRewardPerBlock(newRewardPerBlock);
					        uint256 oldRewardPerBlock = rewardPerBlock;

							_massUpdatePools();
							accountNewRewards();
							rewardPerBlock = _amount;
							emit RewardPerBlockSet(_amount);
					
							// endBlock = currentBlock + unallocatedRewards / rewardPerBlock
							// so now we should update the endBlock since rewardPerBlock was changed
							uint256 futureRewards = (endBlock - block.number) * oldRewardPerBlock + restUnallocatedRewards;
							uint256 deltaBlocks = futureRewards / rewardPerBlock;
							endBlock += deltaBlocks;
							restUnallocatedRewards = futureRewards - deltaBlocks * rewardPerBlock;

#### setRewardPerBlock
        uint256 oldRewardPerBlock = rewardPerBlock;

        _massUpdatePools();
        accountNewRewards();
        rewardPerBlock = _amount;
        emit RewardPerBlockSet(_amount);

        // endBlock = currentBlock + unallocatedRewards / rewardPerBlock
        // so now we should update the endBlock since rewardPerBlock was changed
        uint256 futureRewards = (endBlock - block.number) * oldRewardPerBlock + restUnallocatedRewards;
        uint256 deltaBlocks = futureRewards / rewardPerBlock;
        endBlock += deltaBlocks;
        restUnallocatedRewards = futureRewards - deltaBlocks * rewardPerBlock;

#### futureUnallocatedRewards
        if (block.number >= endBlock) {
            return restUnallocatedRewards;
        } else {
            uint256 futureBlocks = endBlock - block.number;
            return rewardPerBlock * futureBlocks + restUnallocatedRewards;
        }

#### accountNewRewards
        if ((block.number > endBlock) && (startBlock != endBlock)) {
            restUnallocatedRewards = newRewardsToAccount;
            return;
        }
        uint256 deltaBlocks = newRewardsToAccount / rewardPerBlock;
        endBlock += deltaBlocks;
        restUnallocatedRewards = newRewardsToAccount - deltaBlocks * rewardPerBlock;
		lastRewardTokenBalance = currentBalance;

#### emergencyWithdraw
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.pairToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        user.amount = 0;
        user.withdrawnReward = 0;
        user.storedReward = 0;

#### withdrawNarfexByOwner
        accountNewRewards();

        // Calculate the remaining rewards
        uint256 _futureUnallocatedRewards = futureUnallocatedRewards();
        require(amount <= _futureUnallocatedRewards, "not enough unallocated rewards");
        
        // Calculate the new unallocated rewards after the withdrawal
        uint256 newUnallocatedRewards = _futureUnallocatedRewards - amount;
        
        // Update the end block and remaining unallocated rewards
        (endBlock, restUnallocatedRewards) = calculateFutureRewardAllocationWithArgs(newUnallocatedRewards, rewardPerBlock);
        
        // Emit events for the updated end block and withdrawn amount
        emit EndBlockRecalculatedBecauseOfOwnerWithdraw(endBlock, restUnallocatedRewards);
        emit WithdrawNarfexByOwner(msg.sender, amount);
        
        // Transfer the withdrawn amount to the contract owner's address
        rewardToken.safeTransfer(address(msg.sender), amount);


#### massUpdatePools
	for loop update updatePool

#### updatePool
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.totalDeposited;
        if (lpSupply == 0) {
            // WARNING: always keep some small deposit in every pool
            // there could be a small problem if no one will deposit in the pool with e.g. 30% allocation point
            // then the reward for this 30% alloc points will never be distributed
            // however endBlock is already set, so no one will harvest the.
            // But fixing this problem with math would increase complexity of the code.
            // So just let the owner to keep 1 lp token in every pool to mitigate this problem.
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 rightBlock = Math.min(block.number, endBlock);
        if (rightBlock <= pool.lastRewardBlock) {
           pool.lastRewardBlock = block.number;
           return;  // after endBlock passed we continue to scroll lastRewardBlock with no update of accRewardPerShare
        }
        uint256 blocks = rightBlock - pool.lastRewardBlock;
        uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
        pool.accRewardPerShare += reward * ACC_REWARD_PRECISION / lpSupply;
        pool.lastRewardBlock = block.number;

#### harvest
				- _updatePool(_pid);

				uint256 pending = _calculateUserReward(user, pool.accRewardPerShare);
				if (pending > 0) {
					_rewardTransfer({user: user, _amount: pending, isWithdraw: true, _pid: _pid});
				}
				user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;


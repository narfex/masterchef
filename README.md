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

### Functions

#### deposit
	put deposit

	- accountNewRewards()
	- _updatePool()
	- _harvest()

	~user.amount += _amount;
	~user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;
	~user.depositTimestamp = block.timestamp;

#### withdraw
	withdraw deposit

	- accountNewRewards()
	- _updatePool(_pid)
	- _harvest(_pairAddress)

	user.amount -= _amount;
	pool.pairToken.safeTransfer(address(msg.sender), _amount);
	user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;


#### recalculateRewardPerBlock
	RECALCULATION of rewardPerBlock based on the remaining undistributed rewards so that they would last for 100 days, for example.
	recalculateRewardPerBlock, unlike setReward, can be called from a special account updater.
	Because of this, on the backend that will trigger it once an hour, you don't need to store the owner's private key.
	Losing the updater's private key is not a big deal since the formula is hardcoded.

#### setRewardPerBlock
	update rewardPerBlock and recalculate endBlock

        _massUpdatePools();
        accountNewRewards();

#### futureUnallocatedRewards
	view method for unallocated future rewards

#### accountNewRewards
	Accounting for received rewards
	A subtle point - if there was a "dry" period after the endBlock when there were no accruals,
	the function sets lastRewardBlock=blocknumber and starts a new "reward" period,
	setting the endblock.

#### emergencyWithdraw
Called in case a user wants to urgently withdraw their tokens
Rewards are not accrued
It is assumed that no one will call it in a normal situation

#### withdrawNarfexByOwner
	owner can withdraw future unaccounted rewards to his account (by updating endBlock)


#### massUpdatePools
	for loop update updatePool

#### updatePool
	
#### harvest
	collection of rewards for the user



### Key States, Attributes, and Block Data Analysis

#### 1. deposit(_pairAddress, _amount, _referral)
- Impact on contract state:
  - Updates userInfo state (amount, withdrawnReward, depositTimestamp).
  - Updates poolInfo state (totalDeposited).
  - Sets or updates referral relationship between addresses.
- Internal calls:
  - _accountNewRewards()
  - _updatePool(_pid)
  - _rewardTransfer()
- Token impact:
  - Transfers LP tokens from msg.sender to the contract.
  - Pays out NRFX token rewards to the user and referrer or feeTreasury.

#### 2. withdraw(_pairAddress, _amount)
- Impact on contract state:
  - Updates userInfo state (amount, withdrawnReward).
  - Updates poolInfo state (totalDeposited).
- Internal calls:
  - _accountNewRewards()
  - _updatePool(_pid)
  - _harvest(_pairAddress)
- Token impact:
  - Returns LP tokens to the user.
  - Pays out NRFX token rewards to the user and referrer or feeTreasury.

#### 3. harvest(_pairAddress)
- Impact on contract state:
  - Updates userInfo state (withdrawnReward, storedReward, harvestTimestamp).
- Internal calls:
  - _harvest(_pairAddress)
- Token impact:
  - Pays out NRFX token rewards to the user and referrer or feeTreasury.

#### 4. setRewardPerBlock(_amount)
- Impact on contract state:
  - Updates rewardPerBlock and endBlock values.
- Internal calls:
  - _setRewardPerBlock(newRewardPerBlock)
  - _accountNewRewards()
  - _massUpdatePools()
- Token impact: none.

#### 5. massUpdatePools()
- Impact on contract state:
  - Updates the state of all pools.
- Internal calls:
  - _accountNewRewards()
  - _massUpdatePools()
- Token impact: none.

#### 6. updatePool(_pid)
- Impact on contract state:
  - Updates the state of the pool with the given _pid.
- Internal calls:
  - _accountNewRewards()
  - _updatePool(_pid)
  - _rewardTransfer()
- Token impact: none.

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


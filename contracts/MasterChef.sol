// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12 <0.9.0;

import "./ReentrancyGuard.sol";
import "./Ownable.sol";
import "./SafeBEP20.sol";
import "./BEP20.sol";
import "./IPancakePair.sol";

/// @title Farming contract for minted Narfex Token
/// @author Danil Sakhinov
/// @notice Distributes a reward from the balance instead of minting it
contract MasterChef is Ownable, ReentrancyGuard {
    using SafeBEP20 for IBEP20;

    // User share of a pool
    struct UserPool {
        uint256 amount; // Amount of LP tokens
        uint startBlockIndex; // Block index when farming started
        uint lastHarvestBlock; // Block number of last harvest
        uint storedReward; // Harvested reward delayed until the transaction is unlocked
        uint depositTimestamp; // Timestamp of deposit
        uint harvestTimestamp; // Timestamp of last harvest
    }

    struct Pool {
        IBEP20 token; // LP token
        mapping (address => UserPool) users; // Holder share info
        uint[] blocks; // Blocks during which the size of the pool has changed
        mapping (uint => uint) sizes; // Pool sizes during each block
        uint rewardPerBlock; // Reward for each block in this pool
        bool isExists; // Is pool allowed by owner
    }

    // Reward to harvest
    IBEP20 public rewardToken;
    // Default reward size for new pools
    uint public defaultRewardPerBlock = 1 * 10**18; // 1 wei
    // The interval from the deposit in which the commission for the reward will be taken.
    uint public commissionInterval = 14 days;
    // Interval since last harvest when next harvest is not possible
    uint public harvestInterval = 8 hours;
    // Commission for to early harvests in % (50 is 50%) based on commissionInterval
    uint public earlyHarvestCommission = 10;
    // Whether to cancel the reward for early withdrawal
    bool public isUnrewardEarlyWithdrawals = false;
    // Interval after deposit in which all rewards will be canceled
    uint public rewardCancelInterval = 14 days;
    // Referral percent for reward
    uint public referralPercent = 5;

    // Pools data
    mapping (address => Pool) public pools;
    // Pools list by addresses
    address[] public poolsList;
    // Pools count
    uint public poolsCount;
    // Address of the agents who invited the users (refer => agent)
    mapping (address => address) refers;

    event CreatePool(address indexed pair, uint rewardPerBlock, uint poolIndex);
    event Deposit(address indexed caller, address indexed pair, uint amount, uint indexed block, uint poolSize);
    event Withdraw(address indexed caller, address indexed pair, uint amount, uint indexed block, uint poolSize);
    event Harvest(address indexed caller, address indexed pair, uint indexed block, uint reward, uint commission);
    event ClearReward(address indexed caller, address indexed pair, uint indexed block);

    /// @notice All uint values can be set to 0 to use the default values
    constructor(
        address narfexTokenAddress,
        uint _rewardPerBlock,
        uint _commissionInterval,
        uint _harvestInterval,
        uint _earlyHarvestCommission,
        bool _isUnrewardEarlyWithdrawals,
        uint _rewardCancelInterval,
        uint _referralPercent
    ) {
        rewardToken = IBEP20(narfexTokenAddress);
        if (_rewardPerBlock > 0) defaultRewardPerBlock = _rewardPerBlock;
        if (_commissionInterval > 0) commissionInterval = _commissionInterval;
        if (_harvestInterval > 0) harvestInterval = _harvestInterval;
        if (_earlyHarvestCommission > 0) earlyHarvestCommission = _earlyHarvestCommission;
        isUnrewardEarlyWithdrawals = _isUnrewardEarlyWithdrawals;
        if (_rewardCancelInterval > 0) rewardCancelInterval = _rewardCancelInterval;
        if (_referralPercent > 0) referralPercent = _referralPercent;
    }

    /// @notice Returns the soil fertility
    /// @return Reward left in the common pool
    function getNarfexLeft() public view returns (uint) {
        return rewardToken.balanceOf(address(this));
    }

    /// @notice Withdraw amount of reward token to the owner
    /// @param _amount Amount of reward tokens. Can be set to 0 to withdraw all reward tokens
    function withdrawNarfex(uint _amount) public onlyOwner {
        uint amount = _amount > 0
            ? _amount
            : getNarfexLeft();
        rewardToken.transfer(address(msg.sender), amount);
    }

    /// @notice Creates a liquidity pool in the farm
    /// @param pair The address of LP token
    /// @param _rewardPerBlock Reward for each block. Set to 0 to use the default value
    /// @return The pool index in the list
    function createPool(address pair, uint _rewardPerBlock) public onlyOwner returns (uint) {
        uint rewardPerBlock = _rewardPerBlock;
        if (_rewardPerBlock == 0) {
            rewardPerBlock = defaultRewardPerBlock;
        }
        uint[] memory blocks;
        Pool storage newPool = pools[pair];
        newPool.token = IBEP20(pair);
        newPool.blocks = blocks;
        newPool.rewardPerBlock = rewardPerBlock;
        newPool.isExists = true;
        poolsList.push(pair);
        poolsCount = poolsList.length;
        uint poolIndex = poolsCount - 1;
        emit CreatePool(pair, rewardPerBlock, poolIndex);
        return poolIndex;
    }

    /// @notice Deposit LP tokens to the farm. It will try to harvest first
    /// @param pair The address of LP token
    /// @param amount Amount of LP tokens to deposit
    /// @param referAgent Address of the agent who invited the user
    function deposit(address pair, uint amount, address referAgent) public nonReentrant {
        Pool storage pool = pools[pair];
        require(amount > 0, "Amount must be above zero");
        require(pool.isExists, "Pool is not exists");
        require(pool.token.balanceOf(address(msg.sender)) >= amount, "Not enough LP balance");

        // Set user agent
        if (address(referAgent) != address(0)) {
            setUserReferAgent(referAgent);
        }

        // Try to harvest before deposit
        harvest(pair);
        // TODO: Do I need to make pool.token.approve there is with web3 calls?
        // Main transfer operation
        pool.token.safeTransferFrom(address(msg.sender), address(this), amount);

        uint blockIndex = 0;
        if (pool.blocks.length == 0) {
            // It it's the first deposit, just add the block
            pool.sizes[block.number] = amount;
            // Add block to known blocks
            pool.blocks.push(block.number);
        } else {
            // Update last pool size
            pool.sizes[block.number] = getPoolSize(pair) + amount;
            // Add block to known blocks
            if (_getPoolLastBlock(pair) != block.number) {
                pool.blocks.push(block.number);
            }
            blockIndex = pool.blocks.length - 1;
        }

        // Update user start harvest block
        UserPool storage user = pool.users[address(msg.sender)];
        user.amount = user.amount == 0 ? amount : user.amount + amount;
        user.startBlockIndex = blockIndex;
        user.depositTimestamp = block.timestamp;
        user.harvestTimestamp = block.timestamp;

        emit Deposit(address(msg.sender), pair, amount, block.number, pool.sizes[block.number]);
    }

    /// @notice Withdraw LP tokens from the farm. It will try to harvest first
    /// @param pair The address of LP token
    /// @param amount Amount of LP tokens to withdraw
    function withdraw(address pair, uint amount) public nonReentrant {
        Pool storage pool = pools[pair];
        UserPool storage user = pool.users[address(msg.sender)];
        require(amount > 0, "Amount must be above zero");
        require(pool.isExists, "Pool is not exists");
        require(getUserPoolSize(pair, address(msg.sender)) >= amount, "Not enough LP balance");

        if (isUnrewardEarlyWithdrawals && user.depositTimestamp + rewardCancelInterval < block.timestamp) {
            // Clear user reward for early withdraw if this feature is turned on
            _clearUserReward(pair, address(msg.sender));
        } else {
            // Try to harvest before withdraw
            harvest(pair);
        }
        // Main transfer operation
        pool.token.safeTransfer(address(msg.sender), amount);

        // Update pool size
        pool.sizes[block.number] = getPoolSize(pair) - amount;
        // Update last changes block
        if (block.number != _getPoolLastBlock(pair)) {
            pool.blocks.push(block.number);
        }

        // Update user pool
        user.amount = user.amount - amount;
        user.startBlockIndex = pool.blocks.length;
        user.harvestTimestamp = block.timestamp;

        emit Withdraw(address(msg.sender), pair, amount, block.number, pool.sizes[block.number]);
    }

    /// @notice Returns the last block number in which the pool size was changed
    /// @param pair The address of LP token
    /// @return block number
    function _getPoolLastBlock(address pair) internal view returns (uint) {
        Pool storage pool = pools[pair];
        return pool.blocks[pool.blocks.length - 1];
    }

    /// @notice Returns the pool size after the last pool changes
    /// @param pair The address of LP token
    /// @return pool size
    function getPoolSize(address pair) public view returns (uint) {
        if (pools[pair].isExists && pools[pair].blocks.length > 0) {
            return pools[pair].sizes[_getPoolLastBlock(pair)];
        } else {
            return 0;
        }
    }

    /// @notice Returns user's amount of LP tokens
    /// @param pair The address of LP token
    /// @param userAddress The user address
    /// @return user's pool size
    function getUserPoolSize(address pair, address userAddress) public view returns (uint) {
        Pool storage pool = pools[pair];
        if (pool.isExists && pool.blocks.length > 0) {
            return pool.users[userAddress].amount;
        } else {
            return 0;
        }
    }

    /// @notice The number of the last block during which the harvest took place
    /// @param pair The address of LP token
    /// @param userAddress The user address
    /// @return block number
    function getUserLastHarvestBlock(address pair, address userAddress) public view returns (uint) {
        return pools[pair].users[userAddress].lastHarvestBlock;
    }

    /// @notice Returns wei number in 2-decimals (as %) for better console logging
    /// @param value Number in wei
    /// @return value in percents
    function getHundreds(uint value) internal pure returns (uint) {
        return value * 100 / 10**18;
    }

    /// @notice Calculates the user's reward based on a blocks range
    /// @notice Taking into account the changing size of the pool during this time
    /// @param pair The address of LP token
    /// @param userAddress The user address
    /// @return reward size
    function getUserReward(address pair, address userAddress) public view returns (uint) {
        Pool storage pool = pools[pair];
        UserPool storage user = pool.users[userAddress];

        uint reward = user.storedReward;
        uint userPoolSize = getUserPoolSize(pair, userAddress);
        if (userPoolSize == 0) return 0;

        uint decimals = pool.token.decimals();

        for (uint i = user.startBlockIndex; i < pool.blocks.length; i++) {
            // End of the pool size period
            uint endBlock = i + 1 < pool.blocks.length
                ? pool.blocks[i + 1] // Next block in the array
                : block.number; // Current block number
            if (user.lastHarvestBlock + 1 > endBlock) continue;

            // Blocks range between pool size key points
            uint range = user.lastHarvestBlock + 1 > pool.blocks[i]
                ? endBlock - user.lastHarvestBlock + 1 // Last harvest could happen inside the range
                : endBlock - pool.blocks[i]; // Use startBlock as the start of the range

            // Pool size can't be empty on the range, because we use harvest before each withdraw
            require (pool.sizes[pool.blocks[i]] > 0, "[getUserReward] Bug: unexpected empty pool on some blocks range");

            // User share in this range in %
            uint share = userPoolSize * 10**decimals / pool.sizes[pool.blocks[i]];
            // Reward from this range
            uint rangeReward = share * pool.rewardPerBlock * range / 10**decimals;
            // Add reward to total
            reward += rangeReward;
        }

        return reward;
    }

    /// @notice If enough time has passed since the last harvest
    /// @param pair The address of LP token
    /// @param userAddress The user address
    /// @return true if user can harvest
    function getIsUserCanHarvest(address pair, address userAddress) public view returns (bool) {
        UserPool storage user = pools[pair].users[userAddress];
        return isUnrewardEarlyWithdrawals
            // Is reward clearing feature is turned on
            ? user.depositTimestamp + rewardCancelInterval < block.timestamp
                && user.harvestTimestamp + harvestInterval < block.timestamp
            // Use only harvest interval
            : user.harvestTimestamp + harvestInterval < block.timestamp;
    }

    /// @notice Whether to charge the user an early withdrawal fee
    /// @param pair The address of LP token
    /// @param userAddress The user address
    /// @return true if it's to early to withdraw
    function getIsEarlyHarvest(address pair, address userAddress) public view returns (bool) {
        return pools[pair].users[userAddress].depositTimestamp + commissionInterval > block.timestamp;
    }

    /// @notice Try to harvest reward from the pool.
    /// @notice Will send a reward to the user if enough time has passed since the last harvest
    /// @param pair The address of LP token
    /// @return transferred reward amount
    function harvest(address pair) public returns (uint) {
        UserPool storage user = pools[pair].users[address(msg.sender)];

        uint reward = getUserReward(pair, address(msg.sender));
        if (reward == 0) return 0;

        if (getIsUserCanHarvest(pair, address(msg.sender))) {
            // Calculate commission for early withdraw
            uint commission = getIsEarlyHarvest(pair, address(msg.sender))
                ? reward * earlyHarvestCommission / 100
                : 0;
            if (commission > 0) {
                reward -= commission;
            }

            // User can harvest only after harvest inverval
            rewardToken.safeTransfer(address(msg.sender), reward);
            emit Harvest(address(msg.sender), pair, block.number, reward, commission);

            user.harvestTimestamp = block.timestamp;
            user.lastHarvestBlock = block.number;

            // Send a referral reward to the agent
            address agent = refers[address(msg.sender)];
            if (address(agent) != address(0)) {
                rewardToken.safeTransfer(agent, getReferralReward(reward)); 
            }

            return reward;
        } else {
            // Store the reward and update the last harvest block
            user.storedReward = reward;
            user.lastHarvestBlock = block.number;
            return 0;
        }
    }

    /// @notice Clears user's reward in the pool
    /// @param pair The address of LP token
    /// @param userAddress The user address
    function _clearUserReward(address pair, address userAddress) internal {
        UserPool storage user = pools[pair].users[userAddress];
        user.storedReward = 0;
        user.harvestTimestamp = block.timestamp;
        user.lastHarvestBlock = _getPoolLastBlock(pair);
        user.startBlockIndex = pools[pair].blocks[pools[pair].blocks.length - 1];
        emit ClearReward(address(msg.sender), pair, block.number);
    }
    
    /// @notice Sets the commission interval
    /// @param interval Interval size in seconds
    function setCommissionInterval(uint interval) public onlyOwner {
        commissionInterval = interval;
    }

    /// @notice Sets the harvest interval
    /// @param interval Interval size in seconds
    function setHarvestInterval(uint interval) public onlyOwner {
        harvestInterval = interval;
    }

    /// @notice Sets the harvest interval
    /// @param percents Commission in percents (10 for default 10%)
    function setEarlyHarvesCommission(uint percents) public onlyOwner {
        earlyHarvestCommission = percents;
    }

    /// @notice Toggles the feature clearing reward for early withdrawal
    function toggleRewardClearingForEarlyWithdrawals() public onlyOwner {
        isUnrewardEarlyWithdrawals = !isUnrewardEarlyWithdrawals;
    }

    /// @notice Sets the reward cancel interval
    /// @param interval Interval size in seconds
    function setRewardCancelInterval(uint interval) public onlyOwner {
        rewardCancelInterval = interval;
    }

    /// @notice Sets the default reward per block for a new pools
    /// @param reward Reward per block
    function setDefaultRewardPerBlock(uint reward) public onlyOwner {
        defaultRewardPerBlock = reward;
    }

    /// @notice Sets the reward per block value for all pools and default value
    /// @param reward Reward per block
    function updateAllPoolsRewardsSizes(uint reward) public onlyOwner {
        setDefaultRewardPerBlock(reward);
        for (uint i = 0; i < poolsList.length; i++) {
            pools[poolsList[i]].rewardPerBlock = reward;
        }
    }

    /// @notice Returns poolsList array length
    function getPoolsCount() public view returns (uint) {
        return poolsList.length;
    }

    /// @notice Returns contract settings by one request
    /// @return uintDefaultRewardPerBlock
    /// @return uintCommissionInterval
    /// @return uintHarvestInterval
    /// @return uintEarlyHarvestCommission
    /// @return boolIsUnrewardEarlyWithdrawals
    /// @return uintRewardCancelInterval
    /// @return uintReferralPercent
    function getSettings() public view returns (
        uint uintDefaultRewardPerBlock,
        uint uintCommissionInterval,
        uint uintHarvestInterval,
        uint uintEarlyHarvestCommission,
        bool boolIsUnrewardEarlyWithdrawals,
        uint uintRewardCancelInterval,
        uint uintReferralPercent
        ) {
        return (
        defaultRewardPerBlock,
        commissionInterval,
        harvestInterval,
        earlyHarvestCommission,
        isUnrewardEarlyWithdrawals,
        rewardCancelInterval,
        referralPercent
        );
    }

    /// @notice Sets the user's agent
    /// @param agent Address of the agent who invited the user
    /// @return False if the agent and the user have the same address
    function setUserReferAgent(address agent) public returns (bool) {
        if (address(msg.sender) != agent) {
            refers[address(msg.sender)] = agent;
            return true;
        } else {
            return false;
        }
    }

    /// @notice Owner can set the referral percent
    /// @param percent Referral percent
    function setReferralPercent(uint percent) public onlyOwner {
        referralPercent = percent;
    }

    /// @notice Returns agent's reward amount for referral's reward
    /// @param reward Referral's reward amount
    /// @return Agent's reward amount
    function getReferralReward(uint reward) internal view returns (uint) {
        return reward * referralPercent / 100;
    }

    /// @notice Sets a pool reward
    /// @param pair The address of LP token
    /// @param reward Amount of reward per block
    function setPoolRewardPerBlock(address pair, uint reward) public onlyOwner {
        pools[pair].rewardPerBlock = reward;
    }

    /// @notice Returns reward per block for selected pair
    /// @param pair The address of LP token
    /// @return Reward per block
    function getPoolRewardPerBlock(address pair) public view returns (uint) {
        return pools[pair].rewardPerBlock;
    }

    /// @notice Returns pool data in one request
    /// @param pair The address of LP token
    /// @return token0 First token address
    /// @return token1 Second token address
    /// @return token0symbol First token symbol
    /// @return token1symbol Second token symbol
    /// @return size Liquidity pool size
    /// @return rewardPerBlock Amount of reward token per block
    function getPoolData(address pair) public view returns (
        address token0,
        address token1,
        string memory token0symbol,
        string memory token1symbol,
        uint size,
        uint rewardPerBlock
    ) {
        Pool storage pool = pools[pair];
        IPancakePair pairToken = IPancakePair(pair);
        BEP20 _token0 = BEP20(pairToken.token0());
        BEP20 _token1 = BEP20(pairToken.token1());

        return (
            pairToken.token0(),
            pairToken.token1(),
            _token0.symbol(),
            _token1.symbol(),
            getPoolSize(pair),
            pool.rewardPerBlock
        );
    }

    /// @notice Returns pool data in one request
    /// @param pair The address of LP token
    /// @param userAddress The user address
    /// @return balance User balance of LP token
    /// @return userPool User liquidity pool size in the current pool
    /// @return reward Current user reward in the current pool
    /// @return isCanHarvest Is it time to harvest the reward
    function getPoolUserData(address pair, address userAddress) public view returns (
        uint balance,
        uint userPool,
        uint reward,
        bool isCanHarvest
    ) {
        IPancakePair pairToken = IPancakePair(pair);

        return (
            pairToken.balanceOf(userAddress),
            getUserPoolSize(pair, userAddress),
            getUserReward(pair, userAddress),
            getIsUserCanHarvest(pair, userAddress)
        );
    }

}
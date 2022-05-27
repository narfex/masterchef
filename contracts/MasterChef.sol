// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./ReentrancyGuard.sol";
import "./Ownable.sol";
import "./SafeBEP20.sol";
import "./SafeMath.sol";
import "./BEP20.sol";
import "hardhat/console.sol";

/// @title Farming contract for minted Narfex Token
/// @author Danil Sakhinov
/// @notice Distributes a reward from the balance instead of minting it
contract MasterChef is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
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

    // Pools data
    mapping (address => Pool) public pools;
    // Pools list by addresses
    address[] public poolsList;

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
        uint _rewardCancelInterval
    ) public {
        rewardToken = IBEP20(narfexTokenAddress);
        if (_rewardPerBlock > 0) defaultRewardPerBlock = _rewardPerBlock;
        if (_commissionInterval > 0) commissionInterval = _commissionInterval;
        if (_harvestInterval > 0) harvestInterval = _harvestInterval;
        if (_earlyHarvestCommission > 0) earlyHarvestCommission = _earlyHarvestCommission;
        isUnrewardEarlyWithdrawals = _isUnrewardEarlyWithdrawals;
        if (_rewardCancelInterval > 0) rewardCancelInterval = _rewardCancelInterval;
    }

    /// @notice Returns the soil fertility
    /// @return Reward left in the common pool
    function getNarfexLeft() public view returns (uint) {
        return rewardToken.balanceOf(address(this));
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
        pools[pair] = Pool({
            token: IBEP20(pair),
            blocks: blocks,
            rewardPerBlock: rewardPerBlock,
            isExists: true
        });
        poolsList.push(pair);
        uint poolIndex = poolsList.length - 1;
        emit CreatePool(pair, rewardPerBlock, poolIndex);
        return poolIndex;
    }

    /// @notice Deposit LP tokens to the farm. It will try to harvest first
    /// @param pair The address of LP token
    /// @param amount Amount of LP tokens to deposit
    function deposit(address pair, uint amount) public nonReentrant {
        Pool storage pool = pools[pair];
        require(amount > 0, "Amount must be above zero");
        require(pool.isExists, "Pool is not exists");
        require(pool.token.balanceOf(address(msg.sender)) >= amount, "Not enough LP balance");

        console.log("Try to deposit. Sender", msg.sender, pool.token.balanceOf(address(msg.sender)));
        // Try to harvest before deposit
        harvest(pair);
        // TODO: Do I need to make pool.token.approve there is with web3 calls?
        // Main transfer operation
        pool.token.safeTransferFrom(address(msg.sender), address(this), amount);
        console.log("Transferred", amount);

        uint blockIndex = 0;
        if (pool.blocks.length == 0) {
            console.log("No blocks");
            // It it's the first deposit, just add the block
            pool.sizes[block.number] = amount;
            // Add block to known blocks
            pool.blocks.push(block.number);
            console.log("Block pushed", block.number);
        } else {
            console.log("Blocks", pool.blocks.length);
            // Update last pool size
            pool.sizes[block.number] = getPoolSize(pair) + amount;
            // Add block to known blocks
            if (_getPoolLastBlock(pair) != block.number) {
                pool.blocks.push(block.number);
            }
            blockIndex = pool.blocks.length - 1;
            console.log("New block index", blockIndex, block.number);
        }

        // Update user start harvest block
        UserPool storage user = pool.users[address(msg.sender)];
        console.log("Update user", user.amount);
        user.amount = user.amount == 0 ? amount : SafeMath.add(user.amount, amount);
        user.startBlockIndex = blockIndex;
        console.log("User updated", user.amount, user.startBlockIndex);
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
        require(getUserPoolSize(pair) >= amount, "Not enough LP balance");

        if (isUnrewardEarlyWithdrawals && user.depositTimestamp + rewardCancelInterval < block.timestamp) {
            // Clear user reward for early withdraw if this feature is turned on
            _clearUserReward(pair);
        } else {
            // Try to harvest before withdraw
            harvest(pair);
        }
        // Main transfer operation
        pool.token.safeTransfer(address(msg.sender), amount);

        // Update pool size
        pool.sizes[block.number] = SafeMath.sub(getPoolSize(pair), amount);
        // Update last changes block
        if (block.number != _getPoolLastBlock(pair)) {
            pool.blocks.push(block.number);
        }

        // Update user pool
        user.amount = SafeMath.sub(user.amount, amount);
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
    /// @return user's pool size
    function getUserPoolSize(address pair) public view returns (uint) {
        Pool storage pool = pools[pair];
        if (pool.isExists && pool.blocks.length > 0) {
            return pool.users[address(msg.sender)].amount;
        } else {
            return 0;
        }
    }

    /// @notice The number of the last block during which the harvest took place
    /// @param pair The address of LP token
    /// @return block number
    function getUserLastHarvestBlock(address pair) public view returns (uint) {
        return pools[pair].users[address(msg.sender)].lastHarvestBlock;
    }

    /// @notice Returns wei number in 2-decimals (as %) for better console logging
    /// @param value Number in wei
    /// @return value in percents
    function getHundreds(uint value) internal pure returns (uint) {
        return SafeMath.mul(value, 100).div(10**18);
    }

    /// @notice Calculates the user's reward based on a blocks range
    /// @notice Taking into account the changing size of the pool during this time
    /// @param pair The address of LP token
    /// @return reward size
    function getUserReward(address pair) public view returns (uint) {
        Pool storage pool = pools[pair];
        UserPool storage user = pool.users[address(msg.sender)];

        uint reward = user.storedReward;
        console.log("Stored reward", reward);
        uint userPoolSize = getUserPoolSize(pair);
        if (userPoolSize == 0) return 0;

        uint decimals = pool.token.decimals();

        for (uint i = user.startBlockIndex; i < pool.blocks.length; i++) {
            console.log("Loop index", i);
            // End of the pool size period
            uint endBlock = i + 1 < pool.blocks.length
                ? pool.blocks[i + 1] // Next block in the array
                : block.number; // Current block number
            if (user.lastHarvestBlock + 1 > endBlock) continue;
            console.log("Blocks key points", pool.blocks[i], endBlock);
            console.log("New harvest start", user.lastHarvestBlock + 1);
            console.log("CurrentBlock", block.number);

            // Blocks range between pool size key points
            uint range = user.lastHarvestBlock + 1 > pool.blocks[i]
                ? SafeMath.sub(endBlock, user.lastHarvestBlock + 1) // Last harvest could happen inside the range
                : SafeMath.sub(endBlock, pool.blocks[i]); // Use startBlock as the start of the range
            console.log("Blocks range", range);

            // Pool size can't be empty on the range, because we use harvest before each withdraw
            require (pool.sizes[pool.blocks[i]] > 0, "[getUserReward] Bug: unexpected empty pool on some blocks range");

            // User share in this range in %
            uint share = SafeMath.mul(userPoolSize, 10**decimals)
                .div(pool.sizes[pool.blocks[i]]); // Divide the pool size
            console.log("Share %", getHundreds(share));
            // Reward from this range
            uint rangeReward = SafeMath.mul(share, pool.rewardPerBlock).mul(range).div(10**decimals);
            console.log("Range reward", getHundreds(rangeReward));
            // Add reward to total
            reward = SafeMath.add(reward, rangeReward);
        }

        console.log("Total reward", getHundreds(reward));
        return reward;
    }

    /// @notice If enough time has passed since the last harvest
    /// @param pair The address of LP token
    /// @return true if user can harvest
    function getIsUserCanHarvest(address pair) public view returns (bool) {
        UserPool storage user = pools[pair].users[address(msg.sender)];
        return isUnrewardEarlyWithdrawals
            // Is reward clearing feature is turned on
            ? user.depositTimestamp + rewardCancelInterval < block.timestamp
                && user.harvestTimestamp + harvestInterval < block.timestamp
            // Use only harvest interval
            : user.harvestTimestamp + harvestInterval < block.timestamp;
    }

    /// @notice Whether to charge the user an early withdrawal fee
    /// @param pair The address of LP token
    /// @return true if it's to early to withdraw
    function getIsEarlyHarvest(address pair) public view returns (bool) {
        return pools[pair].users[address(msg.sender)].depositTimestamp + commissionInterval > block.timestamp;
    }

    /// @notice Try to harvest reward from the pool.
    /// @notice Will send a reward to the user if enough time has passed since the last harvest
    /// @param pair The address of LP token
    /// @return transferred reward amount
    function harvest(address pair) public returns (uint) {
        UserPool storage user = pools[pair].users[address(msg.sender)];

        uint reward = getUserReward(pair);
        if (reward == 0) return 0;

        if (getIsUserCanHarvest(pair)) {
            // Calculate commission for early withdraw
            uint commission = getIsEarlyHarvest(pair)
                ? SafeMath.mul(reward, earlyHarvestCommission).div(100)
                : 0;
            if (commission > 0) {
                reward = SafeMath.sub(reward, commission);
            }
            console.log("User harvest: reward and commission", reward, commission);

            // User can harvest only after harvest inverval
            rewardToken.safeTransfer(address(msg.sender), reward);
            emit Harvest(address(msg.sender), pair, block.number, reward, commission);

            user.harvestTimestamp = block.timestamp;
            user.lastHarvestBlock = block.number;
            return reward;
        } else {
            // Store the reward and update the last harvest block
            user.storedReward = reward;
            console.log("User can't harvest yet", user.storedReward);
            user.lastHarvestBlock = block.number;
            return 0;
        }
    }

    /// @notice Clears user's reward in the pool
    /// @param pair The address of LP token
    function _clearUserReward(address pair) internal {
        UserPool storage user = pools[pair].users[address(msg.sender)];
        user.storedReward = 0;
        user.harvestTimestamp = block.timestamp;
        user.lastHarvestBlock = _getPoolLastBlock(pair);
        user.startBlockIndex = pools[pair].blocks[pools[pair].blocks.length - 1];
        emit ClearReward(address(msg.sender), pair, block.number);
    }
    
    /// @notice Sets the commission interval
    /// @param interval Interval size in seconds
    function setCommissionInteval(uint interval) public onlyOwner {
        commissionInterval = interval;
    }

    /// @notice Sets the harvest interval
    /// @param interval Interval size in seconds
    function setHarvestInteval(uint interval) public onlyOwner {
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
    function getSettings() public view returns (
        uint uintDefaultRewardPerBlock,
        uint uintCommissionInterval,
        uint uintHarvestInterval,
        uint uintEarlyHarvestCommission,
        bool boolIsUnrewardEarlyWithdrawals,
        uint uintRewardCancelInterval
        ) {
        return (
        defaultRewardPerBlock,
        commissionInterval,
        harvestInterval,
        earlyHarvestCommission,
        isUnrewardEarlyWithdrawals,
        rewardCancelInterval
        );
    }

    /// @notice Returnt all allowed pools addresses
    function getPoolsList() public view returns (address[] memory) {
        return poolsList;
    }

}
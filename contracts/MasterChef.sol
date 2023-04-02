// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IPancakePair {
    function balanceOf(address owner) external view returns (uint);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title Farming contract for minted Narfex Token
/// @author Danil Sakhinov
/// @notice Distributes a reward from the balance instead of minting it
contract MasterChef is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // User share of a pool
    struct UserInfo {
        uint amount; // Amount of LP-tokens deposit
        uint withdrawnReward; // Reward already withdrawn
        uint depositTimestamp; // Last deposit time
        uint harvestTimestamp; // Last harvest time
        uint storedReward; // Reward tokens accumulated in contract (not paid yet)
    }

    struct PoolInfo {
        IERC20 pairToken; // Address of LP token contract
        uint256 allocPoint; // How many allocation points assigned to this pool
        uint256 lastRewardBlock;  // Last block number that NRFX distribution occurs.
        uint256 accRewardPerShare; // Accumulated NRFX per share, times 1e12
        bool exist;  // default storage slot value is false, set true on adding
    }

    // Reward to harvest
    IERC20 public immutable rewardToken;
    // The interval from the deposit in which the commission for the reward will be taken.
    uint public earlyHarvestCommissionInterval = 14 days;
    // Interval since last harvest when next harvest is not possible
    uint public harvestInterval = 8 hours;
    // Commission for to early harvests with 2 digits of precision (10000 = 100%)
    uint public earlyHarvestCommission = 1000;
    // Referral percent for reward with 2 digits of precision (10000 = 100%)
    uint public referralPercent = 60;

    // Amount of NRFX per block for all pools
    uint256 public rewardPerBlock;

    uint constant internal HUNDRED_PERCENTS = 10000;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping (uint256 /*poolId*/ => mapping (address => UserInfo)) public userInfo;
    // Mapping of pools IDs for pair addresses
    mapping (address => uint256) public poolId;
    // Mapping of users referrals
    mapping (address => address) private referrals;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // The block number when farming starts
    uint256 public immutable startBlock;
    // The block number when all allocated rewards will be distributed as rewards
    uint256 public endBlock;

    // This variable we need to understand how many rewards WAS transferred to the contract since the last call
    uint256 public lastRewardTokenBalance;
    // restUnallocatedRewards = rewards % rewardPerBlock it's not enough to give new block so we keep it to accumulate with future rewards
    uint256 public restUnallocatedRewards;

    /**
     * @dev Event emitted as a result of accounting for new rewards.
     * @param newRewardsAmount The amount of new rewards that were accounted for.
     * @param newEndBlock The block number until which new rewards will be accounted for.
     * @param newRestUnallocatedRewards The remaining unallocated amount of rewards.
     * @param newLastRewardTokenBalance The token balance in the master chef contract after accounting for new rewards.
     * @param afterEndBlock Flag indicating whether the accounting was done after the end of the term.
     */
    event NewRewardsAccounted(
        uint256 newRewardsAmount,
        uint256 newEndBlock,
        uint256 newRestUnallocatedRewards,
        uint256 newLastRewardTokenBalance,
        bool afterEndBlock
    );

    /**
     * @dev Event emitted in case no new rewards were accounted for.
     */
    event NoNewRewardsAccounted();

    /**
     * @dev Emitted when the end block is recalculated (because of rewardPerBlock change).
     * @param newEndBlock The new end block number.
     * @param newRestUnallocatedRewards The new value of rest unallocated rewards.
     */
    event EndBlockRecalculatedBecauseOfRewardPerBlockChange(uint256 newEndBlock, uint256 newRestUnallocatedRewards);

    /**
     * @dev Emitted when the end block is recalculated (because of owner withdraw).
     * @param newEndBlock The new end block number.
     * @param newRestUnallocatedRewards The new value of rest unallocated rewards.
     */
    event EndBlockRecalculatedBecauseOfOwnerWithdraw(uint256 newEndBlock, uint256 newRestUnallocatedRewards);

    /**
     * @dev Emitted when the owner withdraws Narfex tokens.
     * @param owner The address of the owner who withdraws the tokens.
     * @param amount The amount of Narfex tokens withdrawn by the owner.
     */
    event WithdrawNarfexByOwner(address indexed owner, uint256 amount);

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event TotalAllocPointUpdated(uint256 totalAllocPoint);
    event PoolAdded(uint256 indexed pid, address indexed pairToken, uint256 allocPoint);
    event PoolAllocPointSet(uint256 indexed pid, uint256 allocPoint);
    event RewardPerBlockSet(uint256 rewardPerBlock);
    event EarlyHarvestCommissionIntervalSet(uint256 interval);
    event ReferralPercentSet(uint256 percents);
    event EarlyHarvestCommissionSet(uint256 percents);
    event HarvestIntervalSet(uint256 interval);
    event ReferralRewardPaid(address indexed referral, uint256 amount);

    constructor(
        address _rewardToken,
        uint256 _rewardPerBlock
    ) {
        rewardToken = IERC20(_rewardToken);
        rewardPerBlock = _rewardPerBlock;
        emit RewardPerBlockSet(rewardPerBlock);
        startBlock = block.number;
        endBlock = block.number;
    }

    modifier beforeEndBlock() {
        require(block.number <= endBlock, "endBlock passed");
        _;
    }

    modifier afterEndBlock() {
        require(block.number > endBlock, "endBlock not passed");
        _;
    }

    /**
     * @notice Account new rewards from the reward pool. This function can be called periodically by anyone to distribute new rewards to the reward pool.
     */
    function accountNewRewards() public {
        uint256 currentBalance = rewardToken.balanceOf(address(this));
        uint256 newRewardsAmount = currentBalance - lastRewardTokenBalance;
        if (newRewardsAmount == 0) {
            emit NoNewRewardsAccounted();
            return;
        }
        uint256 newRewardsToAccount = newRewardsAmount + restUnallocatedRewards;
        if ((block.number > endBlock) && (startBlock != endBlock)) {
            // allow admin to withdraw rewards after endBlock
            // note that if startBlock == endBlock it will make initial endBlock setting
            restUnallocatedRewards = newRewardsToAccount;
            lastRewardTokenBalance = currentBalance;
            emit NewRewardsAccounted({
                newRewardsAmount: newRewardsAmount,
                newEndBlock: endBlock,
                newRestUnallocatedRewards: restUnallocatedRewards,
                newLastRewardTokenBalance: lastRewardTokenBalance,
                afterEndBlock: true
            });
            return;
        }
        uint256 deltaBlocks = newRewardsToAccount / rewardPerBlock;
        endBlock = endBlock + deltaBlocks;
        restUnallocatedRewards = newRewardsToAccount - deltaBlocks * rewardPerBlock;  // (newRewardsAmount + restUnallocatedRewards) % rewardPerBlock
        lastRewardTokenBalance = currentBalance;
        emit NewRewardsAccounted({
            newRewardsAmount: newRewardsAmount,
            newEndBlock: endBlock,
            newRestUnallocatedRewards: restUnallocatedRewards,
            newLastRewardTokenBalance: lastRewardTokenBalance,
            afterEndBlock: false
        });
    }

    /// @notice Count of created pools
    /// @return poolInfo length
    function getPoolsCount() external view returns (uint256) {
        return poolInfo.length;
    }

    /// @notice Returns the balance of reward token in the contract
    /// @return Reward left in the common pool
    function getNarfexLeft() public view returns (uint) {
        return rewardToken.balanceOf(address(this));
    }

    /// @notice Withdraw amount of reward token to the owner. Owner may only withdraw unallocated rewards tokens after the end block.
    function withdrawNarfexByOwner(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "amount must be > 0");
        require(amount <= getNarfexLeft(), "not enough left");
        uint256 leftBlock = (block.number > endBlock) ? endBlock : block.number;
        uint256 futureBlocks = endBlock - leftBlock;
        uint256 futureRestUnallocatedRewards = futureBlocks * rewardPerBlock + restUnallocatedRewards;
        require(amount <= futureRestUnallocatedRewards, "not enough unallocated rewards");
        uint256 newUnallocatedRewards = futureRestUnallocatedRewards - amount;
        uint256 blocks = newUnallocatedRewards / rewardPerBlock;
        endBlock = block.number + blocks;
        restUnallocatedRewards = newUnallocatedRewards - blocks * rewardPerBlock;
        emit EndBlockRecalculatedBecauseOfOwnerWithdraw(endBlock, restUnallocatedRewards);
        emit WithdrawNarfexByOwner(msg.sender, amount);
        rewardToken.safeTransfer(address(msg.sender), amount);
    }

    modifier onlyExistPool(address _pairAddress) {
        require(poolExists(_pairAddress), "pool not exist");
        _;
    }
    
    function poolExists(address _pairAddress) public view returns(bool) {
        if (poolInfo.length == 0) {  // prevent out of bounds error
            return false;
        }
        return poolInfo[poolId[_pairAddress]].exist;
    }

    /// @notice Add a new pool
    /// @param _allocPoint Allocation point for this pool
    /// @param _pairAddress Address of LP token contract
    /// @param _withUpdate Force update all pools
    function add(uint256 _allocPoint, address _pairAddress, bool _withUpdate) external onlyOwner beforeEndBlock nonReentrant {
        require(!poolExists(_pairAddress), "already exists");
        if (_withUpdate) {
            _massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint + _allocPoint;
        emit TotalAllocPointUpdated(totalAllocPoint);
        poolInfo.push(PoolInfo({
            pairToken: IERC20(_pairAddress),
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accRewardPerShare: 0,
            exist: true
        }));
        poolId[_pairAddress] = poolInfo.length - 1;
        emit PoolAdded({
            pid: poolId[_pairAddress],
            pairToken: _pairAddress,
            allocPoint: _allocPoint
        });
    }

    /// @notice Update allocation points for a pool
    /// @param _pid Pool index
    /// @param _allocPoint Allocation points
    /// @param _withUpdate Force update all pools
    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) external onlyOwner beforeEndBlock nonReentrant {
        if (_withUpdate) {
            _massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint + _allocPoint - poolInfo[_pid].allocPoint;
        emit TotalAllocPointUpdated(totalAllocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;  // note: revert if not exist
        emit PoolAllocPointSet({
            pid: _pid,
            allocPoint: _allocPoint
        });
    }

    /// @notice Set a new reward per block amount (runs _massUpdatePools)
    /// @param _amount Amount of reward tokens per block
    function setRewardPerBlock(uint256 _amount) external onlyOwner beforeEndBlock nonReentrant {
        uint256 oldRewardPerBlock = rewardPerBlock;

        _massUpdatePools();
        accountNewRewards();
        rewardPerBlock = _amount;
        emit RewardPerBlockSet(_amount);

        // endBlock = currentBlock + unallocatedRewards / rewardPerBlock
        // so now there is a tricky moment because we have to update the endBlock
        uint256 futureRewards = (endBlock - block.number) * oldRewardPerBlock + restUnallocatedRewards;
        uint256 deltaBlocks = futureRewards / rewardPerBlock;
        endBlock = endBlock + deltaBlocks;
        restUnallocatedRewards = futureRewards - deltaBlocks * rewardPerBlock;
        emit EndBlockRecalculatedBecauseOfRewardPerBlockChange({
            newEndBlock: endBlock,
            newRestUnallocatedRewards: restUnallocatedRewards
        });
    }

    /// @notice Calculates the user's reward based on a blocks range
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return reward size
    /// @dev Only for frontend view
    function getUserReward(address _pairAddress, address _user) public view onlyExistPool(_pairAddress) returns (uint256) {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = pool.pairToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 rightBlock = block.number > endBlock ? endBlock : block.number;
            uint256 blocks = rightBlock - pool.lastRewardBlock;
            uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
            accRewardPerShare += reward * 1e12 / lpSupply;
        }
        return user.amount * accRewardPerShare / 1e12 - user.withdrawnReward + user.storedReward;
    }

    /// @notice If enough time has passed since the last harvest
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return true if user can harvest
    function _getIsUserCanHarvest(address _pairAddress, address _user) internal view returns (bool) {
        uint256 _pid = poolId[_pairAddress];
        UserInfo storage user = userInfo[_pid][_user];
        bool isEarlyHarvest = block.timestamp - user.harvestTimestamp < harvestInterval;
        return !isEarlyHarvest;
    }

    /// @notice Returns user's amount of LP tokens
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return user's pool size
    function getUserPoolSize(address _pairAddress, address _user) external view onlyExistPool(_pairAddress) returns (uint) {
        uint256 _pid = poolId[_pairAddress];
        return userInfo[_pid][_user].amount;
    }

    /// @notice Returns contract settings by one request
    /// @return uintRewardPerBlock uintRewardPerBlock
    /// @return uintEarlyHarvestCommissionInterval uintEarlyHarvestCommissionInterval
    /// @return uintHarvestInterval uintHarvestInterval
    /// @return uintEarlyHarvestCommission uintEarlyHarvestCommission
    /// @return uintReferralPercent uintReferralPercent
    function getSettings() public view returns (
        uint uintRewardPerBlock,
        uint uintEarlyHarvestCommissionInterval,
        uint uintHarvestInterval,
        uint uintEarlyHarvestCommission,
        uint uintReferralPercent
    ) {
        return (
            rewardPerBlock,
            earlyHarvestCommissionInterval,
            harvestInterval,
            earlyHarvestCommission,
            referralPercent
        );
    }

    /// @notice Returns pool data in one request
    /// @param _pairAddress The address of LP token
    /// @return token0 First token address
    /// @return token1 Second token address
    /// @return token0symbol First token symbol
    /// @return token1symbol Second token symbol
    /// @return amount Liquidity pool size
    /// @return poolShare Share of the pool based on allocation points
    function getPoolData(address _pairAddress) public view onlyExistPool(_pairAddress) returns (
        address token0,
        address token1,
        string memory token0symbol,
        string memory token1symbol,
        uint amount,
        uint poolShare
    ) {
        uint256 _pid = poolId[_pairAddress];
        IPancakePair pairToken = IPancakePair(_pairAddress);
        IERC20Metadata _token0 = IERC20Metadata(pairToken.token0());
        IERC20Metadata _token1 = IERC20Metadata(pairToken.token1());

        return (
            pairToken.token0(),
            pairToken.token1(),
            _token0.symbol(),
            _token1.symbol(),
            pairToken.balanceOf(address(this)),
            poolInfo[_pid].allocPoint * HUNDRED_PERCENTS / totalAllocPoint
        );
    }

    /// @notice Returns pool data in one request
    /// @param _pairAddress The ID of liquidity pool
    /// @param _user The user address
    /// @return balance User balance of LP token
    /// @return userPool User liquidity pool size in the current pool
    /// @return reward Current user reward in the current pool
    /// @return isCanHarvest Is it time to harvest the reward
    function getPoolUserData(address _pairAddress, address _user) public view onlyExistPool(_pairAddress) returns (
        uint balance,
        uint userPool,
        uint256 reward,
        bool isCanHarvest
    ) {
        return (
            IPancakePair(_pairAddress).balanceOf(_user),
            userInfo[poolId[_pairAddress]][_user].amount,
            getUserReward(_pairAddress, _user),
            _getIsUserCanHarvest(_pairAddress, _user)
        );
    }

    /// @notice Sets the early harvest commission interval
    /// @param interval Interval size in seconds
    function setEarlyHarvestCommissionInterval(uint interval) external onlyOwner nonReentrant {
        earlyHarvestCommissionInterval = interval;
        emit EarlyHarvestCommissionIntervalSet(interval);
    }

    /// @notice Sets the harvest interval
    /// @param interval Interval size in seconds
    function setHarvestInterval(uint interval) external onlyOwner nonReentrant {
        harvestInterval = interval;
        emit HarvestIntervalSet(interval);
    }

    /// @notice Sets the early harvest commission
    /// @param percents Early harvest commission in percents (10 for default 10%)
    function setEarlyHarvestCommission(uint percents) external onlyOwner nonReentrant {
        earlyHarvestCommission = percents;
        emit EarlyHarvestCommissionSet(percents);
    }

    /// @notice Owner can set the referral percents
    /// @param percents Referral percents
    function setReferralPercent(uint percents) external onlyOwner nonReentrant {
        referralPercent = percents;
        emit ReferralPercentSet(percents);
    }

    function massUpdatePools() external nonReentrant {
        accountNewRewards();
        _massUpdatePools();
    }

    function _massUpdatePools() internal {
        uint256 length = poolInfo.length;
        unchecked {
            for (uint256 pid = 0; pid < length; ++pid) {
                _updatePool(pid);
            }
        }
    }

    /// @notice Update reward variables of the given pool to be up-to-date
    /// @param _pid Pool index
    function updatePool(uint256 _pid) external nonReentrant {
        accountNewRewards();
        _updatePool(_pid);
    }

    function _updatePool(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.pairToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 rightBlock = block.number > endBlock ? endBlock : block.number;
        uint256 blocks = rightBlock - pool.lastRewardBlock;
        uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
        pool.accRewardPerShare += reward * 1e12 / lpSupply;
        pool.lastRewardBlock = block.number;
    }

    /// @dev some erc20 may have internal transferFee or deflationary mechanism so the actual received amount after transfer will not match the transfer amount
    function _safeTransferFromCheckingBalance(IERC20 token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        require(token.balanceOf(to) - balanceBefore == amount, "transfer amount mismatch");
    }

    /// @notice Deposit LP tokens to the farm. It will try to harvest first
    /// @param _pairAddress The address of LP token
    /// @param _amount Amount of LP tokens to deposit
    /// @param _referral Address of the agent who invited the user
    function deposit(address _pairAddress, uint256 _amount, address _referral) public onlyExistPool(_pairAddress) beforeEndBlock nonReentrant {
        accountNewRewards();
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        _updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.withdrawnReward + user.storedReward;
            if (pending > 0) {
                _rewardTransfer(user, pending, false, _pid);
            }
        }
        if (_amount > 0) {
            _safeTransferFromCheckingBalance(IERC20(pool.pairToken), msg.sender, address(this), _amount);
            user.amount += _amount;
        }
        user.withdrawnReward = user.amount * pool.accRewardPerShare / 1e12;
        user.depositTimestamp = block.timestamp;
        emit Deposit(msg.sender, _pid, _amount);
        if (_referral != address(0) && _referral != msg.sender && referrals[msg.sender] != _referral) {
            referrals[msg.sender] = _referral;
        }
    }

    /// @notice Short version of deposit without refer
    function depositWithoutRefer(address _pairAddress, uint256 _amount) public {
        deposit(_pairAddress, _amount, address(0));
    }

    /// @notice Withdraw LP tokens from the farm. It will try to harvest first
    /// @param _pairAddress The address of LP token
    /// @param _amount Amount of LP tokens to withdraw
    function withdraw(address _pairAddress, uint256 _amount) public onlyExistPool(_pairAddress) {
        accountNewRewards();
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "Too big amount");
        _updatePool(_pid);
        _harvest(_pairAddress);
        uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.withdrawnReward + user.storedReward;
        if (pending > 0) {
            _rewardTransfer(user, pending, true, _pid);
        }
        if (_amount > 0) {
            user.amount -= _amount;
            pool.pairToken.safeTransfer(address(msg.sender), _amount);
        }
        user.withdrawnReward = user.amount * pool.accRewardPerShare / 1e12;
        emit Withdraw(msg.sender, _pid, _amount);
    }

    /// @notice Returns LP tokens to the user with the entire reward reset to zero
    function emergencyWithdraw(address _pairAddress) public {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.pairToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        user.amount = 0;
        user.withdrawnReward = 0;
        user.storedReward = 0;
    }

    function _harvest(address _pairAddress) internal {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        _updatePool(_pid);
        uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.withdrawnReward + user.storedReward;
        if (pending > 0) {
            _rewardTransfer(user, pending, true, _pid);
        }
        user.withdrawnReward = user.amount * pool.accRewardPerShare / 1e12;
    }
    
    /// @notice Harvest reward from the pool and send to the user
    /// @param _pairAddress The address of LP token
    function harvest(address _pairAddress) public onlyExistPool(_pairAddress) {
        _harvest(_pairAddress);
    }

    /// @notice Transfer reward with all checks
    /// @param user UserInfo storage pointer
    /// @param _amount Amount of reward to transfer
    /// @param isWithdraw Set to false if it called by deposit function
    /// @param _pid Pool index
    function _rewardTransfer(UserInfo storage user, uint256 _amount, bool isWithdraw, uint256 _pid) internal {
        bool isEarlyHarvestCommission = block.timestamp - user.depositTimestamp < earlyHarvestCommissionInterval;
        bool isEarlyHarvest = block.timestamp - user.harvestTimestamp < harvestInterval;
        
        if (isEarlyHarvest) {
            user.storedReward = _amount;
        } else {
            uint amount = isWithdraw && isEarlyHarvestCommission
                ? _amount * (HUNDRED_PERCENTS - earlyHarvestCommission) / HUNDRED_PERCENTS
                : _amount;
            uint narfexLeft = getNarfexLeft();
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
                    narfexLeft = getNarfexLeft();
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
    }
}

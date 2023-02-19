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
    }

    struct PoolInfo {
        IERC20 pairToken; // Address of LP token contract
        uint256 allocPoint; // How many allocation points assigned to this pool
        uint256 lastRewardBlock;  // Last block number that NRFX distribution occurs.
        uint256 accRewardPerShare; // Accumulated NRFX per share, times 1e12
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
    }

    /// @notice Count of created pools
    /// @return poolInfo length
    function getPoolsCount() external view returns (uint256) {
        return poolInfo.length;
    }

    /// @notice Returns the soil fertility
    /// @return Reward left in the common pool
    function getNarfexLeft() public view returns (uint) {
        return rewardToken.balanceOf(address(this));
    }

    /// @notice Withdraw amount of reward token to the owner
    /// @param _amount Amount of reward tokens. Can be set to 0 to withdraw all reward tokens
    function withdrawNarfex(uint _amount) external onlyOwner nonReentrant {
        uint amount = _amount > 0
            ? _amount
            : getNarfexLeft();
        rewardToken.safeTransfer(address(msg.sender), amount);
    }

    /// @notice Add a new pool
    /// @param _allocPoint Allocation point for this pool
    /// @param _pairToken Address of LP token contract
    /// @param _withUpdate Force update all pools
    function add(uint256 _allocPoint, address _pairToken, bool _withUpdate) external onlyOwner nonReentrant {
        require(address(poolInfo[poolId[_pairToken]].pairToken) == address(0), "already exists");
        if (_withUpdate) {
            _massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint + _allocPoint;
        emit TotalAllocPointUpdated(totalAllocPoint);
        poolInfo.push(PoolInfo({
            pairToken: IERC20(_pairToken),
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accRewardPerShare: 0
        }));
        poolId[_pairToken] = poolInfo.length - 1;
        emit PoolAdded({
            pid: poolId[_pairToken],
            pairToken: _pairToken,
            allocPoint: _allocPoint
        });
    }

    /// @notice Update allocation points for a pool
    /// @param _pid Pool index
    /// @param _allocPoint Allocation points
    /// @param _withUpdate Force update all pools
    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) external onlyOwner nonReentrant {
        if (_withUpdate) {
            _massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint + _allocPoint - poolInfo[_pid].allocPoint;
        emit TotalAllocPointUpdated(totalAllocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
        emit PoolAllocPointSet({
            pid: _pid,
            allocPoint: _allocPoint
        });
    }

    /// @notice Set a new reward per block amount
    /// @param _amount Amount of reward tokens per block
    /// @param _withUpdate Force update pools to fix previous rewards
    function setRewardPerBlock(uint256 _amount, bool _withUpdate) external onlyOwner nonReentrant {
        if (_withUpdate) {
            _massUpdatePools();
        }
        rewardPerBlock = _amount;
        emit RewardPerBlockSet(_amount);
    }

    /// @notice Calculates the user's reward based on a blocks range
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return reward size
    /// @dev Only for frontend view
    function getUserReward(address _pairAddress, address _user) public view returns (uint256) {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = pool.pairToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 blocks = block.number - pool.lastRewardBlock;
            uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
            accRewardPerShare += reward * 1e12 / lpSupply;
        }
        return user.amount * accRewardPerShare / 1e12 - user.withdrawnReward;
    }

    /// @notice If enough time has passed since the last harvest
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return true if user can harvest
    function getIsUserCanHarvest(address _pairAddress, address _user) internal view returns (bool) {
        uint256 _pid = poolId[_pairAddress];
        UserInfo storage user = userInfo[_pid][_user];
        bool isEarlyHarvest = block.timestamp - user.harvestTimestamp < harvestInterval;
        return !isEarlyHarvest;
    }

    /// @notice If enough time has passed since the last deposit
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return true if user can withdraw without loosing some reward
    function getIsEarlyWithdraw(address _pairAddress, address _user) internal view returns (bool) {
        uint256 _pid = poolId[_pairAddress];
        UserInfo storage user = userInfo[_pid][_user];
        bool isEarlyWithdraw = block.timestamp - user.depositTimestamp < earlyHarvestCommissionInterval;
        return !isEarlyWithdraw;
    }

    /// @notice Returns user's amount of LP tokens
    /// @param _pairAddress The address of LP token
    /// @param _user The user address
    /// @return user's pool size
    function getUserPoolSize(address _pairAddress, address _user) public view returns (uint) {
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
    function getPoolData(address _pairAddress) public view returns (
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
    function getPoolUserData(address _pairAddress, address _user) public view returns (
        uint balance,
        uint userPool,
        uint256 reward,
        bool isCanHarvest
    ) {
        return (
            IPancakePair(_pairAddress).balanceOf(_user),
            userInfo[poolId[_pairAddress]][_user].amount,
            getUserReward(_pairAddress, _user),
            getIsUserCanHarvest(_pairAddress, _user)
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
        uint256 blocks = block.number - pool.lastRewardBlock;
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
    function deposit(address _pairAddress, uint256 _amount, address _referral) public nonReentrant {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        _updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.withdrawnReward;
            if (pending > 0) {
                rewardTransfer(user, pending, false, _pid);
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
    function deposit(address _pairAddress, uint256 _amount) public {
        deposit(_pairAddress, _amount, address(0));
    }

    /// @notice Withdraw LP tokens from the farm. It will try to harvest first
    /// @param _pairAddress The address of LP token
    /// @param _amount Amount of LP tokens to withdraw
    function withdraw(address _pairAddress, uint256 _amount) public {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "Too big amount");
        _updatePool(_pid);
        uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.withdrawnReward;
        if (pending > 0) {
            rewardTransfer(user, pending, true, _pid);
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
    }

    /// @notice Harvest reward from the pool and send to the user
    /// @param _pairAddress The address of LP token
    function harvest(address _pairAddress) public {
        uint256 _pid = poolId[_pairAddress];
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        _updatePool(_pid);
        uint256 pending = user.amount * pool.accRewardPerShare / 1e12 - user.withdrawnReward;
        if (pending > 0) {
            rewardTransfer(user, pending, true, _pid);
        }
        user.withdrawnReward = user.amount * pool.accRewardPerShare / 1e12;
    }

    /// @notice Transfer reward with all checks
    /// @param user UserInfo storage pointer
    /// @param _amount Amount of reward to transfer
    /// @param isWithdraw Set to false if it called by deposit function
    /// @param _pid Pool index
    function rewardTransfer(UserInfo storage user, uint256 _amount, bool isWithdraw, uint256 _pid) internal {
        bool isEarlyHarvestCommission = block.timestamp - user.depositTimestamp < earlyHarvestCommissionInterval;
        bool isEarlyHarvest = block.timestamp - user.harvestTimestamp < harvestInterval;
        
        if (isEarlyHarvest) {
            revert("too early");
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
            user.harvestTimestamp = block.timestamp;
        }
    }
}
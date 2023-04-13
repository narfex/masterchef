//// SPDX-License-Identifier: MIT
//
//pragma solidity ^0.8.17;
//
//import "@openzeppelin/contracts/security/Pausable.sol";
//import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
//import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
//import "@openzeppelin/contracts/utils/math/Math.sol";
//import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
//import "@openzeppelin/contracts/access/Ownable.sol";
//import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
//import "./utils/EmergencyState.sol";
//
//interface IPancakePair {
//    function balanceOf(address owner) external view returns (uint);
//    function token0() external view returns (address);
//    function token1() external view returns (address);
//}
//
//contract MasterChef is Ownable, ReentrancyGuard, Pausable, EmergencyState {
//    using SafeERC20 for IERC20;
//
//    // User share of a pool
//    struct UserInfo {
//        uint amount; // Amount of LP-tokens deposit
//        uint withdrawnReward; // Reward already withdrawn
//        uint depositTimestamp; // Last deposit time
//        uint harvestTimestamp; // Last harvest time
//        uint storedReward; // Reward tokens accumulated in contract (not paid yet)
//    }
//
//    struct PoolInfo {
//        bool exist;  // default storage slot value is false, set true on adding
//        IERC20 pairToken; // Address of LP token contract
//        uint256 allocPoint; // How many allocation points assigned to this pool
//        uint256 lastRewardBlock;  // Last block number that NRFX distribution occurs.
//        uint256 accRewardPerShare; // Accumulated NRFX per share, times ACC_REWARD_PRECISION=1e12
//        uint256 totalDeposited; // Total amount of LP-tokens deposited
//    }
//
//    uint256 constant internal ACC_REWARD_PRECISION = 1e12;
//
//    IERC20 public immutable rewardToken;
//
//    uint256 public earlyHarvestCommissionInterval = 14 days;
//
//    uint256 public harvestInterval = 8 hours;
//
//    uint256 public earlyHarvestCommission = 1000;  // 1000 = 10%
//
//    uint256 public constant referralPercent = 60;  // 60 = 0.6%
//
//    address public feeTreasury;
//
//    uint256 constant public HUNDRED_PERCENTS = 10000;
//
//    PoolInfo[] public poolInfo;
//
//    mapping (uint256 /*poolId*/ => mapping (address => UserInfo)) public userInfo;
//
//    mapping (address => uint256) public poolId;
//
//    mapping (address => address) public referrals;
//
//    uint256 public totalAllocPoint = 0;
//
//    uint256 public immutable startBlock;
//    uint256 public endBlock;
//
//    uint256 public lastRewardTokenBalance;
//    uint256 public restUnallocatedRewards;
//
//    uint256 public rewardPerBlock;
//    address public rewardPerBlockUpdater;
//    uint256 public blockchainBlocksPerDay; // Value is 40,000 on Polygon - https://flipsidecrypto.xyz/niloofar-discord/polygon-block-performance-sMKJcS
//    uint256 public estimationRewardPeriodDays; // For example, if set to 100, 1/100 of the remaining rewards will be allocated each day
//
//    constructor(
//        address _rewardToken,
//        uint256 _rewardPerBlock,
//        address _feeTreasury
//    ) {
//        require(_rewardToken != address(0), "zero address");
//        rewardToken = IERC20(_rewardToken);
//        rewardPerBlock = _rewardPerBlock;
//        startBlock = block.number;
//        endBlock = block.number;
//        require(_feeTreasury != address(0), "zero address");
//        feeTreasury = _feeTreasury;
//    }
//
//
//    function setRewardPerBlockUpdater(address _newUpdater) external onlyOwner nonReentrant {
//        rewardPerBlockUpdater = _newUpdater;
//    }
//
//    function setBlockchainBlocksPerDay(uint256 _newBlocksPerDay) external onlyOwner nonReentrant {
//        blockchainBlocksPerDay = _newBlocksPerDay;
//    }
//
//    function setEstimationRewardPeriodDays(uint256 _newRewardPeriodDays) external onlyOwner nonReentrant {
//        estimationRewardPeriodDays = _newRewardPeriodDays;
//    }
//
//    function recalculateRewardPerBlock() external nonReentrant {
//        require(msg.sender == owner() || msg.sender == rewardPerBlockUpdater, "no access");
//        require(estimationRewardPeriodDays != 0, "estimationRewardPeriodDays is zero");
//        require(blockchainBlocksPerDay != 0, "blockchainBlocksPerDay is zero");
//
//        _accountNewRewards();
//        _massUpdatePools();
//
//        uint256 _futureUnallocatedRewards = futureUnallocatedRewards();
//        uint256 newRewardPerBlock = _futureUnallocatedRewards / (estimationRewardPeriodDays * blockchainBlocksPerDay);
//
//        _setRewardPerBlock(newRewardPerBlock);
//    }
//
//    function accountNewRewards() external nonReentrant {
//        _accountNewRewards();
//    }
//
//    function _accountNewRewards() internal {
//        uint256 currentBalance = getNarfexBalance();
//        uint256 newRewardsAmount = currentBalance - lastRewardTokenBalance;
//        if (newRewardsAmount == 0) {
//            return;
//        }
//        uint256 _rewardPerBlockWithReferralPercent = rewardPerBlockWithReferralPercent();
//        lastRewardTokenBalance = currentBalance;  // account new balance
//        uint256 newRewardsToAccount = newRewardsAmount + restUnallocatedRewards;
//        if ((block.number > endBlock) && (startBlock != endBlock)) {
//            if (newRewardsToAccount > _rewardPerBlockWithReferralPercent) {
//                // if there are more rewards than the reward per block, then we need to extend the end block
//
//                _massUpdatePools();  // set all poolInfo.lastRewardBlock=block.number
//
//                uint256 deltaBlocks = newRewardsToAccount / _rewardPerBlockWithReferralPercent;
//                endBlock = block.number + deltaBlocks;  // start give rewards AGAIN from block.number
//                restUnallocatedRewards = newRewardsToAccount - deltaBlocks * _rewardPerBlockWithReferralPercent;  // (newRewardsAmount + restUnallocatedRewards) % rewardPerBlockWithReferralPercent
//                return;
//            }
//
//            // accumulate rewards in `restUnallocatedRewards` after the end block
//            // note that if startBlock == endBlock it will make initial endBlock setting
//            restUnallocatedRewards = newRewardsToAccount;
//            return;
//        }
//        uint256 _deltaBlocks = newRewardsToAccount / _rewardPerBlockWithReferralPercent;
//        endBlock += _deltaBlocks;
//        restUnallocatedRewards = newRewardsToAccount - _deltaBlocks * _rewardPerBlockWithReferralPercent;  // (newRewardsAmount + restUnallocatedRewards) % rewardPerBlockWithReferralPercent
//    }
//
//    function rewardPerBlockWithReferralPercent() public view returns(uint256) {
//        return rewardPerBlock * (HUNDRED_PERCENTS + referralPercent) / HUNDRED_PERCENTS;
//    }
//
//    function getNarfexBalance() public view returns (uint) {
//        return rewardToken.balanceOf(address(this));
//    }
//
//    function futureUnallocatedRewards() public view returns(uint256) {
//        if (block.number >= endBlock) {
//            return restUnallocatedRewards;
//        } else {
//            uint256 futureBlocks = endBlock - block.number;
//            uint256 _rewardPerBlockWithReferralPercent = rewardPerBlockWithReferralPercent();
//            return _rewardPerBlockWithReferralPercent * futureBlocks + restUnallocatedRewards;
//        }
//    }
//
//    function calculateFutureRewardAllocationWithArgs(
//        uint256 _rewards,
//        uint256 _rewardPerBlock
//    ) public view returns(
//        uint256 _endBlock,
//        uint256 _rest
//    ) {
//        uint256 blocks = _rewards / _rewardPerBlock;
//        _endBlock = block.number + blocks;
//        _rest = _rewards - blocks * _rewardPerBlock;
//    }
//
//    function withdrawNarfexByOwner(uint256 amount) external onlyOwner nonReentrant {
//        // Validate the withdrawal amount
//        require(amount > 0, "zero amount");
//        require(amount <= getNarfexBalance(), "Not enough reward tokens left");
//
//        _accountNewRewards();
//
//        // Calculate the remaining rewards
//        uint256 _futureUnallocatedRewards = futureUnallocatedRewards();
//        require(amount <= _futureUnallocatedRewards, "not enough unallocated rewards");
//
//        // Calculate the new unallocated rewards after the withdrawal
//        uint256 newUnallocatedRewards = _futureUnallocatedRewards - amount;
//
//        // Update the end block and remaining unallocated rewards
//        (endBlock, restUnallocatedRewards) = calculateFutureRewardAllocationWithArgs(newUnallocatedRewards, rewardPerBlockWithReferralPercent());
//
//        // Transfer the withdrawn amount to the contract owner's address
//        _transferNRFX(msg.sender, amount);
//    }
//
//    modifier onlyExistPool(address _pairAddress) {
//        require(poolExists(_pairAddress), "pool not exist");
//        _;
//    }
//
//    function poolExists(address _pairAddress) public view returns(bool) {
//        if (poolInfo.length == 0) {  // prevent out of bounds error
//            return false;
//        }
//        return poolInfo[poolId[_pairAddress]].exist;
//    }
//
//    function add(uint256 _allocPoint, address _pairAddress) external onlyOwner nonReentrant {
//        require(!poolExists(_pairAddress), "already exists");
//        _massUpdatePools();
//        uint256 lastRewardBlock = Math.max(block.number, startBlock);
//        totalAllocPoint = totalAllocPoint + _allocPoint;
//        poolInfo.push(PoolInfo({
//            pairToken: IERC20(_pairAddress),
//            allocPoint: _allocPoint,
//            lastRewardBlock: lastRewardBlock,
//            accRewardPerShare: 0,
//            exist: true,
//            totalDeposited: 0
//        }));
//        poolId[_pairAddress] = poolInfo.length - 1;
//    }
//
//    function setRewardPerBlock(uint256 _amount) external onlyOwner nonReentrant {
//        _setRewardPerBlock(_amount);
//    }
//
//    function _setRewardPerBlock(uint256 newRewardPerBlock) internal {
//        _accountNewRewards();
//        _massUpdatePools();  // set poolInfo.lastRewardBlock=block.number
//
//        uint256 futureRewards = futureUnallocatedRewards();
//        rewardPerBlock = newRewardPerBlock;
//
//        // endBlock = currentBlock + unallocatedRewards / rewardPerBlock
//        // so now we should update the endBlock since rewardPerBlock was changed
//        uint256 _rewardPerBlockWithReferralPercent = rewardPerBlockWithReferralPercent();
//        uint256 deltaBlocks = futureRewards / _rewardPerBlockWithReferralPercent;
//        endBlock = block.number + deltaBlocks;
//        restUnallocatedRewards = futureRewards - deltaBlocks * _rewardPerBlockWithReferralPercent;
//    }
//
//    function _calculateUserReward(
//        UserInfo storage user,
//        uint256 _accRewardPerShare
//    ) internal view returns (uint256) {
//        return user.amount * _accRewardPerShare / ACC_REWARD_PRECISION - user.withdrawnReward + user.storedReward;
//    }
//
//    function setEarlyHarvestCommissionInterval(uint interval) external onlyOwner nonReentrant {
//        earlyHarvestCommissionInterval = interval;
//        emit EarlyHarvestCommissionIntervalSet(interval);
//    }
//
//    function setHarvestInterval(uint interval) external onlyOwner nonReentrant {
//        harvestInterval = interval;
//        emit HarvestIntervalSet(interval);
//    }
//
//    function setEarlyHarvestCommission(uint percents) external onlyOwner nonReentrant {
//        earlyHarvestCommission = percents;
//        emit EarlyHarvestCommissionSet(percents);
//    }
//
//    function massUpdatePools() external nonReentrant {
//        _accountNewRewards();
//        _massUpdatePools();
//    }
//
//    function _massUpdatePools() internal {
//        uint256 length = poolInfo.length;
//        unchecked {
//            for (uint256 pid = 0; pid < length; ++pid) {
//                _updatePool(pid);
//            }
//        }
//    }
//
//    function updatePool(uint256 _pid) external nonReentrant {
//        _accountNewRewards();
//        _updatePool(_pid);
//    }
//
//    function _updatePool(uint256 _pid) internal {  // todo tricky enable disable
//        PoolInfo storage pool = poolInfo[_pid];
//        if (block.number <= pool.lastRewardBlock) {
//            return;
//        }
//        uint256 lpSupply = pool.totalDeposited;
//        if (lpSupply == 0) {
//            // WARNING: always keep some small deposit in every pool
//            // there could be a small problem if no one will deposit in the pool with e.g. 30% allocation point
//            // then the reward for this 30% alloc points will never be distributed
//            // however endBlock is already set, so no one will harvest the.
//            // But fixing this problem with math would increase complexity of the code.
//            // So just let the owner to keep 1 lp token in every pool to mitigate this problem.
//            pool.lastRewardBlock = block.number;
//            return;
//        }
//        uint256 rightBlock = Math.min(block.number, endBlock);
//        uint256 leftBlock = Math.max(pool.lastRewardBlock, startBlock);
//        if (rightBlock <= leftBlock) {
//           pool.lastRewardBlock = block.number;
//           return;  // after endBlock passed we continue to scroll lastRewardBlock with no update of accRewardPerShare
//        }
//        uint256 blocks = rightBlock - leftBlock;
//        uint256 reward = blocks * rewardPerBlock * pool.allocPoint / totalAllocPoint;
//        pool.accRewardPerShare += reward * ACC_REWARD_PRECISION / lpSupply;
//        pool.lastRewardBlock = block.number;
//    }
//
//    function _safeTransferFromCheckingBalance(IERC20 token, address from, address to, uint256 amount) internal {
//        uint256 balanceBefore = token.balanceOf(to);
//        token.safeTransferFrom(from, to, amount);
//        require(token.balanceOf(to) - balanceBefore == amount, "transfer amount mismatch");
//    }
//
//    function deposit(address _pairAddress, uint256 _amount, address _referral) public onlyExistPool(_pairAddress) nonReentrant whenNotPaused notEmergency {
//        _accountNewRewards();
//        uint256 _pid = poolId[_pairAddress];
//        PoolInfo storage pool = poolInfo[_pid];
//        UserInfo storage user = userInfo[_pid][msg.sender];
//        _updatePool(_pid);
//
//        if (user.amount > 0) {
//            uint256 pending = _calculateUserReward(user, pool.accRewardPerShare);
//            if (pending > 0) {
//                _rewardTransfer({user: user, _amount: pending, isWithdraw: false, _pid: _pid});
//            }
//        }
//        if (_amount > 0) {
//            _safeTransferFromCheckingBalance(IERC20(pool.pairToken), msg.sender, address(this), _amount);
//            user.amount += _amount;
//            pool.totalDeposited += _amount;
//        }
//        user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;
//        user.depositTimestamp = block.timestamp;
//        emit Deposit(msg.sender, _pid, _amount);
//        if (_referral != address(0) && _referral != msg.sender && referrals[msg.sender] != _referral) {
//            referrals[msg.sender] = _referral;
//        }
//    }
//
//    function depositWithoutRefer(address _pairAddress, uint256 _amount) public {
//        deposit(_pairAddress, _amount, address(0));
//    }
//
//    function withdraw(address _pairAddress, uint256 _amount) public nonReentrant onlyExistPool(_pairAddress) whenNotPaused notEmergency {
//        _accountNewRewards();
//        uint256 _pid = poolId[_pairAddress];
//        PoolInfo storage pool = poolInfo[_pid];
//        UserInfo storage user = userInfo[_pid][msg.sender];
//        _updatePool(_pid);
//
//        require(user.amount >= _amount, "Too big amount");
//        _harvest(_pairAddress);
//        if (_amount > 0) {
//            user.amount -= _amount;
//            pool.totalDeposited -= _amount;
//            pool.pairToken.safeTransfer(address(msg.sender), _amount);
//        }
//        user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;
//    }
//
//    function justWithdrawWithNoReward(address _pairAddress) public nonReentrant onlyExistPool(_pairAddress) {
//        uint256 _pid = poolId[_pairAddress];
//        PoolInfo storage pool = poolInfo[_pid];
//        UserInfo storage user = userInfo[_pid][msg.sender];
//        uint256 amount = user.amount;
//        user.amount = 0;
//        user.withdrawnReward = 0;
//        user.storedReward = 0;
//        pool.pairToken.safeTransfer(address(msg.sender), amount);
//    }
//
//    function _harvest(address _pairAddress) internal {
//        uint256 _pid = poolId[_pairAddress];
//        PoolInfo storage pool = poolInfo[_pid];
//        UserInfo storage user = userInfo[_pid][msg.sender];
//        _updatePool(_pid);
//        uint256 pending = _calculateUserReward(user, pool.accRewardPerShare);
//        if (pending > 0) {
//            _rewardTransfer({user: user, _amount: pending, isWithdraw: true, _pid: _pid});
//        }
//        user.withdrawnReward = user.amount * pool.accRewardPerShare / ACC_REWARD_PRECISION;
//    }
//
//    function harvest(address _pairAddress) public onlyExistPool(_pairAddress) whenNotPaused notEmergency nonReentrant {
//        _harvest(_pairAddress);
//    }
//
//    function _rewardTransfer(
//        UserInfo storage user,
//        uint256 _amount,
//        bool isWithdraw,
//        uint256 _pid
//    ) internal {
//        bool isEarlyHarvestCommission = block.timestamp - user.depositTimestamp < earlyHarvestCommissionInterval;
//        bool isEarlyHarvest = block.timestamp - user.harvestTimestamp < harvestInterval;
//
//        if (isEarlyHarvest) {
//            user.storedReward = _amount;
//            return;
//        }
//
//        uint amountToUser = _amount;
//        if (isWithdraw && isEarlyHarvestCommission) {
//            uint256 fee = earlyHarvestCommission / HUNDRED_PERCENTS;
//            amountToUser = _amount - fee;
//            _transferNRFX(feeTreasury, fee);
//        }
//
//        uint256 harvestedAmount = _transferNRFX(msg.sender, amountToUser);
//
//        // Send referral reward
//        address referral = referrals[msg.sender];
//        uint256 referralAmount = _amount * referralPercent / HUNDRED_PERCENTS;  // note: initial _amount not amountToUser
//        if (referral != address(0)) {
//            uint256 referralRewardPaid = _transferNRFX(referral, referralAmount);
//        } else {
//            uint256 referralRewardPaid = _transferNRFX(feeTreasury, referralAmount);
//        }
//
//        user.storedReward = 0;
//        user.harvestTimestamp = block.timestamp;
//    }
//
//    function _transferNRFX(address to, uint256 amount) internal returns(uint256) {
//        // Get the remaining NRFX tokens
//        uint256 narfexLeft = getNarfexBalance();
//
//        // If the remaining NRFX tokens are less than the specified amount, transfer the remaining amount of NRFX tokens
//        if (narfexLeft < amount) {
//            amount = narfexLeft;
//        }
//        if (amount > 0) {
//            rewardToken.safeTransfer(to, amount);
//            lastRewardTokenBalance -= amount;
//        }
//        return amount;
//    }
//}

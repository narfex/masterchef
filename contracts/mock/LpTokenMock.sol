// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LpTokenMock is ERC20, Ownable {
    address public token0;
    address public token1;

    constructor(address _token0, address _token1) ERC20("lpToken", "LPT") {
        token0 = _token0;
        token1 = _token1;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
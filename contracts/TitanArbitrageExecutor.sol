// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

interface IWETH {
    function withdraw(uint wad) external;
}

contract TitanArbitrageExecutor is FlashLoanSimpleReceiverBase {
    address payable public immutable owner;
    address public immutable botExecutor;
    bool public isKilled;

    // We pass the PM2 Bot's runtime wallet as _botExecutor so it doesn't get locked out from trading!
    constructor(address _addressProvider, address _botExecutor) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider)) {
        owner = payable(_botExecutor); // Updated to match your gas-paying wallet
        botExecutor = _botExecutor; 
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "UNAUTHORIZED: Master Operator Only");
        _;
    }

    modifier onlyExecutor() {
        require(!isKilled, "KILLED: Emergency circuit breaker active");
        require(msg.sender == owner || msg.sender == botExecutor || msg.sender == address(this), "UNAUTHORIZED: Executor Only");
        _;
    }

    /**
        This function is called after your contract has received the flash loaned amount
    */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "CALLER_MUST_BE_POOL");
        require(initiator == address(this), "INITIATOR_MUST_BE_ROUTER");

        uint256 startBalance = IERC20(asset).balanceOf(address(this));
        
        // ─── TITAN ZERO-SLIPPAGE DEX PATHING GOES HERE ───
        (address[] memory targets, bytes[] memory payloads) = abi.decode(params, (address[], bytes[]));
        require(targets.length == payloads.length, "MISMATCHED_ARRAYS");

        // Dynamically loop execution over the supplied targets natively mapped by our Node.js TX Router
        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, ) = targets[i].call(payloads[i]);
            require(success, "DEX_ROUTING_FAULT");
        }

        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        uint256 amountToRepay = amount + premium;
        
        // Assert the executed payload made enough pure MEV profit to clear the Aave flashloan cost physically
        require(finalBalance >= startBalance + premium, "AAVE_FLASH_SLIPPAGE_REVERT");
        
        // Approve Pool to repayment
        IERC20(asset).approve(address(POOL), amountToRepay);

        return true;
    }

    // Notice we modified params to dynamically accept the "_params" bytes arrays from our Javascript payload encoder!
    function requestFlashLoan(address _token, uint256 _amount, bytes calldata _params) public onlyExecutor {
        POOL.flashLoanSimple(
            address(this),
            _token,
            _amount,
            _params,
            0
        );
    }

    function emergencySweep(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "ZERO_BALANCE");
        IERC20(token).transfer(owner, bal);
    }

    function sweepETH() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "ZERO_ETH_BALANCE");
        (bool success, ) = owner.call{value: bal}("");
        require(success, "ETH_TRANSFER_FAILED");
    }

    function killSwitch() external onlyOwner {
        isKilled = !isKilled; // Toggles the circuit breaker
    }

    function unwrapWETH(address weth, uint256 amount) external onlyExecutor {
        IWETH(weth).withdraw(amount);
    }

    function bribeMiner(uint256 amount) external onlyExecutor {
        require(address(this).balance >= amount, "INSUFFICIENT_ETH_FOR_BRIBE");
        block.coinbase.transfer(amount);
    }

    receive() external payable {}
}

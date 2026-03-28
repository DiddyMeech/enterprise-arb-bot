// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

contract TitanArbitrageExecutor is FlashLoanSimpleReceiverBase {
    address payable public immutable owner;
    address public immutable botExecutor;

    // We pass the PM2 Bot's runtime wallet as _botExecutor so it doesn't get locked out from trading!
    constructor(address _addressProvider, address _botExecutor) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider)) {
        owner = payable(0x9A2A3FF591F97EC358b8eE37Ca9a437D5DC34080); // Restored correct ownership routing
        botExecutor = _botExecutor; 
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "UNAUTHORIZED: Master Operator Only");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == owner || msg.sender == botExecutor, "UNAUTHORIZED: Executor Only");
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

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

contract TitanArbitrageExecutor is FlashLoanSimpleReceiverBase {
    enum DexKind {
        V2,
        V3
    }

    struct FlashLeg {
        uint8 dexKind;
        address router;
        address tokenIn;
        address tokenOut;
        uint256 amountInRaw;
        uint256 minOutRaw;
        uint24 fee;
    }

    struct FlashRoute {
        address profitToken;
        uint256 minProfitRaw;
        uint256 deadline;
        FlashLeg[] legs;
    }

    address public immutable owner;
    address public immutable botExecutor;

    bool public paused;
    bool public killed;

    mapping(address => bool) public approvedRouters;
    mapping(address => bool) public approvedTokens;

    event FlashLoanRequested(address indexed asset, uint256 amount);
    event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit);
    event RouterSet(address indexed router, bool allowed);
    event TokenSet(address indexed token, bool allowed);
    event PausedSet(bool paused);
    event KilledSet(bool killed);

    constructor(address addressProvider, address _botExecutor)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(addressProvider))
    {
        require(addressProvider != address(0), "BAD_PROVIDER");
        require(_botExecutor != address(0), "BAD_EXECUTOR");

        owner = _botExecutor;
        botExecutor = _botExecutor;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyExecutor() {
        require(!killed, "KILLED");
        require(msg.sender == owner || msg.sender == botExecutor, "NOT_EXECUTOR");
        _;
    }

    modifier notPaused() {
        require(!paused, "PAUSED");
        _;
    }

    function setRouter(address router, bool allowed) external onlyOwner {
        require(router != address(0), "BAD_ROUTER");
        approvedRouters[router] = allowed;
        emit RouterSet(router, allowed);
    }

    function setToken(address token, bool allowed) external onlyOwner {
        require(token != address(0), "BAD_TOKEN");
        approvedTokens[token] = allowed;
        emit TokenSet(token, allowed);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    function setKilled(bool value) external onlyOwner {
        killed = value;
        emit KilledSet(value);
    }

    function requestFlashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyExecutor notPaused {
        require(asset != address(0), "BAD_ASSET");
        require(amount > 0, "BAD_AMOUNT");
        require(approvedTokens[asset], "ASSET_NOT_ALLOWED");

        emit FlashLoanRequested(asset, amount);

        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0
        );
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "ONLY_POOL");
        require(initiator == address(this), "BAD_INITIATOR");
        require(!paused && !killed, "INACTIVE");

        FlashRoute memory route = abi.decode(params, (FlashRoute));

        require(route.profitToken == asset, "PROFIT_TOKEN_MISMATCH");
        require(route.legs.length >= 2, "MIN_2_LEGS");
        require(route.deadline >= block.timestamp, "DEADLINE");
        require(approvedTokens[asset], "ASSET_NOT_ALLOWED");

        uint256 startBalance = IERC20(asset).balanceOf(address(this));
        uint256 currentAmount = amount;
        address currentToken = asset;

        for (uint256 i = 0; i < route.legs.length; i++) {
            FlashLeg memory leg = route.legs[i];

            require(approvedRouters[leg.router], "ROUTER_NOT_ALLOWED");
            require(approvedTokens[leg.tokenIn], "TOKEN_IN_NOT_ALLOWED");
            require(approvedTokens[leg.tokenOut], "TOKEN_OUT_NOT_ALLOWED");
            require(leg.tokenIn == currentToken, "TOKEN_FLOW_MISMATCH");

            uint256 amountInToUse = leg.amountInRaw == 0 ? currentAmount : leg.amountInRaw;
            require(amountInToUse == currentAmount, "AMOUNT_FLOW_MISMATCH");

            _safeApprove(leg.tokenIn, leg.router, 0);
            _safeApprove(leg.tokenIn, leg.router, amountInToUse);

            uint256 amountOut;

            if (leg.dexKind == uint8(DexKind.V2)) {
                amountOut = _swapV2(
                    leg.router,
                    leg.tokenIn,
                    leg.tokenOut,
                    amountInToUse,
                    leg.minOutRaw,
                    route.deadline
                );
            } else if (leg.dexKind == uint8(DexKind.V3)) {
                amountOut = _swapV3(
                    leg.router,
                    leg.tokenIn,
                    leg.tokenOut,
                    amountInToUse,
                    leg.minOutRaw,
                    leg.fee
                );
            } else {
                revert("BAD_DEX_KIND");
            }

            currentAmount = amountOut;
            currentToken = leg.tokenOut;
        }

        require(currentToken == asset, "FINAL_ASSET_MISMATCH");

        uint256 owed = amount + premium;
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));

        require(finalBalance >= owed, "CANNOT_REPAY");

        uint256 profit = finalBalance - owed;
        require(profit >= route.minProfitRaw, "LOW_PROFIT");

        _safeApprove(asset, address(POOL), 0);
        _safeApprove(asset, address(POOL), owed);

        emit FlashLoanExecuted(asset, amount, premium, profit);
        return true;
    }

    function rescueToken(address token, uint256 amount, address to) external onlyOwner {
        require(to != address(0), "BAD_TO");
        require(IERC20(token).transfer(to, amount), "RESCUE_FAIL");
    }

    function _swapV2(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint256 deadline
    ) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256[] memory amounts = IUniswapV2Router02(router).swapExactTokensForTokens(
            amountIn,
            minOut,
            path,
            address(this),
            deadline
        );

        return amounts[amounts.length - 1];
    }

    function _swapV3(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint24 fee
    ) internal returns (uint256) {
        ISwapRouterV3.ExactInputSingleParams memory p =
            ISwapRouterV3.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            });

        return ISwapRouterV3(router).exactInputSingle(p);
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        require(IERC20(token).approve(spender, amount), "APPROVE_FAIL");
    }
}

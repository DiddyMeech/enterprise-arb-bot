// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract ArbitrageExecutor {
    address public owner;
    bool public paused;

    mapping(address => bool) public approvedRouters;
    mapping(address => bool) public approvedTokens;

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier notPaused() {
        require(!paused, "PAUSED");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setRouter(address router, bool allowed) external onlyOwner {
        approvedRouters[router] = allowed;
    }

    function setToken(address token, bool allowed) external onlyOwner {
        approvedTokens[token] = allowed;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        address[] calldata routers,
        uint256[] calldata legMinOuts,
        uint256 minProfit,
        uint256 deadline
    ) external onlyOwner notPaused returns (uint256) {

        require(routers.length >= 2, "MIN_2_LEGS");
        require(routers.length == legMinOuts.length, "LEG_MISMATCH");
        require(approvedTokens[tokenA] && approvedTokens[tokenB], "TOKEN_NOT_ALLOWED");
        require(deadline >= block.timestamp, "DEADLINE");

        uint256 startBalance = IERC20(tokenA).balanceOf(address(this));
        uint256 currentAmount = amountIn;
        address currentToken = tokenA;

        for (uint i = 0; i < routers.length; i++) {
            address router = routers[i];
            require(approvedRouters[router], "ROUTER_NOT_ALLOWED");

            address nextToken = (i == 0) ? tokenB : tokenA;

            IERC20(currentToken).approve(router, 0);
            IERC20(currentToken).approve(router, currentAmount);

            address[] memory path = new address[](2);
            path[0] = currentToken;
            path[1] = nextToken;

            uint[] memory amounts = IUniswapV2Router02(router)
                .swapExactTokensForTokens(
                    currentAmount,
                    legMinOuts[i],
                    path,
                    address(this),
                    deadline
                );

            currentAmount = amounts[amounts.length - 1];
            currentToken = nextToken;
        }

        uint256 endBalance = IERC20(tokenA).balanceOf(address(this));
        require(endBalance >= startBalance, "LOSS");

        uint256 profit = endBalance - startBalance;
        require(profit >= minProfit, "LOW_PROFIT");

        return profit;
    }

    function withdraw(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "NOTHING_TO_WITHDRAW");
        (bool ok, ) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", owner, bal)
        );
        require(ok, "TRANSFER_FAILED");
    }

    receive() external payable {}
}

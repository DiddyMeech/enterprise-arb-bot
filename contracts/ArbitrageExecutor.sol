// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
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

// Phase 1 Executor (Zero Flash Loans initially - strict allowlists)
contract ArbitrageExecutor {
    address public immutable owner;
    
    // Risk Controls - Core features 
    bool public isPaused;
    mapping(address => bool) public approvedRouters;
    mapping(address => bool) public approvedTokens;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call");
        _;
    }

    modifier whenNotPaused() {
        require(!isPaused, "Contract is currently paused via killswitch");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // executeArbitrage performs sequential swaps with per-leg slippage protection.
    // legMinOuts[i] = minimum tokens out for swap i (computed off-chain with slippage tolerance).
    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        address[] calldata routers,
        uint256[] calldata legMinOuts,
        uint256 minProfit,
        uint256 deadline
    ) external onlyOwner whenNotPaused returns (uint256) {
        require(routers.length >= 2,               "Need at least 2 legs");
        require(routers.length <= 3,               "Max route hops exceeded");
        require(routers.length == legMinOuts.length, "Leg mins mismatch");
        require(approvedTokens[tokenA] && approvedTokens[tokenB], "Token not in allowlist");
        require(block.timestamp <= deadline,       "Deadline expired");

        uint256 startBalance = IERC20(tokenA).balanceOf(address(this));
        uint256 currentAmount = amountIn;
        address currentToken = tokenA;

        for (uint i = 0; i < routers.length; i++) {
            address router = routers[i];
            require(approvedRouters[router], "Router not approved");

            address nextToken = (i == 0) ? tokenB : tokenA;

            // Reset allowance to 0 first (USDT-style double-spend guard)
            IERC20(currentToken).approve(router, 0);
            IERC20(currentToken).approve(router, currentAmount);

            address[] memory path = new address[](2);
            path[0] = currentToken;
            path[1] = nextToken;

            uint256[] memory amountsOut = IUniswapV2Router02(router).swapExactTokensForTokens(
                currentAmount,
                legMinOuts[i],   // ← per-leg slippage protection (not 1)
                path,
                address(this),
                deadline
            );

            currentAmount = amountsOut[amountsOut.length - 1];
            currentToken = nextToken;
        }

        uint256 endBalance = IERC20(tokenA).balanceOf(address(this));
        require(endBalance >= startBalance, "Net loss: balance decreased");

        uint256 profit = endBalance - startBalance;
        require(profit >= minProfit, "Profit below threshold");
        return profit;
    }


    // --- Admin / Risk Control ---
    function setPaused(bool _paused) external onlyOwner { 
        isPaused = _paused; 
    }
    
    function setApprovedRouter(address router, bool status) external onlyOwner { 
        approvedRouters[router] = status; 
    }
    
    function setApprovedToken(address token, bool status) external onlyOwner { 
        approvedTokens[token] = status; 
    }

    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner, balance);
    }
    
    receive() external payable {}
}

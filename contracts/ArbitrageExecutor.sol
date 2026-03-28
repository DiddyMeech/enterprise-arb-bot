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

    // executeArbitrage performs sequential swaps tracking strict minimum thresholds. 
    function executeArbitrage(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        address[] calldata routers,
        uint256 minAmountOut
    ) external onlyOwner whenNotPaused returns (uint256) {
        require(routers.length <= 3, "Max route hops exceeded");
        require(approvedTokens[tokenA] && approvedTokens[tokenB], "Token not in allowlist");

        uint256 currentBalance = IERC20(tokenA).balanceOf(address(this));
        
        uint256 intermediaryTokens = amountIn;
        address currentToken = tokenA;

        for(uint i = 0; i < routers.length; i++) {
            address router = routers[i];
            require(approvedRouters[router], "Router not approved");
            
            address nextToken = (i == 0) ? tokenB : tokenA;

            IERC20(currentToken).approve(router, intermediaryTokens);
            
            address[] memory path = new address[](2);
            path[0] = currentToken;
            path[1] = nextToken;

            // Simple route swap sequence execution
            uint256[] memory amountsOut = IUniswapV2Router02(router).swapExactTokensForTokens(
                intermediaryTokens,
                1, // Local leg slippage bypassed. We manage aggregated net minAmountOut cleanly.
                path,
                address(this),
                block.timestamp
            );

            intermediaryTokens = amountsOut[1];
            currentToken = nextToken;
        }

        uint256 finalBalance = IERC20(tokenA).balanceOf(address(this));
        uint256 profit = finalBalance - currentBalance;
        
        // Final assertion ensures that cross-DEX arbitrage exceeded threshold
        require(profit >= minAmountOut, "Insufficient net profit or slippage exceeded max tolerance");
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

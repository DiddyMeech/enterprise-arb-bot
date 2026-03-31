// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IAavePoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IAavePool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IAaveFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IUniswapV2RouterLike {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IUniswapV3RouterLike {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

abstract contract Ownable {
    address public owner;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "BAD_OWNER");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

abstract contract Pausable is Ownable {
    bool public paused;

    event Paused();
    event Unpaused();

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier whenNotPaused() {
        require(!paused, "PAUSED");
        _;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }
}

abstract contract ReentrancyGuard {
    uint256 private _status = 1;

    modifier nonReentrant() {
        require(_status == 1, "REENTRANT");
        _status = 2;
        _;
        _status = 1;
    }
}

contract TitanArbitrage is
    IAaveFlashLoanSimpleReceiver,
    Pausable,
    ReentrancyGuard
{
    uint8 internal constant DEX_V2 = 0;
    uint8 internal constant DEX_V3 = 1;

    struct Leg {
        uint8 dexType; // 0=v2, 1=v3
        address router;
        address tokenIn;
        address tokenOut;
        uint256 amountIn; // informational only; runtime uses rolling balance
        uint256 minOut;
        uint24 fee; // v3 only
    }

    struct Route {
        uint8 shape; // 2 or 3
        address tokenIn;
        uint256 amountIn;
        uint256 deadline;
        Leg[] legs;
    }

    IAavePoolAddressesProvider public immutable addressesProvider;
    IAavePool public immutable pool;

    mapping(address => bool) public allowedTokens;
    mapping(address => bool) public allowedRouters;

    event TokenSet(address indexed token, bool allowed);
    event RouterSet(address indexed router, bool allowed);
    event FlashLoanRequested(address indexed asset, uint256 amount);
    event ProfitWithdrawn(address indexed token, uint256 amount, address indexed to);

    constructor(address provider) Pausable(msg.sender) {
        require(provider != address(0), "BAD_PROVIDER");
        addressesProvider = IAavePoolAddressesProvider(provider);
        pool = IAavePool(addressesProvider.getPool());
    }

    function setToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenSet(token, allowed);
    }

    function setRouter(address router, bool allowed) external onlyOwner {
        allowedRouters[router] = allowed;
        emit RouterSet(router, allowed);
    }

    function requestFlashLoan(
        address asset,
        uint256 amount,
        bytes calldata encodedRoute
    ) external onlyOwner whenNotPaused nonReentrant {
        require(allowedTokens[asset], "TOKEN_NOT_ALLOWED");
        require(amount > 0, "BAD_AMOUNT");

        emit FlashLoanRequested(asset, amount);
        pool.flashLoanSimple(address(this), asset, amount, encodedRoute, 0);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(pool), "NOT_POOL");
        require(initiator == address(this), "BAD_INITIATOR");

        Route memory route = abi.decode(params, (Route));

        require(route.tokenIn == asset, "ASSET_MISMATCH");
        require(route.amountIn == amount, "AMOUNT_MISMATCH");
        require(block.timestamp <= route.deadline, "ROUTE_EXPIRED");
        require(route.legs.length == route.shape, "BAD_SHAPE");
        require(route.shape == 2 || route.shape == 3, "BAD_ROUTE_LEN");

        uint256 initialBalance = IERC20(asset).balanceOf(address(this));
        require(initialBalance >= amount, "FLASH_NOT_RECEIVED");

        uint256 rollingAmount = amount;

        for (uint256 i = 0; i < route.legs.length; i++) {
            Leg memory leg = route.legs[i];

            require(allowedRouters[leg.router], "ROUTER_NOT_ALLOWED");
            require(allowedTokens[leg.tokenIn], "LEG_TOKEN_IN_NOT_ALLOWED");
            require(allowedTokens[leg.tokenOut], "LEG_TOKEN_OUT_NOT_ALLOWED");

            if (i == 0) {
                require(leg.tokenIn == asset, "FIRST_LEG_TOKEN_IN");
            } else {
                require(leg.tokenIn == route.legs[i - 1].tokenOut, "LEG_CHAIN_BREAK");
            }

            if (leg.dexType == DEX_V2) {
                rollingAmount = _swapV2(leg, rollingAmount, route.deadline);
            } else if (leg.dexType == DEX_V3) {
                rollingAmount = _swapV3(leg, rollingAmount, route.deadline);
            } else {
                revert("BAD_DEX_TYPE");
            }
        }

        require(route.legs[route.legs.length - 1].tokenOut == asset, "FINAL_ASSET_MISMATCH");

        uint256 amountOwed = amount + premium;
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));

        require(finalBalance >= amountOwed, "NO_PROFITABLE_REPAYMENT");

        _safeApprove(asset, address(pool), 0);
        _safeApprove(asset, address(pool), amountOwed);

        return true;
    }

    function _swapV2(
        Leg memory leg,
        uint256 amountIn,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        _safeApprove(leg.tokenIn, leg.router, 0);
        _safeApprove(leg.tokenIn, leg.router, amountIn);

        address[] memory path = new address[](2);
        path[0] = leg.tokenIn;
        path[1] = leg.tokenOut;

        uint256[] memory amounts = IUniswapV2RouterLike(leg.router)
            .swapExactTokensForTokens(
                amountIn,
                leg.minOut,
                path,
                address(this),
                deadline
            );

        amountOut = amounts[amounts.length - 1];
    }

    function _swapV3(
        Leg memory leg,
        uint256 amountIn,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        _safeApprove(leg.tokenIn, leg.router, 0);
        _safeApprove(leg.tokenIn, leg.router, amountIn);

        IUniswapV3RouterLike.ExactInputSingleParams memory p =
            IUniswapV3RouterLike.ExactInputSingleParams({
                tokenIn: leg.tokenIn,
                tokenOut: leg.tokenOut,
                fee: leg.fee,
                recipient: address(this),
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: leg.minOut,
                sqrtPriceLimitX96: 0
            });

        amountOut = IUniswapV3RouterLike(leg.router).exactInputSingle(p);
    }

    function withdrawFunds(address token, uint256 amount, address to)
        external
        onlyOwner
        nonReentrant
    {
        require(to != address(0), "BAD_TO");
        require(IERC20(token).transfer(to, amount), "WITHDRAW_FAILED");
        emit ProfitWithdrawn(token, amount, to);
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        require(IERC20(token).approve(spender, amount), "APPROVE_FAILED");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TestERC20} from "@uniswap/v4-core/src/test/TestERC20.sol";

/// One-shot setup that makes the deployed RiskClaw pool actually swappable:
///   1. Deploys the v4-core test routers (PoolSwapTest, PoolModifyLiquidityTest).
///   2. Approves both routers as max spenders for the deployer's TOKEN0/TOKEN1.
///   3. Adds initial liquidity over a wide tick range so demo:swap has something
///      to trade against.
///
/// Run after Deploy0G + DeployHook + InitDynamicFeePool. The hook's
/// _beforeAddLiquidity will pass only while the registry policy is fresh and
/// score < BLOCK_THRESHOLD — make sure the agent loop has fired recently.
contract SetupSwapDemo is Script {
    int24 constant TICK_SPACING = 60;
    // Wide range; both ticks are multiples of TICK_SPACING.
    int24 constant TICK_LOWER = -120_000;
    int24 constant TICK_UPPER = 120_000;
    // 1e21 of L roughly translates to ~1k of each token at the 1:1 starting price
    // for this range, well within the deployer's 1M starting balance.
    int256 constant LIQUIDITY_DELTA = 1e21;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address hookAddr = vm.envAddress("RISK_HOOK");
        address t0 = vm.envAddress("TOKEN0");
        address t1 = vm.envAddress("TOKEN1");

        require(t0 < t1, "TOKEN0 must sort below TOKEN1");

        vm.startBroadcast(pk);

        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);

        TestERC20(t0).approve(address(swapRouter), type(uint256).max);
        TestERC20(t1).approve(address(swapRouter), type(uint256).max);
        TestERC20(t0).approve(address(lpRouter), type(uint256).max);
        TestERC20(t1).approve(address(lpRouter), type(uint256).max);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddr)
        });

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            liquidityDelta: LIQUIDITY_DELTA,
            salt: 0
        });

        lpRouter.modifyLiquidity(key, params, "");

        vm.stopBroadcast();

        console2.log("SwapRouter:    ", address(swapRouter));
        console2.log("LPRouter:      ", address(lpRouter));
        console2.log("Deployer:      ", deployer);
        console2.log("Liquidity L:   ", uint256(LIQUIDITY_DELTA));
        console2.log("Tick lower:    ", int256(TICK_LOWER));
        console2.log("Tick upper:    ", int256(TICK_UPPER));
    }
}

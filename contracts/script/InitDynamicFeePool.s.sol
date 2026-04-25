// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {TestERC20} from "@uniswap/v4-core/src/test/TestERC20.sol";

/// Deploys two demo ERC20s and initializes a v4 pool wired to RiskHook with the
/// DYNAMIC_FEE_FLAG. The hook's per-swap fee override only applies to dynamic-fee
/// pools — without this script, OVERRIDE_FEE_FLAG | fee in beforeSwap is a no-op.
contract InitDynamicFeePool is Script {
    using PoolIdLibrary for PoolKey;

    // sqrt(1) * 2**96 — used to initialize the pool at 1:1 price.
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 constant TICK_SPACING = 60;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address hookAddr = vm.envAddress("RISK_HOOK");

        vm.startBroadcast(pk);

        TestERC20 a = new TestERC20(1_000_000 ether);
        TestERC20 b = new TestERC20(1_000_000 ether);

        (address c0, address c1) =
            address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddr)
        });

        manager.initialize(key, SQRT_PRICE_1_1);

        vm.stopBroadcast();

        bytes32 poolId = PoolId.unwrap(key.toId());
        console2.log("Token0:      ", c0);
        console2.log("Token1:      ", c1);
        console2.log("Hook:        ", hookAddr);
        console2.log("TickSpacing: ", TICK_SPACING);
        console2.log("Fee flag:    ", LPFeeLibrary.DYNAMIC_FEE_FLAG);
        console2.log("PoolId:      ", uint256(poolId));
    }
}

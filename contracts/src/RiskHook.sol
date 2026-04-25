// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-hooks-public/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IRiskPolicyRegistry} from "./interfaces/IRiskPolicyRegistry.sol";

contract RiskHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    IRiskPolicyRegistry public immutable registry;

    // riskScoreBps >= BLOCK_THRESHOLD ⇒ swap/add reverts. Stale policies also revert
    // because an unmonitored pool is itself a risk.
    uint16 public constant BLOCK_THRESHOLD = 8500;

    error PoolBlocked(bytes32 poolId, uint16 riskScore);
    error PolicyStale(bytes32 poolId);

    constructor(IPoolManager _manager, IRiskPolicyRegistry _registry) BaseHook(_manager) {
        registry = _registry;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        IRiskPolicyRegistry.PoolRiskPolicy memory policy = registry.getPolicy(poolId);

        if (registry.isStale(poolId)) revert PolicyStale(poolId);
        if (policy.riskScoreBps >= BLOCK_THRESHOLD) revert PoolBlocked(poolId, policy.riskScoreBps);

        // OVERRIDE_FEE_FLAG tells PoolManager to use this fee for the current swap only;
        // the pool itself must be initialized with DYNAMIC_FEE_FLAG for overrides to apply.
        uint24 fee = policy.dynamicFee | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee);
    }

    function _beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        internal
        override
        returns (bytes4)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        IRiskPolicyRegistry.PoolRiskPolicy memory policy = registry.getPolicy(poolId);

        if (registry.isStale(poolId)) revert PolicyStale(poolId);
        if (policy.riskScoreBps >= BLOCK_THRESHOLD) revert PoolBlocked(poolId, policy.riskScoreBps);

        return BaseHook.beforeAddLiquidity.selector;
    }
}

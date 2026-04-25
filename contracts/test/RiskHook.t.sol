// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {RiskHook} from "../src/RiskHook.sol";
import {RiskPolicyRegistry} from "../src/RiskPolicyRegistry.sol";
import {IRiskPolicyRegistry} from "../src/interfaces/IRiskPolicyRegistry.sol";

import {BaseHook} from "v4-hooks-public/base/BaseHook.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// Test subclass that bypasses the BaseHook permission-bit address check, so we can
/// deploy at any address. We're testing hook *logic*, not deployment correctness —
/// HookMiner deploys are exercised separately via DeployHook.s.sol.
contract TestableRiskHook is RiskHook {
    constructor(IPoolManager m, IRiskPolicyRegistry r) RiskHook(m, r) {}

    function validateHookAddress(BaseHook) internal pure override {}
}

contract RiskHookTest is Test {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    RiskPolicyRegistry registry;
    TestableRiskHook hook;
    address gov = address(0xA11CE);
    address agent = address(0xB0B);
    PoolKey key;
    bytes32 poolId;

    function setUp() public {
        registry = new RiskPolicyRegistry(gov);
        vm.prank(gov);
        registry.setAgent(agent, true);

        // The test contract acts as the PoolManager: BaseHook's onlyPoolManager
        // checks msg.sender against poolManager, so calls from this test pass.
        hook = new TestableRiskHook(IPoolManager(address(this)), registry);

        key = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = PoolId.unwrap(key.toId());
    }

    function _proof() internal view returns (IRiskPolicyRegistry.PolicyProof memory) {
        return IRiskPolicyRegistry.PolicyProof({
            explanationRoot: keccak256("memo"),
            computeProofRoot: keccak256("tee"),
            metricsRoot: keccak256("metrics"),
            promptHash: keccak256("prompt"),
            modelHash: keccak256("model"),
            provider: address(0xCAFE),
            responseIdHash: keccak256("zg-1"),
            verifiedAt: uint64(block.timestamp)
        });
    }

    function _setPolicy(uint16 score, uint24 fee, uint128 maxAmt) internal {
        vm.prank(agent);
        registry.updatePolicy(poolId, score, fee, maxAmt, _proof());
    }

    function _swap(int256 amountSpecified) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: amountSpecified, sqrtPriceLimitX96: 0});
    }

    function test_staleReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RiskHook.PolicyStale.selector, poolId));
        hook.beforeSwap(address(this), key, _swap(-1e18), "");
    }

    function test_blockedScoreReverts() public {
        _setPolicy(9000, 30_000, 0);
        vm.expectRevert(abi.encodeWithSelector(RiskHook.PoolBlocked.selector, poolId, uint16(9000)));
        hook.beforeSwap(address(this), key, _swap(-1e18), "");
    }

    function test_blockedAtThresholdReverts() public {
        _setPolicy(8500, 30_000, 0);
        vm.expectRevert(abi.encodeWithSelector(RiskHook.PoolBlocked.selector, poolId, uint16(8500)));
        hook.beforeSwap(address(this), key, _swap(-1e18), "");
    }

    function test_healthyReturnsFeeOverride() public {
        _setPolicy(3000, 5_000, 0);
        (bytes4 sel,, uint24 fee) = hook.beforeSwap(address(this), key, _swap(-1e18), "");
        assertEq(sel, BaseHook.beforeSwap.selector);
        assertEq(fee, uint24(5_000) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function test_swapTooLargeReverts_exactIn() public {
        _setPolicy(3000, 5_000, 1e18);
        vm.expectRevert(abi.encodeWithSelector(RiskHook.SwapTooLarge.selector, poolId, uint256(2e18), uint128(1e18)));
        hook.beforeSwap(address(this), key, _swap(-2e18), "");
    }

    function test_swapTooLargeReverts_exactOut() public {
        _setPolicy(3000, 5_000, 1e18);
        vm.expectRevert(abi.encodeWithSelector(RiskHook.SwapTooLarge.selector, poolId, uint256(2e18), uint128(1e18)));
        hook.beforeSwap(address(this), key, _swap(2e18), "");
    }

    function test_swapAtCapAllowed() public {
        _setPolicy(3000, 5_000, 1e18);
        (,, uint24 fee) = hook.beforeSwap(address(this), key, _swap(-1e18), "");
        assertEq(fee, uint24(5_000) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function test_zeroCapMeansUnlimited() public {
        _setPolicy(3000, 5_000, 0);
        (,, uint24 fee) = hook.beforeSwap(address(this), key, _swap(-1e25), "");
        assertEq(fee, uint24(5_000) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function test_addLiquidityBlockedWhenRed() public {
        _setPolicy(9000, 0, 0);
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0});
        vm.expectRevert(abi.encodeWithSelector(RiskHook.PoolBlocked.selector, poolId, uint16(9000)));
        hook.beforeAddLiquidity(address(this), key, params, "");
    }

    function test_addLiquidityStaleReverts() public {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0});
        vm.expectRevert(abi.encodeWithSelector(RiskHook.PolicyStale.selector, poolId));
        hook.beforeAddLiquidity(address(this), key, params, "");
    }

    function test_addLiquidityHealthyAllowed() public {
        _setPolicy(3000, 5_000, 0);
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1e18, salt: 0});
        bytes4 sel = hook.beforeAddLiquidity(address(this), key, params, "");
        assertEq(sel, BaseHook.beforeAddLiquidity.selector);
    }
}

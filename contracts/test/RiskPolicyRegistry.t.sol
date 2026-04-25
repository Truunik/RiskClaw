// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RiskPolicyRegistry} from "../src/RiskPolicyRegistry.sol";
import {IRiskPolicyRegistry} from "../src/interfaces/IRiskPolicyRegistry.sol";

contract RiskPolicyRegistryTest is Test {
    RiskPolicyRegistry registry;
    address gov = address(0xA11CE);
    address agent = address(0xB0B);
    bytes32 poolId = keccak256("ETH/RISK");

    function setUp() public {
        registry = new RiskPolicyRegistry(gov);
        vm.prank(gov);
        registry.setAgent(agent, true);
    }

    function _proof() internal view returns (IRiskPolicyRegistry.PolicyProof memory) {
        return IRiskPolicyRegistry.PolicyProof({
            explanationRoot: keccak256("memo"),
            computeProofRoot: keccak256("tee"),
            provider: address(0xCAFE),
            responseIdHash: keccak256("zg-res-key-1"),
            verifiedAt: uint64(block.timestamp)
        });
    }

    function test_approvedAgentCanUpdate() public {
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 200, _proof());

        IRiskPolicyRegistry.PoolRiskPolicy memory p = registry.getPolicy(poolId);
        assertEq(p.riskScoreBps, 5000);
        assertEq(p.dynamicFee, 10_000);
        assertEq(p.updater, agent);
    }

    function test_unapprovedReverts() public {
        vm.expectRevert(RiskPolicyRegistry.NotAuthorized.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 200, _proof());
    }

    function test_feeAboveMaxReverts() public {
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.FeeTooHigh.selector);
        registry.updatePolicy(poolId, 5000, 100_001, 200, _proof());
    }

    function test_scoreAboveMaxReverts() public {
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidScore.selector);
        registry.updatePolicy(poolId, 10_001, 10_000, 200, _proof());
    }

    function test_unsetPoolIsStale() public view {
        assertTrue(registry.isStale(poolId));
    }

    function test_freshPolicyNotStale() public {
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 200, _proof());
        assertFalse(registry.isStale(poolId));
    }

    function test_policyGoesStaleAfter1Hour() public {
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 200, _proof());
        vm.warp(block.timestamp + 1 hours + 1);
        assertTrue(registry.isStale(poolId));
    }
}

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
            metricsRoot: keccak256("metrics"),
            promptHash: keccak256("prompt"),
            modelHash: keccak256("model"),
            provider: address(0xCAFE),
            responseIdHash: keccak256("zg-res-key-1"),
            verifiedAt: uint64(block.timestamp)
        });
    }

    function test_approvedAgentCanUpdate() public {
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 1e18, _proof());

        IRiskPolicyRegistry.PoolRiskPolicy memory p = registry.getPolicy(poolId);
        assertEq(p.riskScoreBps, 5000);
        assertEq(p.dynamicFee, 10_000);
        assertEq(p.maxAbsAmountSpecified, 1e18);
        assertEq(p.updater, agent);
    }

    function test_unapprovedReverts() public {
        vm.expectRevert(RiskPolicyRegistry.NotAuthorized.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, _proof());
    }

    function test_feeAboveMaxReverts() public {
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.FeeTooHigh.selector);
        registry.updatePolicy(poolId, 5000, 100_001, 0, _proof());
    }

    function test_scoreAboveMaxReverts() public {
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidScore.selector);
        registry.updatePolicy(poolId, 10_001, 10_000, 0, _proof());
    }

    function test_unsetPoolIsStale() public view {
        assertTrue(registry.isStale(poolId));
    }

    function test_freshPolicyNotStale() public {
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 0, _proof());
        assertFalse(registry.isStale(poolId));
    }

    function test_policyGoesStaleAfter1Hour() public {
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 0, _proof());
        vm.warp(block.timestamp + 1 hours + 1);
        assertTrue(registry.isStale(poolId));
    }

    // ---- proof validation ----

    function test_zeroExplanationRootReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.explanationRoot = bytes32(0);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_zeroComputeProofRootReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.computeProofRoot = bytes32(0);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_zeroMetricsRootReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.metricsRoot = bytes32(0);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_zeroPromptHashReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.promptHash = bytes32(0);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_zeroModelHashReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.modelHash = bytes32(0);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_zeroProviderReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.provider = address(0);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_zeroVerifiedAtReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.verifiedAt = 0;
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_futureVerifiedAtReverts() public {
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.verifiedAt = uint64(block.timestamp + 1);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.InvalidProof.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_oldProofReverts() public {
        // PROOF_FRESHNESS is 15 min — warp past it before submitting.
        vm.warp(block.timestamp + 30 minutes);
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.verifiedAt = uint64(block.timestamp - 16 minutes);
        vm.prank(agent);
        vm.expectRevert(RiskPolicyRegistry.ProofTooOld.selector);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
    }

    function test_proofAtFreshnessBoundaryAccepted() public {
        vm.warp(block.timestamp + 30 minutes);
        IRiskPolicyRegistry.PolicyProof memory p = _proof();
        p.verifiedAt = uint64(block.timestamp - 15 minutes);
        vm.prank(agent);
        registry.updatePolicy(poolId, 5000, 10_000, 0, p);
        assertEq(registry.getPolicy(poolId).riskScoreBps, 5000);
    }
}

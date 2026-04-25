// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IRiskPolicyRegistry {
    /// Onchain commitment to the offchain reasoning chain that produced the policy:
    ///   metricsRoot (Observer state) → promptHash + modelHash (Analyst inputs)
    ///   → responseIdHash + provider + verifiedAt (TEE-verified Compute response)
    ///   → explanationRoot (memo on 0G Storage) + computeProofRoot (proof artifact on 0G Storage)
    struct PolicyProof {
        bytes32 explanationRoot;
        bytes32 computeProofRoot;
        bytes32 metricsRoot;
        bytes32 promptHash;
        bytes32 modelHash;
        address provider;
        bytes32 responseIdHash;
        uint64 verifiedAt;
    }

    struct PoolRiskPolicy {
        uint16 riskScoreBps;
        uint24 dynamicFee;
        uint128 maxAbsAmountSpecified; // 0 = no cap; otherwise hook reverts if |amountSpecified| exceeds this
        uint64 lastUpdated;
        address updater;
        PolicyProof proof;
    }

    function getPolicy(bytes32 poolId) external view returns (PoolRiskPolicy memory);
    function isStale(bytes32 poolId) external view returns (bool);
}

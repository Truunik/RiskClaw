// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IRiskPolicyRegistry {
    struct PolicyProof {
        bytes32 explanationRoot;
        bytes32 computeProofRoot;
        address provider;
        bytes32 responseIdHash;
        uint64 verifiedAt;
    }

    struct PoolRiskPolicy {
        uint16 riskScoreBps;
        uint24 dynamicFee;
        uint32 maxSwapBps;
        uint64 lastUpdated;
        address updater;
        PolicyProof proof;
    }

    function getPolicy(bytes32 poolId) external view returns (PoolRiskPolicy memory);
    function isStale(bytes32 poolId) external view returns (bool);
}

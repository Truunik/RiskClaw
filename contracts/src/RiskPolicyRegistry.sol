// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRiskPolicyRegistry} from "./interfaces/IRiskPolicyRegistry.sol";

contract RiskPolicyRegistry is IRiskPolicyRegistry {
    uint24 public constant MAX_FEE = 100_000; // 10% in pips (1e6 = 100%)
    uint16 public constant MAX_SCORE = 10_000;
    uint64 public constant STALE_AFTER = 1 hours;

    address public governance;
    mapping(address => bool) public approvedAgents;
    mapping(bytes32 => PoolRiskPolicy) internal _policies;

    event PolicyUpdated(
        bytes32 indexed poolId,
        uint16 riskScoreBps,
        uint24 dynamicFee,
        uint32 maxSwapBps,
        bytes32 explanationRoot,
        bytes32 computeProofRoot,
        address indexed updater
    );
    event AgentApproved(address indexed agent, bool approved);
    event GovernanceTransferred(address indexed previous, address indexed next);

    error NotAuthorized();
    error FeeTooHigh();
    error InvalidScore();
    error InvalidGovernance();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotAuthorized();
        _;
    }

    constructor(address _governance) {
        if (_governance == address(0)) revert InvalidGovernance();
        governance = _governance;
        emit GovernanceTransferred(address(0), _governance);
    }

    function setAgent(address agent, bool approved) external onlyGovernance {
        approvedAgents[agent] = approved;
        emit AgentApproved(agent, approved);
    }

    function transferGovernance(address next) external onlyGovernance {
        if (next == address(0)) revert InvalidGovernance();
        emit GovernanceTransferred(governance, next);
        governance = next;
    }

    function updatePolicy(
        bytes32 poolId,
        uint16 riskScoreBps,
        uint24 dynamicFee,
        uint32 maxSwapBps,
        PolicyProof calldata proof
    ) external {
        if (!approvedAgents[msg.sender] && msg.sender != governance) revert NotAuthorized();
        if (dynamicFee > MAX_FEE) revert FeeTooHigh();
        if (riskScoreBps > MAX_SCORE) revert InvalidScore();

        _policies[poolId] = PoolRiskPolicy({
            riskScoreBps: riskScoreBps,
            dynamicFee: dynamicFee,
            maxSwapBps: maxSwapBps,
            lastUpdated: uint64(block.timestamp),
            updater: msg.sender,
            proof: proof
        });

        emit PolicyUpdated(
            poolId,
            riskScoreBps,
            dynamicFee,
            maxSwapBps,
            proof.explanationRoot,
            proof.computeProofRoot,
            msg.sender
        );
    }

    function getPolicy(bytes32 poolId) external view returns (PoolRiskPolicy memory) {
        return _policies[poolId];
    }

    function isStale(bytes32 poolId) external view returns (bool) {
        uint64 ts = _policies[poolId].lastUpdated;
        if (ts == 0) return true;
        return block.timestamp - ts > STALE_AFTER;
    }
}

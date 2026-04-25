// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Scripted risk-event source for the demo. Off-chain agents read this contract
/// instead of synthesizing pool stats — gives the demo a reliable "spike now" button
/// without needing organic market behavior.
contract MockPoolScenario {
    struct Snapshot {
        uint256 tvl;              // pool TVL (in 1e18 units of quote)
        uint256 tvlDelta24hBps;   // negative as bps if drained — encoded unsigned with isDrain
        bool isDrain;             // true if last 24h is net outflow
        uint256 lastSwapAmount;   // size of latest swap relative to active liquidity (bps)
        uint256 priceImpactBps;   // last swap price impact in bps
        uint64 timestamp;
    }

    address public operator;
    mapping(bytes32 => Snapshot) public snapshots;

    event SnapshotPushed(bytes32 indexed poolId, uint256 tvl, bool isDrain, uint256 priceImpactBps);

    error NotOperator();

    constructor(address _operator) {
        operator = _operator;
    }

    function pushSnapshot(bytes32 poolId, Snapshot calldata s) external {
        if (msg.sender != operator) revert NotOperator();
        snapshots[poolId] = s;
        emit SnapshotPushed(poolId, s.tvl, s.isDrain, s.priceImpactBps);
    }

    function get(bytes32 poolId) external view returns (Snapshot memory) {
        return snapshots[poolId];
    }
}

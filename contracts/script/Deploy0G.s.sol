// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {RiskPolicyRegistry} from "../src/RiskPolicyRegistry.sol";
import {MockPoolScenario} from "../src/MockPoolScenario.sol";

/// 0G testnet demo deployment.
///
/// RiskHook is NOT deployed here — v4 hooks must be deployed to a CREATE2 address
/// whose low-order bits encode the hook permissions. Use HookMiner in a follow-up
/// script (DeployHook.s.sol) once the registry is live.
contract Deploy0G is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        PoolManager pm = new PoolManager(deployer);
        RiskPolicyRegistry registry = new RiskPolicyRegistry(deployer);
        MockPoolScenario scenario = new MockPoolScenario(deployer);

        vm.stopBroadcast();

        console2.log("PoolManager:        ", address(pm));
        console2.log("RiskPolicyRegistry: ", address(registry));
        console2.log("MockPoolScenario:   ", address(scenario));
        console2.log("Governance/operator:", deployer);
        console2.log("Next: mine a hook salt + deploy RiskHook with permission flags");
    }
}

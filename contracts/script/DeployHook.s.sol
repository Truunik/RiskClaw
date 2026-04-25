// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookMiner} from "v4-hooks-public/utils/HookMiner.sol";

import {RiskHook} from "../src/RiskHook.sol";
import {IRiskPolicyRegistry} from "../src/interfaces/IRiskPolicyRegistry.sol";

/// Deploys RiskHook at a CREATE2 address whose low-order bits encode
/// BEFORE_SWAP_FLAG | BEFORE_ADD_LIQUIDITY_FLAG. Required by Uniswap v4 — pools
/// reject hooks whose address bits don't match their declared permissions.
///
/// Run after Deploy0G.s.sol; takes manager + registry addresses from env.
contract DeployHook is Script {
    // Foundry's default CREATE2 deployer used when `new C{salt: x}(...)` runs in a script.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        IRiskPolicyRegistry registry = IRiskPolicyRegistry(vm.envAddress("RISK_POLICY_REGISTRY"));

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

        (address expected, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER, flags, type(RiskHook).creationCode, abi.encode(manager, registry)
        );

        vm.startBroadcast(pk);
        RiskHook hook = new RiskHook{salt: salt}(manager, registry);
        vm.stopBroadcast();

        require(address(hook) == expected, "DeployHook: address mismatch");

        console2.log("RiskHook:    ", address(hook));
        console2.log("Salt:        ", uint256(salt));
        console2.log("Flag bits:   ", uint160(address(hook)) & uint160(Hooks.ALL_HOOK_MASK));
        console2.log("Expected:    ", flags);
        console2.log("Manager:     ", address(manager));
        console2.log("Registry:    ", address(registry));
    }
}

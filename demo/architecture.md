# Architecture

## Trust model

The hook trusts the registry. The registry trusts approved agents. Approved
agents trust the 0G Compute provider's TEE attestation — and we commit that
attestation onchain so anyone can verify the chain of custody.

```
Pool ──reads──> RiskHook ──reads──> RiskPolicyRegistry
                                          ▲
                              writes (signed tx, gated by approvedAgents)
                                          │
                                       Guardian
                                          ▲ memo + TEE sig
                                          │
                                       Analyst ──> 0G Compute (TEE-verified)
                                          ▲
                                       Observer ──> 0G Storage (KV + Log)
```

## Why three agents, not five

Two pieces (watcher + quant metrics) collapse into Observer because they share
the pool snapshot in memory. Two pieces (critic + executor) collapse into
Guardian because the same agent that says "approved" should sign the tx —
splitting them is the kind of thing that *looks* like a swarm but is just
function calls. Three agents = three distinct concerns + three persistent
0G Storage streams + three signed identities.

## Onchain artifacts (PolicyProof)

```
explanationRoot   keccak/Merkle root of the full memo on 0G Storage
computeProofRoot  root of the TEE verification artifacts on 0G Storage
provider          0G Compute provider address that signed the response
responseIdHash    hash of the ZG-Res-Key (cheap pointer to the verifiable response)
verifiedAt        timestamp the analyst verified the TEE signature
```

The hook reads the registry. Anyone can fetch `explanationRoot` from 0G
Storage to read the LLM's reasoning that justified the latest fee bump —
that's the demo's signature moment.

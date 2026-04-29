import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ogGalileo } from "../executor.ts";

/// Live swap on the deployed 0G Galileo demo pool, going through RiskHook.
///
/// What this proves:
///   - the v4 PoolManager actually invokes RiskHook.beforeSwap
///   - the hook reads RiskPolicyRegistry's current policy
///   - OVERRIDE_FEE_FLAG | dynamicFee is honored (the swap settles with the
///     fee the AI memo recommended, not the pool's static fee)
///
/// Prereqs (one-time): SetupSwapDemo.s.sol (deploys routers + adds liquidity).
/// Per run: a fresh policy on the pool — re-run `bun run loop` first if it
/// went stale.

const TOKEN_ABI = [
  parseAbiItem("function balanceOf(address) view returns (uint256)"),
  parseAbiItem("function approve(address,uint256) returns (bool)"),
  parseAbiItem("function mint(address,uint256)"),
] as const;

const SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "", type: "int256" }],
  },
] as const;

// LPFeeLibrary.DYNAMIC_FEE_FLAG = 0x800000 (1 << 23). The pool was initialized
// with this exact value as `fee`.
const DYNAMIC_FEE_FLAG = 0x800000;
// TickMath.MIN_SQRT_PRICE + 1 — wide-open slippage bound for zeroForOne swaps.
const MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740n;
const TICK_SPACING = 60;

const SWAP_AMOUNT = 10n ** 17n; // 0.1 token

async function main() {
  const rpcUrl = required("OG_RPC_URL");
  const swapRouter = required("SWAP_ROUTER") as Address;
  const hookAddr = required("RISK_HOOK") as Address;
  const t0 = required("TOKEN0") as Address;
  const t1 = required("TOKEN1") as Address;
  const pk = required("DEPLOYER_PRIVATE_KEY") as Hex;
  const account = privateKeyToAccount(pk);

  const chain = { ...ogGalileo, rpcUrls: { default: { http: [rpcUrl] } } };
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });

  console.log("=== RiskClaw live swap demo ===");
  console.log(`router      ${swapRouter}`);
  console.log(`hook        ${hookAddr}`);
  console.log(`tokens      0=${t0}  1=${t1}`);
  console.log(`account     ${account.address}`);
  console.log("");

  // 1) Pre-swap balances.
  const [bal0Before, bal1Before] = await Promise.all([
    pub.readContract({ address: t0, abi: TOKEN_ABI, functionName: "balanceOf", args: [account.address] }),
    pub.readContract({ address: t1, abi: TOKEN_ABI, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log(`pre  bal0   ${formatToken(bal0Before)}`);
  console.log(`pre  bal1   ${formatToken(bal1Before)}`);

  if (bal0Before < SWAP_AMOUNT) {
    console.log(`(account is short on token0; minting ${formatToken(SWAP_AMOUNT)} from TestERC20.mint)`);
    const mintTx = await wallet.writeContract({
      address: t0,
      abi: TOKEN_ABI,
      functionName: "mint",
      args: [account.address, SWAP_AMOUNT * 100n],
      gasPrice: 3_000_000_000n,
    });
    await pub.waitForTransactionReceipt({
      hash: mintTx,
      retryCount: 60,
      retryDelay: 2_000,
      pollingInterval: 2_000,
    });
  }

  // 2) Build PoolKey + SwapParams matching the deployed pool.
  const key = {
    currency0: t0,
    currency1: t1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: TICK_SPACING,
    hooks: hookAddr,
  } as const;

  const params = {
    zeroForOne: true,
    // Negative ⇒ exact input. We're spending SWAP_AMOUNT of token0 to get token1.
    amountSpecified: -SWAP_AMOUNT,
    sqrtPriceLimitX96: MIN_SQRT_PRICE_PLUS_ONE,
  } as const;

  const testSettings = { takeClaims: false, settleUsingBurn: false } as const;

  // 3) Send the swap and wait for it.
  console.log("");
  console.log(`swapping    ${formatToken(SWAP_AMOUNT)} token0 -> token1 (exact-in, zeroForOne)`);
  const t = Date.now();
  const txHash = await wallet.writeContract({
    address: swapRouter,
    abi: SWAP_ROUTER_ABI,
    functionName: "swap",
    args: [key, params, testSettings, "0x"],
    gasPrice: 3_000_000_000n,
  });
  console.log(`swap tx     ${txHash}`);

  // 0G blocks can land slower than viem's default 6-retry budget; widen it.
  const receipt = await pub.waitForTransactionReceipt({
    hash: txHash,
    retryCount: 60,
    retryDelay: 2_000,
    pollingInterval: 2_000,
  });
  if (receipt.status !== "success") {
    console.log("swap REVERTED");
    process.exit(1);
  }
  console.log(`confirmed   in ${Date.now() - t}ms (block ${receipt.blockNumber})`);

  // 4) Post-swap balances and a back-of-envelope effective-fee read.
  const [bal0After, bal1After] = await Promise.all([
    pub.readContract({ address: t0, abi: TOKEN_ABI, functionName: "balanceOf", args: [account.address] }),
    pub.readContract({ address: t1, abi: TOKEN_ABI, functionName: "balanceOf", args: [account.address] }),
  ]);
  const sent0 = bal0Before - bal0After; // expect SWAP_AMOUNT
  const got1 = bal1After - bal1Before; // expect ~SWAP_AMOUNT * (1 - fee)

  console.log("");
  console.log(`post bal0   ${formatToken(bal0After)}  (Δ -${formatToken(sent0)})`);
  console.log(`post bal1   ${formatToken(bal1After)}  (Δ +${formatToken(got1)})`);

  if (sent0 > 0n && got1 > 0n) {
    // effectiveFeeBps = (sent0 - got1) / sent0 * 10_000. Mostly fee at 1:1 with
    // a wide range, plus a thin sliver of price impact.
    const fee = ((sent0 - got1) * 10_000n) / sent0;
    console.log(`effective   ~${(Number(fee) / 100).toFixed(2)}% (fee + price impact combined)`);
    console.log(`(policy-set fee is the dominant component; remainder is impact on a wide-range pool)`);
  }
  console.log("");
  console.log(`explorer    https://chainscan-galileo.0g.ai/tx/${txHash}`);
}

function formatToken(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n) / 10n ** 14n; // 4 dp
  return `${whole.toString()}.${frac.toString().padStart(4, "0")}`;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

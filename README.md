# EOA – Delegate EOA

A production-grade **EOA delegation** system for Ethereum, enabling any Externally Owned Account (EOA) to delegate on-chain calls to a relayer via [EIP-712](https://eips.ethereum.org/EIPS/eip-712) signed meta-transactions.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Off-chain (EOA owner)                                        │
│                                                               │
│  owner.signTypedData(domain, types, {                         │
│    owner, to, value, data, nonce, deadline                    │
│  })  ──► sig (65 bytes)                                       │
└──────────────────────────────┬────────────────────────────────┘
                               │ sig + params
                               ▼
┌───────────────────────────────────────────────────────────────┐
│  DelegateEOA.sol  (on-chain)                                  │
│                                                               │
│  execute(owner, to, value, data, deadline, sig)               │
│    1. Reject if block.timestamp > deadline                    │
│    2. nonces[owner]++  (consume before external call)         │
│    3. Reconstruct EIP-712 digest                              │
│    4. ecrecover(digest, sig) == owner  ?  proceed : revert    │
│    5. to.call{value}(data)                                    │
└───────────────────────────────────────────────────────────────┘
```

### Key design decisions

| Concern | Decision |
|---|---|
| Signature format | [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed structured data – prevents cross-contract/cross-chain replay |
| Replay protection | Monotonically incrementing per-owner nonce consumed **before** any external call |
| Deadline | Unix timestamp enforced on-chain; signatures expire |
| Gas | Custom errors (no revert strings), `++i` loops, assembly `ecrecover` extraction |
| Security | No upgradability, no admin, no pause – minimal attack surface |
| Reentrancy | Nonce consumed before dispatch; no ETH held except what callers explicitly send |

---

## Contracts

| File | Description |
|---|---|
| `contracts/DelegateEOA.sol` | Main executor contract |
| `contracts/interfaces/IDelegateEOA.sol` | Interface (errors, events, function signatures) |
| `contracts/test/MockTarget.sol` | Test-only call target |

### `DelegateEOA.sol`

#### `execute`
```solidity
function execute(
    address owner,
    address to,
    uint256 value,
    bytes calldata data,
    uint256 deadline,
    bytes calldata signature
) external payable returns (bytes memory result)
```
Execute a single call on behalf of `owner`. The caller (relayer) pays gas; ETH `value` must be included as `msg.value`.

#### `executeBatch`
```solidity
function executeBatch(
    address owner,
    Call[] calldata calls,
    uint256 deadline,
    bytes calldata signature
) external payable returns (bytes[] memory results)
```
Execute a batch of calls atomically. Reverts on the first failing call.

#### EIP-712 types

**Single call:**
```
DelegatedCall(
  address owner,
  address to,
  uint256 value,
  bytes data,
  uint256 nonce,
  uint256 deadline
)
```

**Batch call:**
```
DelegatedBatchCall(
  address owner,
  Call[] calls,
  uint256 nonce,
  uint256 deadline
)
Call(address to,uint256 value,bytes data)
```

---

## Quick-start

```bash
npm install
npm test                # compile + test
npm run deploy:local    # deploy to Hardhat network
```

### Sign and relay (JS/ethers v6)

```js
const domain = {
  name: "DelegateEOA",
  version: "1",
  chainId: await provider.getNetwork().then(n => n.chainId),
  verifyingContract: DELEGATE_EOA_ADDRESS,
};

const types = {
  DelegatedCall: [
    { name: "owner",    type: "address" },
    { name: "to",       type: "address" },
    { name: "value",    type: "uint256" },
    { name: "data",     type: "bytes"   },
    { name: "nonce",    type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const nonce    = await delegateEOA.nonces(ownerWallet.address);
const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

const sig = await ownerWallet.signTypedData(domain, types, {
  owner:    ownerWallet.address,
  to:       TARGET_ADDRESS,
  value:    0n,
  data:     callData,
  nonce,
  deadline,
});

// Relayer submits the transaction (pays gas)
await delegateEOA.connect(relayer).execute(
  ownerWallet.address,
  TARGET_ADDRESS,
  0n,
  callData,
  deadline,
  sig,
);
```

---

## Security notes

- **Nonce ordering**: Signatures must be used in nonce order. There is no nonce cancellation mechanism by design (minimal attack surface).
- **Deadline**: Always set a short deadline (minutes, not days) to minimise the replay window.
- **ETH value**: The relayer must supply `msg.value >= value` in the `execute` call; any excess remains in the contract and can be forwarded in subsequent calls.
- **Target trust**: This contract imposes no restrictions on `to`. Do not sign delegations to untrusted targets.

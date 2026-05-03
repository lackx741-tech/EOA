// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDelegateEOA} from "./interfaces/IDelegateEOA.sol";

/// @title DelegateEOA
/// @notice Production-grade meta-transaction executor that lets an EOA delegate
///         arbitrary on-chain calls to a relayer via EIP-712 signed messages.
///
/// Design choices
/// ──────────────
/// • EIP-712 typed structured data prevents cross-contract / cross-chain replay.
/// • Per-owner nonces prevent same-chain replay; they increment monotonically so
///   signatures cannot be replayed even on a re-deployed contract (same address
///   on a different chain is blocked by chainId in the domain).
/// • Deadlines bound signature validity to a time window.
/// • Custom errors (no revert strings) save gas.
/// • No upgradability, no ownership, no pausing – minimal attack surface.
/// • Reentrancy: calls are dispatched sequentially; the nonce is consumed before
///   any external call, so a malicious target cannot replay the same signature.
contract DelegateEOA is IDelegateEOA {
    // -------------------------------------------------------------------------
    // EIP-712 type hashes
    // -------------------------------------------------------------------------

    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain("
            "string name,"
            "string version,"
            "uint256 chainId,"
            "address verifyingContract"
            ")"
        );

    bytes32 public constant CALL_TYPEHASH =
        keccak256(
            "DelegatedCall("
            "address owner,"
            "address to,"
            "uint256 value,"
            "bytes data,"
            "uint256 nonce,"
            "uint256 deadline"
            ")"
        );

    bytes32 public constant CALL_STRUCT_TYPEHASH =
        keccak256("Call(address to,uint256 value,bytes data)");

    bytes32 public constant BATCH_CALL_TYPEHASH =
        keccak256(
            "DelegatedBatchCall("
            "address owner,"
            "Call[] calls,"
            "uint256 nonce,"
            "uint256 deadline"
            ")"
            "Call(address to,uint256 value,bytes data)"
        );

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @inheritdoc IDelegateEOA
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @inheritdoc IDelegateEOA
    mapping(address => uint256) public nonces;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                keccak256(bytes("DelegateEOA")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // -------------------------------------------------------------------------
    // External – execution
    // -------------------------------------------------------------------------

    /// @inheritdoc IDelegateEOA
    function execute(
        address owner,
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (bytes memory result) {
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Consume nonce BEFORE any external call (replay / reentrancy guard).
        uint256 nonce = nonces[owner]++;

        bytes32 digest = _hashTypedData(
            keccak256(
                abi.encode(
                    CALL_TYPEHASH,
                    owner,
                    to,
                    value,
                    keccak256(data),
                    nonce,
                    deadline
                )
            )
        );

        if (_recover(digest, signature) != owner) revert InvalidSignature();

        bool success;
        (success, result) = to.call{value: value}(data);
        if (!success) revert ExecutionFailed(0, result);

        emit Executed(owner, to, value, nonce);
    }

    /// @inheritdoc IDelegateEOA
    function executeBatch(
        address owner,
        Call[] calldata calls,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (bytes[] memory results) {
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Consume nonce BEFORE any external call.
        uint256 nonce = nonces[owner]++;

        // Hash each Call struct, then hash the array.
        uint256 len = calls.length;
        bytes32[] memory callHashes = new bytes32[](len);
        for (uint256 i; i < len; ++i) {
            callHashes[i] = keccak256(
                abi.encode(
                    CALL_STRUCT_TYPEHASH,
                    calls[i].to,
                    calls[i].value,
                    keccak256(calls[i].data)
                )
            );
        }

        bytes32 digest = _hashTypedData(
            keccak256(
                abi.encode(
                    BATCH_CALL_TYPEHASH,
                    owner,
                    keccak256(abi.encodePacked(callHashes)),
                    nonce,
                    deadline
                )
            )
        );

        if (_recover(digest, signature) != owner) revert InvalidSignature();

        results = new bytes[](len);
        for (uint256 i; i < len; ++i) {
            bool success;
            (success, results[i]) = calls[i].to.call{value: calls[i].value}(
                calls[i].data
            );
            if (!success) revert ExecutionFailed(i, results[i]);
        }

        emit BatchExecuted(owner, len, nonce);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev EIP-712 envelope hash.
    function _hashTypedData(
        bytes32 structHash
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
            );
    }

    /// @dev Recover the signer from a compact 65-byte {r,s,v} signature.
    ///      Reverts with InvalidSignature() if the signature is malformed or
    ///      ecrecover returns address(0).
    function _recover(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        // Inline assembly avoids an extra allocation and is idiomatic here.
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    // -------------------------------------------------------------------------
    // Receive ETH (so the contract can hold value for forwarding)
    // -------------------------------------------------------------------------

    receive() external payable {}
}

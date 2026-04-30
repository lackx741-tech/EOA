// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDelegateEOA
/// @notice Interface for the DelegateEOA meta-transaction executor.
interface IDelegateEOA {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice A single call to be executed on behalf of the owner.
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted after a single delegated call is executed.
    event Executed(
        address indexed owner,
        address indexed to,
        uint256 value,
        uint256 nonce
    );

    /// @notice Emitted after a batch of delegated calls is executed.
    event BatchExecuted(
        address indexed owner,
        uint256 callCount,
        uint256 nonce
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice The recovered signer does not match the declared owner.
    error InvalidSignature();

    /// @notice The deadline has passed.
    error DeadlineExpired();

    /// @notice A call within an execution reverted.
    /// @param index Index of the failing call (0 for single-call).
    /// @param reason Raw revert data from the failing call.
    error ExecutionFailed(uint256 index, bytes reason);

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    /// @notice EIP-712 domain separator for this contract.
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    /// @notice Current nonce for `owner`. Must be included in every signed message.
    function nonces(address owner) external view returns (uint256);

    // -------------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------------

    /// @notice Execute a single call on behalf of `owner`.
    /// @param owner     The EOA whose signature authorises this call.
    /// @param to        Call target.
    /// @param value     ETH value forwarded to the call.
    /// @param data      Call data.
    /// @param deadline  Unix timestamp after which the signature is rejected.
    /// @param signature 65-byte ECDSA signature over the EIP-712 digest.
    /// @return result   Return data from the call.
    function execute(
        address owner,
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (bytes memory result);

    /// @notice Execute a batch of calls on behalf of `owner`.
    /// @param owner     The EOA whose signature authorises these calls.
    /// @param calls     Array of {to, value, data} tuples.
    /// @param deadline  Unix timestamp after which the signature is rejected.
    /// @param signature 65-byte ECDSA signature over the EIP-712 digest.
    /// @return results  Array of return data from each call.
    function executeBatch(
        address owner,
        Call[] calldata calls,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (bytes[] memory results);
}

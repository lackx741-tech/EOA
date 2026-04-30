// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal call target used in tests only.
contract MockTarget {
    uint256 public value;
    bytes public lastData;

    event Called(address caller, uint256 value, bytes data);

    function store(uint256 v) external payable {
        value = v;
        lastData = abi.encodeCall(this.store, (v));
        emit Called(msg.sender, msg.value, lastData);
    }

    function revertAlways() external pure {
        revert("always reverts");
    }

    receive() external payable {}
}

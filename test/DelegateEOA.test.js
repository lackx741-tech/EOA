"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the EIP-712 domain for a deployed DelegateEOA contract.
 */
function buildDomain(contractAddress, chainId) {
  return {
    name: "DelegateEOA",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };
}

/**
 * EIP-712 types for a single DelegatedCall.
 */
const SINGLE_TYPES = {
  DelegatedCall: [
    { name: "owner", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/**
 * EIP-712 types for a DelegatedBatchCall (includes the nested Call type).
 */
const BATCH_TYPES = {
  DelegatedBatchCall: [
    { name: "owner", type: "address" },
    { name: "calls", type: "Call[]" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Call: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
};

/**
 * Return a deadline far in the future (unix seconds).
 */
function futureDeadline() {
  return Math.floor(Date.now() / 1000) + 3600; // +1 hour
}

/**
 * Return a deadline already in the past.
 */
function pastDeadline() {
  return Math.floor(Date.now() / 1000) - 1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DelegateEOA", function () {
  let delegateEOA;
  let mockTarget;
  let owner; // ethers.Wallet  (known private key, can sign typed data)
  let relayer; // ethers.Signer (submits txs on behalf of owner)
  let domain;
  let chainId;

  beforeEach(async function () {
    // Use a fresh wallet so nonces are always 0 at the start of each test.
    owner = ethers.Wallet.createRandom();

    [relayer] = await ethers.getSigners();

    // Deploy contracts.
    const DelegateEOA = await ethers.getContractFactory("DelegateEOA");
    delegateEOA = await DelegateEOA.deploy();
    await delegateEOA.waitForDeployment();

    const MockTarget = await ethers.getContractFactory(
      "MockTarget",
      relayer
    );
    mockTarget = await MockTarget.deploy();
    await mockTarget.waitForDeployment();

    chainId = (await ethers.provider.getNetwork()).chainId;
    domain = buildDomain(await delegateEOA.getAddress(), chainId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Deployment
  // ─────────────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets DOMAIN_SEPARATOR correctly", async function () {
      const expected = ethers.TypedDataEncoder.hashDomain(domain);
      expect(await delegateEOA.DOMAIN_SEPARATOR()).to.equal(expected);
    });

    it("initialises nonces at zero", async function () {
      expect(await delegateEOA.nonces(owner.address)).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // execute – single delegated call
  // ─────────────────────────────────────────────────────────────────────────

  describe("execute", function () {
    it("executes a valid delegated call and increments nonce", async function () {
      const deadline = futureDeadline();
      const nonce = 0;
      const callData = mockTarget.interface.encodeFunctionData("store", [42n]);
      const targetAddr = await mockTarget.getAddress();

      const sig = await owner.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: 0n,
        data: callData,
        nonce,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .execute(owner.address, targetAddr, 0n, callData, deadline, sig)
      )
        .to.emit(delegateEOA, "Executed")
        .withArgs(owner.address, targetAddr, 0n, 0n);

      expect(await mockTarget.value()).to.equal(42n);
      expect(await delegateEOA.nonces(owner.address)).to.equal(1n);
    });

    it("forwards ETH value to the target", async function () {
      const deadline = futureDeadline();
      const nonce = 0;
      const targetAddr = await mockTarget.getAddress();
      const amount = ethers.parseEther("1");

      const sig = await owner.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: amount,
        data: "0x",
        nonce,
        deadline,
      });

      const before = await ethers.provider.getBalance(targetAddr);
      await delegateEOA
        .connect(relayer)
        .execute(owner.address, targetAddr, amount, "0x", deadline, sig, {
          value: amount,
        });

      expect(await ethers.provider.getBalance(targetAddr)).to.equal(
        before + amount
      );
    });

    it("reverts with DeadlineExpired when deadline has passed", async function () {
      const deadline = pastDeadline();
      const callData = "0x";
      const targetAddr = await mockTarget.getAddress();

      const sig = await owner.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: 0n,
        data: callData,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .execute(owner.address, targetAddr, 0n, callData, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "DeadlineExpired");
    });

    it("reverts with InvalidSignature for a wrong signer", async function () {
      const attacker = ethers.Wallet.createRandom();
      const deadline = futureDeadline();
      const callData = "0x";
      const targetAddr = await mockTarget.getAddress();

      // Attacker signs but we claim it's from `owner`.
      const sig = await attacker.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: 0n,
        data: callData,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .execute(owner.address, targetAddr, 0n, callData, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "InvalidSignature");
    });

    it("reverts with InvalidSignature for a malformed signature", async function () {
      const deadline = futureDeadline();
      const targetAddr = await mockTarget.getAddress();

      await expect(
        delegateEOA
          .connect(relayer)
          .execute(owner.address, targetAddr, 0n, "0x", deadline, "0xdeadbeef")
      ).to.be.revertedWithCustomError(delegateEOA, "InvalidSignature");
    });

    it("prevents replay: reverts on nonce reuse", async function () {
      const deadline = futureDeadline();
      const callData = mockTarget.interface.encodeFunctionData("store", [1n]);
      const targetAddr = await mockTarget.getAddress();

      const sig = await owner.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: 0n,
        data: callData,
        nonce: 0,
        deadline,
      });

      // First call succeeds.
      await delegateEOA
        .connect(relayer)
        .execute(owner.address, targetAddr, 0n, callData, deadline, sig);

      // Second call with the same signature must fail.
      await expect(
        delegateEOA
          .connect(relayer)
          .execute(owner.address, targetAddr, 0n, callData, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "InvalidSignature");
    });

    it("reverts with ExecutionFailed when the target reverts", async function () {
      const deadline = futureDeadline();
      const callData =
        mockTarget.interface.encodeFunctionData("revertAlways");
      const targetAddr = await mockTarget.getAddress();

      const sig = await owner.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: 0n,
        data: callData,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .execute(owner.address, targetAddr, 0n, callData, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "ExecutionFailed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // executeBatch – delegated batch calls
  // ─────────────────────────────────────────────────────────────────────────

  describe("executeBatch", function () {
    it("executes a batch of valid calls", async function () {
      const deadline = futureDeadline();
      const targetAddr = await mockTarget.getAddress();

      const calls = [
        {
          to: targetAddr,
          value: 0n,
          data: mockTarget.interface.encodeFunctionData("store", [10n]),
        },
        {
          to: targetAddr,
          value: 0n,
          data: mockTarget.interface.encodeFunctionData("store", [20n]),
        },
      ];

      const sig = await owner.signTypedData(domain, BATCH_TYPES, {
        owner: owner.address,
        calls,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .executeBatch(owner.address, calls, deadline, sig)
      )
        .to.emit(delegateEOA, "BatchExecuted")
        .withArgs(owner.address, 2n, 0n);

      // Last store wins.
      expect(await mockTarget.value()).to.equal(20n);
      expect(await delegateEOA.nonces(owner.address)).to.equal(1n);
    });

    it("reverts with DeadlineExpired", async function () {
      const deadline = pastDeadline();
      const targetAddr = await mockTarget.getAddress();
      const calls = [{ to: targetAddr, value: 0n, data: "0x" }];

      const sig = await owner.signTypedData(domain, BATCH_TYPES, {
        owner: owner.address,
        calls,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .executeBatch(owner.address, calls, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "DeadlineExpired");
    });

    it("reverts with InvalidSignature for wrong signer", async function () {
      const attacker = ethers.Wallet.createRandom();
      const deadline = futureDeadline();
      const targetAddr = await mockTarget.getAddress();
      const calls = [{ to: targetAddr, value: 0n, data: "0x" }];

      const sig = await attacker.signTypedData(domain, BATCH_TYPES, {
        owner: owner.address,
        calls,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .executeBatch(owner.address, calls, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "InvalidSignature");
    });

    it("prevents replay for batch calls", async function () {
      const deadline = futureDeadline();
      const targetAddr = await mockTarget.getAddress();
      const calls = [
        {
          to: targetAddr,
          value: 0n,
          data: mockTarget.interface.encodeFunctionData("store", [5n]),
        },
      ];

      const sig = await owner.signTypedData(domain, BATCH_TYPES, {
        owner: owner.address,
        calls,
        nonce: 0,
        deadline,
      });

      // First call succeeds.
      await delegateEOA
        .connect(relayer)
        .executeBatch(owner.address, calls, deadline, sig);

      // Replay must fail.
      await expect(
        delegateEOA
          .connect(relayer)
          .executeBatch(owner.address, calls, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "InvalidSignature");
    });

    it("reverts with ExecutionFailed on a failing call within batch", async function () {
      const deadline = futureDeadline();
      const targetAddr = await mockTarget.getAddress();
      const calls = [
        {
          to: targetAddr,
          value: 0n,
          data: mockTarget.interface.encodeFunctionData("store", [99n]),
        },
        {
          to: targetAddr,
          value: 0n,
          data: mockTarget.interface.encodeFunctionData("revertAlways"),
        },
      ];

      const sig = await owner.signTypedData(domain, BATCH_TYPES, {
        owner: owner.address,
        calls,
        nonce: 0,
        deadline,
      });

      await expect(
        delegateEOA
          .connect(relayer)
          .executeBatch(owner.address, calls, deadline, sig)
      ).to.be.revertedWithCustomError(delegateEOA, "ExecutionFailed");
    });

    it("nonces for execute and executeBatch share the same counter", async function () {
      const deadline = futureDeadline();
      const targetAddr = await mockTarget.getAddress();
      const callData = mockTarget.interface.encodeFunctionData("store", [1n]);

      // Use execute once (nonce=0).
      const sig0 = await owner.signTypedData(domain, SINGLE_TYPES, {
        owner: owner.address,
        to: targetAddr,
        value: 0n,
        data: callData,
        nonce: 0,
        deadline,
      });
      await delegateEOA
        .connect(relayer)
        .execute(owner.address, targetAddr, 0n, callData, deadline, sig0);

      expect(await delegateEOA.nonces(owner.address)).to.equal(1n);

      // Now use executeBatch with nonce=1.
      const calls = [{ to: targetAddr, value: 0n, data: callData }];
      const sig1 = await owner.signTypedData(domain, BATCH_TYPES, {
        owner: owner.address,
        calls,
        nonce: 1,
        deadline,
      });
      await delegateEOA
        .connect(relayer)
        .executeBatch(owner.address, calls, deadline, sig1);

      expect(await delegateEOA.nonces(owner.address)).to.equal(2n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Type hash constants
  // ─────────────────────────────────────────────────────────────────────────

  describe("Type hash constants", function () {
    it("CALL_TYPEHASH matches expected value", async function () {
      const expected = ethers.id(
        "DelegatedCall(address owner,address to,uint256 value,bytes data,uint256 nonce,uint256 deadline)"
      );
      expect(await delegateEOA.CALL_TYPEHASH()).to.equal(expected);
    });

    it("CALL_STRUCT_TYPEHASH matches expected value", async function () {
      const expected = ethers.id("Call(address to,uint256 value,bytes data)");
      expect(await delegateEOA.CALL_STRUCT_TYPEHASH()).to.equal(expected);
    });

    it("BATCH_CALL_TYPEHASH matches expected value", async function () {
      const expected = ethers.id(
        "DelegatedBatchCall(address owner,Call[] calls,uint256 nonce,uint256 deadline)Call(address to,uint256 value,bytes data)"
      );
      expect(await delegateEOA.BATCH_CALL_TYPEHASH()).to.equal(expected);
    });
  });
});

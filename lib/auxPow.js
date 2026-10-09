/**
 * @module auxPow
 * @description Namecoin-style merged mining (AuxPoW) helpers: aux chain
 * config validation, the merge-mining tag placed in the parent coinbase,
 * and serialization of the auxpow passed to `submitauxblock`.
 *
 * Phase 1 supports a single aux chain using the Namecoin standard
 * (hash in the tag as returned by createauxblock, Namecoin slot rule).
 * With one chain the merged-mining tree has size 1: merkle nonce 0,
 * empty chain branch, chain index 0.
 */

var util = require("./util.js");

var MERGE_MINING_HEADER = Buffer.from("fabe6d6d", "hex");

// Length of the merge-mining tag for a single aux chain:
// fabe6d6d (4) + aux hash (32) + tree size (4) + merkle nonce (4)
var TAG_LENGTH = 44;

var DEFAULT_POLL_INTERVAL = 5000;

// Per-chain options. Others (e.g. byteOrder "reversed", slotRule "modulo"
// for ESF) are accepted by the config shape but not implemented yet.
var SUPPORTED_BYTE_ORDERS = ["namecoin"];
var SUPPORTED_SLOT_RULES = ["namecoin"];

exports.TAG_LENGTH = TAG_LENGTH;

/**
 * Validates the pool's mergedMining config and fills in defaults.
 * Returns null when merged mining is absent or disabled, so callers can
 * skip all aux work. Throws with a readable message on invalid config.
 *
 * @param {Object} [mergedMining] - options.mergedMining from the pool config
 * @returns {Object|null} { pollInterval, chains: [chain] }
 */
exports.normalizeConfig = function (mergedMining) {
  if (!mergedMining || mergedMining.enabled !== true) return null;

  var chains = mergedMining.auxChains;
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new Error("mergedMining.enabled is true but auxChains is empty");
  }
  if (chains.length > 1) {
    throw new Error(
      "mergedMining supports one aux chain in phase 1, got " + chains.length
    );
  }

  var normalized = chains.map(function (c, i) {
    var name = c.coin || "auxChains[" + i + "]";
    var byteOrder = c.byteOrder || "namecoin";
    var slotRule = c.slotRule || "namecoin";

    if (!c.coin) throw new Error("auxChains[" + i + "].coin is required");
    if (SUPPORTED_BYTE_ORDERS.indexOf(byteOrder) === -1) {
      throw new Error(
        name + ': byteOrder "' + byteOrder + '" is not implemented'
      );
    }
    if (SUPPORTED_SLOT_RULES.indexOf(slotRule) === -1) {
      throw new Error(name + ': slotRule "' + slotRule + '" is not implemented');
    }
    if (typeof c.address !== "string" || c.address.length === 0) {
      throw new Error(name + ": address is required (createauxblock payout)");
    }
    if (!Array.isArray(c.daemons) || c.daemons.length === 0) {
      throw new Error(name + ": daemons is required");
    }
    if (
      c.chainId !== undefined &&
      (!Number.isInteger(c.chainId) || c.chainId < 0)
    ) {
      throw new Error(name + ": chainId must be a non-negative integer");
    }

    return {
      coin: c.coin,
      symbol: c.symbol || c.coin,
      chainId: c.chainId,
      byteOrder: byteOrder,
      slotRule: slotRule,
      address: c.address,
      daemons: c.daemons,
    };
  });

  var pollInterval = mergedMining.auxPollInterval;
  if (typeof pollInterval !== "number" || pollInterval <= 0) {
    pollInterval = DEFAULT_POLL_INTERVAL;
  }

  return { pollInterval: pollInterval, chains: normalized };
};

/**
 * Reads the aux block target from a createauxblock response as a BigInt
 * comparable with the share's header hash. Prefers the big-endian
 * `target`, then the little-endian `_target` (Namecoin), then `bits`.
 */
exports.targetFromAuxBlock = function (auxBlock) {
  if (typeof auxBlock.target === "string" && auxBlock.target.length === 64) {
    return BigInt("0x" + auxBlock.target);
  }
  if (typeof auxBlock._target === "string" && auxBlock._target.length === 64) {
    return BigInt("0x" + util.reverseHex(auxBlock._target));
  }
  if (typeof auxBlock.bits === "string") {
    return util.bignumFromBitsHex(auxBlock.bits);
  }
  throw new Error("createauxblock response has no target, _target or bits");
};

/**
 * Builds the merge-mining tag for a single aux chain (Namecoin standard):
 *   fabe6d6d | unhex(hash) as is | tree size 1 (LE) | merkle nonce 0 (LE)
 *
 * @param {string} auxHashHex - `hash` from createauxblock
 * @returns {Buffer} 44-byte tag
 */
exports.buildMergeMiningTag = function (auxHashHex) {
  var hash = Buffer.from(auxHashHex, "hex");
  if (hash.length !== 32) {
    throw new Error("aux block hash must be 32 bytes, got " + hash.length);
  }
  return Buffer.concat([
    MERGE_MINING_HEADER,
    hash,
    util.packUInt32LE(1),
    util.packUInt32LE(0),
  ]);
};

/**
 * Serializes the auxpow in Namecoin's format:
 *   parent coinbase | hashBlock (32) | coinbase merkle branch | index 0
 *   | chain merkle branch (empty) | chain index 0 | parent header (80)
 *
 * hashBlock is unused by the aux node; like most pools we put the parent
 * block hash there.
 *
 * @param {Buffer} coinbase - Parent coinbase tx, serialized without witness
 * @param {Array<Buffer>} merkleSteps - Coinbase merkle branch (job.merkleTree.steps)
 * @param {Buffer} header - Parent block header (80 bytes), with the rolled version
 * @returns {Buffer}
 */
exports.buildAuxPow = function (coinbase, merkleSteps, header) {
  if (header.length !== 80) {
    throw new Error("parent header must be 80 bytes, got " + header.length);
  }
  return Buffer.concat([
    coinbase,
    util.sha256d(header),
    util.varIntBuffer(merkleSteps.length),
    Buffer.concat(merkleSteps),
    util.packInt32LE(0),
    util.varIntBuffer(0),
    util.packInt32LE(0),
    header,
  ]);
};

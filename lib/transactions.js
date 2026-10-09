var util = require("./util.js");

/**
 * Builds a standards-compliant OP_RETURN output script carrying an
 * arbitrary UTF-8 message (used for the pool signature instead of the
 * old non-standard post-locktime comment field).
 */
var buildOpReturnScript = function (message) {
  var dataBuffer = Buffer.from(message, "utf8");

  // Config-supplied message: truncate rather than throw, so a
  // misconfigured/too-long txMessageText can't crash job creation on
  // every single block template.
  if (dataBuffer.length > 255) {
    dataBuffer = dataBuffer.slice(0, 255);
  }

  var pushOpcode =
    dataBuffer.length <= 75
      ? Buffer.from([dataBuffer.length])
      : Buffer.concat([
          Buffer.from([0x4c]), // OP_PUSHDATA1
          Buffer.from([dataBuffer.length]),
        ]);

  return Buffer.concat([
    Buffer.from([0x6a]), // OP_RETURN
    pushOpcode,
    dataBuffer,
  ]);
};

/**
 * Builds the coinbase transaction's output set: pool reward, configured
 * fee recipients, optional OP_RETURN pool signature, and optional
 * segwit witness commitment. SHA-256-coin only — no masternode,
 * superblock, DIP2, or Koto-specific outputs.
 */
var generateOutputTransactions = function (
  poolRecipient,
  recipients,
  rpcData,
  txMessages,
  txMessageText
) {
  var DEFAULT_TX_MESSAGE_TEXT = "https://github.com/janos-raul/sha256-nomp";

  var reward = rpcData.coinbasevalue;
  if (typeof reward !== "number") {
    throw new Error(
      "Missing rpcData.coinbasevalue in getblocktemplate response"
    );
  }

  var rewardToPool = reward;
  var txOutputBuffers = [];

  for (var i = 0; i < recipients.length; i++) {
    var recipientReward;
    if (recipients[i].percent == 0) {
      if (recipients[i].value < rewardToPool) {
        recipientReward = recipients[i].value;
      } else {
        continue;
      }
    } else {
      recipientReward = Math.floor(recipients[i].percent * reward);
    }
    rewardToPool -= recipientReward;

    txOutputBuffers.push(
      Buffer.concat([
        util.packInt64LE(recipientReward),
        util.varIntBuffer(recipients[i].script.length),
        recipients[i].script,
      ])
    );
  }

  // Standards-compliant pool signature via OP_RETURN (0-value output,
  // so it does not need to be subtracted from rewardToPool)
  if (txMessages === true) {
    var opReturnScript = buildOpReturnScript(
      typeof txMessageText === "string" && txMessageText.length > 0
        ? txMessageText
        : DEFAULT_TX_MESSAGE_TEXT
    );
    txOutputBuffers.push(
      Buffer.concat([
        util.packInt64LE(0),
        util.varIntBuffer(opReturnScript.length),
        opReturnScript,
      ])
    );
  }

  txOutputBuffers.unshift(
    Buffer.concat([
      util.packInt64LE(rewardToPool),
      util.varIntBuffer(poolRecipient.length),
      poolRecipient,
    ])
  );

  if (rpcData.default_witness_commitment !== undefined) {
    var witness_commitment = Buffer.from(
      rpcData.default_witness_commitment,
      "hex"
    );
    txOutputBuffers.unshift(
      Buffer.concat([
        util.packInt64LE(0),
        util.varIntBuffer(witness_commitment.length),
        witness_commitment,
      ])
    );
  }

  return Buffer.concat([
    util.varIntBuffer(txOutputBuffers.length),
    Buffer.concat(txOutputBuffers),
  ]);
};

// The coinbase scriptSig has a hard 100-byte consensus limit, shared by
// the height/timestamp pushes (~11 bytes), the optional 45-byte
// merge-mining tag push, the 10-byte extranonce placeholder and the block
// identifier. Cap the raw identifier so a misconfigured/too-long value
// truncates gracefully instead of risking an oversized scriptSig the
// daemon would reject as an invalid block. With merged mining on the tag
// leaves room for about 30 bytes.
var MAX_BLOCK_IDENTIFIER_BYTES = 64;
var MAX_BLOCK_IDENTIFIER_BYTES_MERGED = 30;
var MAX_COINBASE_SCRIPTSIG_BYTES = 100;

exports.MAX_COINBASE_SCRIPTSIG_BYTES = MAX_COINBASE_SCRIPTSIG_BYTES;

/**
 * Builds the coinbase scriptSig around the extranonce placeholder:
 *   part1 = height | timestamp | [merge-mining tag push] | extranonce push opcode
 *   part2 = "/identifier/"
 */
var buildScriptSigParts = function (
  height,
  timestamp,
  extraNoncePlaceholderLength,
  blockIdentifier,
  mergeMiningTag
) {
  // Per-coin block identifier, explicitly passed in rather than read from
  // shared module state — multiple coins run as separate Pool instances
  // within the same process, so a global util.getBlockIdentifier() would
  // leak one coin's identifier into every other coin's blocks.
  var effectiveBlockIdentifier =
    typeof blockIdentifier === "string" && blockIdentifier.length > 0
      ? blockIdentifier
      : "https://github.com/janos-raul/sha256-nomp";

  var maxIdentifierBytes = mergeMiningTag
    ? MAX_BLOCK_IDENTIFIER_BYTES_MERGED
    : MAX_BLOCK_IDENTIFIER_BYTES;
  // Truncate by whole characters, so a multi-byte UTF-8 character is never
  // cut in half (which would decode to a 3-byte replacement character)
  var identifier = effectiveBlockIdentifier;
  while (Buffer.byteLength(identifier, "utf8") > maxIdentifierBytes) {
    identifier = identifier.slice(0, -1);
  }

  var part1 = [util.serializeNumber(height), util.serializeNumber(timestamp)];
  if (mergeMiningTag) {
    // Tag is pushed before the extranonce so it sits at a fixed offset
    // and is never touched by miner-supplied bytes.
    part1.push(Buffer.from([mergeMiningTag.length]), mergeMiningTag);
  }
  part1.push(Buffer.from([extraNoncePlaceholderLength]));

  return [
    Buffer.concat(part1),
    util.serializeString("/" + identifier + "/"),
  ];
};

/**
 * Worst-case coinbase scriptSig length for this pool's settings, used as
 * a startup check: largest BIP34 height and timestamp encodings before
 * 2038, a tag of the given length, the full placeholder and identifier.
 *
 * @param {number} extraNoncePlaceholderLength
 * @param {string} blockIdentifier
 * @param {number} mergeMiningTagLength - 0 when merged mining is off
 * @returns {number}
 */
exports.maxCoinbaseScriptSigLength = function (
  extraNoncePlaceholderLength,
  blockIdentifier,
  mergeMiningTagLength
) {
  var parts = buildScriptSigParts(
    0x7fffffff,
    0x7fffffff,
    extraNoncePlaceholderLength,
    blockIdentifier,
    mergeMiningTagLength > 0 ? Buffer.alloc(mergeMiningTagLength) : null
  );
  return parts[0].length + extraNoncePlaceholderLength + parts[1].length;
};

/**
 * Builds the two-part coinbase (generation) transaction, split around
 * the extranonce placeholder. SHA-256-coin only: fixed version 1,
 * no POS timestamp, no DIP2/coinbase_payload, no Koto version-group
 * fields.
 *
 * @param {Buffer} [mergeMiningTag] - Merge-mining tag for the aux chain(s)
 */
exports.CreateGeneration = function (
  rpcData,
  publicKey,
  extraNoncePlaceholder,
  txMessages,
  recipients,
  txMessageText,
  blockIdentifier,
  mergeMiningTag
) {
  var txInputsCount = 1;
  var txVersion = 1;
  var txLockTime = 0;

  var txInPrevOutHash = "";
  var txInPrevOutIndex = Math.pow(2, 32) - 1;
  var txInSequence = 0;

  var scriptSigParts = buildScriptSigParts(
    rpcData.height,
    (Date.now() / 1000) | 0,
    extraNoncePlaceholder.length,
    blockIdentifier,
    mergeMiningTag
  );
  var scriptSigPart1 = scriptSigParts[0];
  var scriptSigPart2 = scriptSigParts[1];

  var p1 = Buffer.concat([
    util.packUInt32LE(txVersion),

    //transaction input
    util.varIntBuffer(txInputsCount),
    util.uint256BufferFromHash(txInPrevOutHash),
    util.packUInt32LE(txInPrevOutIndex),
    util.varIntBuffer(
      scriptSigPart1.length +
        extraNoncePlaceholder.length +
        scriptSigPart2.length
    ),
    scriptSigPart1,
  ]);

  /*
    The generation transaction must be split at the extranonce (which located in the transaction input
    scriptSig). Miners send us unique extranonces that we use to join the two parts in attempt to create
    a valid share and/or block.
     */

  var outputTransactions = generateOutputTransactions(
    publicKey,
    recipients,
    rpcData,
    txMessages,
    txMessageText
  );

  var p2 = Buffer.concat([
    scriptSigPart2,
    util.packUInt32LE(txInSequence),
    //end transaction input

    //transaction output
    outputTransactions,
    //end transaction output

    util.packUInt32LE(txLockTime),
  ]);

  return [p1, p2];
};
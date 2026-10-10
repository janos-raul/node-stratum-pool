/**
 * @module auxPow
 * @description Namecoin-style merged mining (AuxPoW) helpers: config
 * validation, the merged-mining tree for a group of aux coins, the tag
 * placed in the parent coinbase, and serialization of the auxpow passed
 * to `submitauxblock`.
 *
 * Aux coins are defined once in `auxCoins`; `groups` list which coins are
 * merge-mined together; a port opts in with `auxGroup`. Coins following
 * the Namecoin standard can share a group (one tree, each coin at its
 * Namecoin slot). A coin with a non-standard byte order or slot rule
 * (e.g. ESF: reversed, modulo) must be alone in its group.
 *
 * Aux coins are fed in one of two modes:
 *   auxblock (default): the aux node builds the block (createauxblock /
 *     getauxblock) and takes the auxpow back with submitauxblock.
 *   getblocktemplate: the aux node has no aux-block RPCs (e.g. VargaMesh);
 *     the pool builds the aux block from getblocktemplate itself and
 *     submits header + auxpow + transactions with submitblock.
 */

var util = require("./util.js");

var MERGE_MINING_HEADER = Buffer.from("fabe6d6d", "hex");

// fabe6d6d (4) + tree root (32) + tree size (4) + merkle nonce (4)
var TAG_LENGTH = 44;

var DEFAULT_POLL_INTERVAL = 5000;

var BYTE_ORDERS = ["namecoin", "reversed"];
var SLOT_RULES = ["namecoin", "modulo"];
var MODES = ["auxblock", "getblocktemplate"];

// Password parameters the stratum layer already uses
var RESERVED_PARAMS = ["d", "md", "tt", "rt", "vp", "m", "solo"];

// Largest merged-mining tree: 4096 slots. Every job rebuild hashes the
// whole tree, so keep it small; Namecoin itself allows up to 2^30.
var MAX_TREE_HEIGHT = 12;

var ZERO_HASH = Buffer.alloc(32);

exports.TAG_LENGTH = TAG_LENGTH;

/**
 * Namecoin's expected slot of a chain in a tree of size 2^h, in 32-bit
 * arithmetic (identical to Namecoin's for h <= 30).
 */
var expectedIndex = (exports.expectedIndex = function (nonce, chainId, h) {
  var rand = (Math.imul(nonce >>> 0, 1103515245) + 12345) >>> 0;
  rand = (rand + chainId) >>> 0;
  rand = (Math.imul(rand, 1103515245) + 12345) >>> 0;
  return rand % Math.pow(2, h);
});

/**
 * Finds the smallest tree in which every chain ID of a standard group gets
 * a distinct Namecoin slot.
 *
 * The merkle nonce cannot help: the slot is a*(a*nonce + b + chainId) + b
 * mod 2^h with an odd multiplier a, so two chains' slots differ by
 * a*(id1 - id2) mod 2^h whatever the nonce. Slots are distinct exactly when
 * the chain IDs are distinct mod 2^h, so the nonce is fixed at 0 and only
 * the tree size is searched.
 *
 * @returns {Object|null} { size, nonce, slots: [index per chain ID] }
 */
var findTree = (exports.findTree = function (chainIds) {
  var h = 0;
  while (Math.pow(2, h) < chainIds.length) h++;
  for (; h <= MAX_TREE_HEIGHT; h++) {
    var slots = chainIds.map(function (id) {
      return expectedIndex(0, id, h);
    });
    if (new Set(slots).size === slots.length) {
      return { size: Math.pow(2, h), nonce: 0, slots: slots };
    }
  }
  return null;
});

function isStandard(coin) {
  return coin.byteOrder === "namecoin" && coin.slotRule === "namecoin";
}

/**
 * Validates the pool's mergedMining config against its ports and fills in
 * defaults. Returns null when merged mining is absent or disabled, so
 * callers can skip all aux work. Throws with a readable message on
 * invalid config.
 *
 * @param {Object} [mergedMining] - options.mergedMining from the pool config
 * @param {Object} ports - options.ports
 * @returns {Object|null} { pollInterval, coins, groups, portGroups, addressParams }
 */
exports.normalizeConfig = function (mergedMining, ports) {
  if (!mergedMining || mergedMining.enabled !== true) return null;

  if (mergedMining.auxChains) {
    throw new Error(
      "mergedMining.auxChains is the phase 1 format; use auxCoins and groups"
    );
  }

  var auxCoins = mergedMining.auxCoins;
  if (!auxCoins || typeof auxCoins !== "object" || !Object.keys(auxCoins).length) {
    throw new Error("mergedMining.enabled is true but auxCoins is empty");
  }

  var coins = {};
  var addressParams = {};
  Object.keys(auxCoins).forEach(function (name) {
    var c = auxCoins[name];
    var coin = {
      name: name,
      symbol: c.symbol || name,
      chainId: c.chainId,
      byteOrder: c.byteOrder || "namecoin",
      slotRule: c.slotRule || "namecoin",
      addressParam: typeof c.addressParam === "string" ? c.addressParam.toLowerCase() : "",
      address: c.address,
      mode: c.mode || "auxblock",
      daemons: Array.isArray(c.daemons) ? c.daemons : c.daemon ? [c.daemon] : [],
    };

    if (!Number.isInteger(coin.chainId) || coin.chainId < 0) {
      throw new Error(name + ": chainId must be a non-negative integer");
    }
    if (BYTE_ORDERS.indexOf(coin.byteOrder) === -1) {
      throw new Error(name + ': unknown byteOrder "' + coin.byteOrder + '"');
    }
    if (MODES.indexOf(coin.mode) === -1) {
      throw new Error(name + ': unknown mode "' + coin.mode + '" (auxblock or getblocktemplate)');
    }
    if (coin.mode === "getblocktemplate" && !isStandard(coin)) {
      throw new Error(name + ": getblocktemplate mode supports the namecoin byte order and slot rule only");
    }
    if (SLOT_RULES.indexOf(coin.slotRule) === -1) {
      throw new Error(name + ': unknown slotRule "' + coin.slotRule + '"');
    }
    if (!/^[a-z0-9_]+$/.test(coin.addressParam)) {
      throw new Error(name + ": addressParam is required (letters, digits, _)");
    }
    if (RESERVED_PARAMS.indexOf(coin.addressParam) !== -1) {
      throw new Error(
        name + ': addressParam "' + coin.addressParam + '" is a reserved password parameter'
      );
    }
    if (addressParams[coin.addressParam]) {
      throw new Error(
        name + ': addressParam "' + coin.addressParam + '" is also used by ' +
          addressParams[coin.addressParam]
      );
    }
    if (typeof coin.address !== "string" || coin.address.length === 0) {
      throw new Error(name + ": address is required (pool payout of aux blocks)");
    }
    if (coin.daemons.length === 0) {
      throw new Error(name + ": daemon is required");
    }

    addressParams[coin.addressParam] = name;
    coins[name] = coin;
  });

  var groupDefs = mergedMining.groups;
  if (!groupDefs || typeof groupDefs !== "object" || !Object.keys(groupDefs).length) {
    throw new Error("mergedMining.groups is empty");
  }

  var groups = {};
  Object.keys(groupDefs).forEach(function (groupName) {
    var members = groupDefs[groupName];
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error('group "' + groupName + '" is empty');
    }
    members.forEach(function (m) {
      if (!coins[m]) {
        throw new Error('group "' + groupName + '": unknown aux coin "' + m + '"');
      }
    });
    if (new Set(members).size !== members.length) {
      throw new Error('group "' + groupName + '" lists a coin twice');
    }

    var nonStandard = members.filter(function (m) {
      return !isStandard(coins[m]);
    });
    if (nonStandard.length && members.length > 1) {
      throw new Error(
        'group "' + groupName + '": ' + nonStandard.join(", ") +
          " uses a non-standard byte order or slot rule and must be alone in its group"
      );
    }

    var chainIds = members.map(function (m) {
      return coins[m].chainId;
    });
    if (new Set(chainIds).size !== chainIds.length) {
      throw new Error('group "' + groupName + '": chain IDs must be unique');
    }

    var tree;
    if (nonStandard.length) {
      // A single coin with the modulo slot rule: tree size 1, slot 0
      tree = { size: 1, nonce: 0, slots: [0] };
    } else {
      tree = findTree(chainIds);
      if (!tree) {
        throw new Error(
          'group "' + groupName + '": chain IDs ' + chainIds.join(", ") +
            " collide modulo " + Math.pow(2, MAX_TREE_HEIGHT) +
            " (tree size limit); put the colliding coins in separate groups"
        );
      }
    }

    var slots = {};
    members.forEach(function (m, i) {
      slots[m] = tree.slots[i];
    });

    groups[groupName] = {
      name: groupName,
      coins: members.slice(),
      size: tree.size,
      nonce: tree.nonce,
      slots: slots,
      // Group of one non-standard coin takes that coin's byte order
      byteOrder: nonStandard.length ? coins[members[0]].byteOrder : "namecoin",
    };
  });

  var portGroups = {};
  Object.keys(ports || {}).forEach(function (port) {
    var g = ports[port] && ports[port].auxGroup;
    if (g === undefined) return;
    if (!groups[g]) {
      throw new Error("port " + port + ': auxGroup "' + g + '" is not in mergedMining.groups');
    }
    portGroups[port] = g;
  });

  var pollInterval = mergedMining.auxPollInterval;
  if (typeof pollInterval !== "number" || pollInterval <= 0) {
    pollInterval = DEFAULT_POLL_INTERVAL;
  }

  return {
    pollInterval: pollInterval,
    coins: coins,
    groups: groups,
    portGroups: portGroups,
    addressParams: addressParams,
  };
};

/**
 * Reads aux payout addresses from a stratum password such as
 * "m=solo,s256=<address>,esf=<address>".
 *
 * @param {string} password
 * @param {Object} addressParams - addressParam -> aux coin name
 * @returns {Object} aux coin name -> address
 */
exports.parseAuxAddresses = function (password, addressParams) {
  var addresses = {};
  if (typeof password !== "string") return addresses;
  password.split(",").forEach(function (part) {
    var eq = part.indexOf("=");
    if (eq === -1) return;
    var key = part.slice(0, eq).trim().toLowerCase();
    var value = part.slice(eq + 1).trim();
    if (value && Object.prototype.hasOwnProperty.call(addressParams, key)) {
      addresses[addressParams[key]] = value;
    }
  });
  return addresses;
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
 * Builds a group's merged-mining tree from the current aux blocks.
 * Leaves hold each coin's block hash in internal byte order at the coin's
 * slot; empty slots (and coins without a current aux block) hold zeros.
 * The tag carries the root in the group's byte order:
 *   namecoin: reversed root (for one coin: `hash` as returned by createauxblock)
 *   reversed: root in internal order (ESF)
 *
 * @param {Object} group - normalized group
 * @param {Object} auxBlocks - coin name -> { hash, ... }
 * @returns {Object} { tag, branches: coin -> { branch: [Buffer], index } }
 */
exports.buildGroupCommitment = function (group, auxBlocks) {
  var leaves = [];
  for (var i = 0; i < group.size; i++) leaves.push(ZERO_HASH);

  var included = group.coins.filter(function (coin) {
    return auxBlocks[coin];
  });
  included.forEach(function (coin) {
    var hash = Buffer.from(auxBlocks[coin].hash, "hex");
    if (hash.length !== 32) {
      throw new Error(coin + ": aux block hash must be 32 bytes, got " + hash.length);
    }
    leaves[group.slots[coin]] = util.reverseBuffer(hash);
  });

  var branches = {};
  included.forEach(function (coin) {
    branches[coin] = { branch: [], index: group.slots[coin] };
  });

  var layer = leaves;
  var positions = {};
  included.forEach(function (coin) {
    positions[coin] = group.slots[coin];
  });
  while (layer.length > 1) {
    included.forEach(function (coin) {
      branches[coin].branch.push(layer[positions[coin] ^ 1]);
      positions[coin] >>= 1;
    });
    var next = [];
    for (var j = 0; j < layer.length; j += 2) {
      next.push(util.sha256d(Buffer.concat([layer[j], layer[j + 1]])));
    }
    layer = next;
  }
  var root = layer[0];

  return {
    tag: Buffer.concat([
      MERGE_MINING_HEADER,
      group.byteOrder === "namecoin" ? util.reverseBuffer(root) : root,
      util.packUInt32LE(group.size),
      util.packUInt32LE(group.nonce),
    ]),
    branches: branches,
  };
};

/**
 * Serializes the auxpow in Namecoin's format:
 *   parent coinbase | hashBlock (32) | coinbase merkle branch | index 0
 *   | chain merkle branch | chain index | parent header (80)
 *
 * hashBlock is unused by the aux node; like most pools we put the parent
 * block hash there.
 *
 * @param {Buffer} coinbase - Parent coinbase tx, serialized without witness
 * @param {Array<Buffer>} merkleSteps - Coinbase merkle branch (job.merkleTree.steps)
 * @param {Buffer} header - Parent block header (80 bytes), with the rolled version
 * @param {Array<Buffer>} chainBranch - The coin's branch in the merged-mining tree
 * @param {number} chainIndex - The coin's slot in the merged-mining tree
 * @returns {Buffer}
 */
exports.buildAuxPow = function (coinbase, merkleSteps, header, chainBranch, chainIndex) {
  if (header.length !== 80) {
    throw new Error("parent header must be 80 bytes, got " + header.length);
  }
  return Buffer.concat([
    coinbase,
    util.sha256d(header),
    util.varIntBuffer(merkleSteps.length),
    Buffer.concat(merkleSteps),
    util.packInt32LE(0),
    util.varIntBuffer(chainBranch.length),
    Buffer.concat(chainBranch),
    util.packInt32LE(chainIndex),
    header,
  ]);
};

/**
 * Merkle root of txids given in internal byte order (Bitcoin rule: an odd
 * layer repeats its last hash).
 */
function merkleRoot(hashes) {
  var layer = hashes.slice();
  while (layer.length > 1) {
    if (layer.length % 2) layer.push(layer[layer.length - 1]);
    var next = [];
    for (var i = 0; i < layer.length; i += 2) {
      next.push(util.sha256d(Buffer.concat([layer[i], layer[i + 1]])));
    }
    layer = next;
  }
  return layer[0];
}

/**
 * Builds an aux block from an aux node's getblocktemplate (getblocktemplate
 * mode). The coinbase pays the whole coinbasevalue to payoutScript; its
 * scriptSig is the BIP34 height plus a short tag. With segwit the coinbase
 * carries the witness commitment and the 32-byte zero witness reserved
 * value. The header takes the template's version (which already has the
 * AuxPoW flag) and nonce (auxpow_childnonce, the chain tag the node
 * requires).
 *
 * @param {Object} tpl - getblocktemplate result (auxpow: true)
 * @param {Buffer} payoutScript - scriptPubKey paid by the coinbase
 * @param {string} [tag] - text added to the coinbase scriptSig
 * @returns {Object} { hash (display hex, as createauxblock returns it),
 *   header (80 bytes), coinbase (with witness), coinbaseTxid (display hex),
 *   txCount, txData (Buffer), height, bits, coinbaseValue, previousblockhash }
 */
exports.buildTemplateAuxBlock = function (tpl, payoutScript, tag) {
  ["version", "previousblockhash", "curtime", "bits", "height", "coinbasevalue"].forEach(function (f) {
    if (tpl[f] === undefined || tpl[f] === null) throw new Error("getblocktemplate has no " + f);
  });
  var txs = Array.isArray(tpl.transactions) ? tpl.transactions : [];
  var tagBuf = Buffer.from(tag || "/sha256-nomp/", "utf8").slice(0, 40);
  var scriptSig = Buffer.concat([util.serializeNumber(tpl.height), Buffer.from([tagBuf.length]), tagBuf]);

  var outputs = [
    Buffer.concat([util.packInt64LE(tpl.coinbasevalue), util.varIntBuffer(payoutScript.length), payoutScript]),
  ];
  var commitment = tpl.default_witness_commitment ? Buffer.from(tpl.default_witness_commitment, "hex") : null;
  if (commitment) {
    outputs.push(Buffer.concat([util.packInt64LE(0), util.varIntBuffer(commitment.length), commitment]));
  }

  var input = Buffer.concat([
    Buffer.alloc(32), // null prevout hash
    util.packUInt32LE(0xffffffff),
    util.varIntBuffer(scriptSig.length),
    scriptSig,
    util.packUInt32LE(0xffffffff),
  ]);
  var body = Buffer.concat([
    util.varIntBuffer(1),
    input,
    util.varIntBuffer(outputs.length),
    Buffer.concat(outputs),
  ]);
  var version = util.packUInt32LE(2);
  var lockTime = util.packUInt32LE(0);
  var legacy = Buffer.concat([version, body, lockTime]);
  var coinbase = commitment
    ? Buffer.concat([
        version,
        Buffer.from([0x00, 0x01]), // segwit marker and flag
        body,
        Buffer.from([0x01, 0x20]), // one witness item of 32 bytes
        Buffer.alloc(32), // witness reserved value
        lockTime,
      ])
    : legacy;
  var coinbaseTxid = util.sha256d(legacy);

  var root = merkleRoot(
    [coinbaseTxid].concat(
      txs.map(function (t) {
        return util.reverseBuffer(Buffer.from(t.txid || t.hash, "hex"));
      })
    )
  );

  var header = Buffer.concat([
    util.packUInt32LE(tpl.version >>> 0),
    util.reverseBuffer(Buffer.from(tpl.previousblockhash, "hex")),
    root,
    util.packUInt32LE(tpl.curtime),
    util.reverseBuffer(Buffer.from(tpl.bits, "hex")),
    util.packUInt32LE((tpl.auxpow_childnonce || 0) >>> 0),
  ]);

  return {
    hash: util.reverseBuffer(util.sha256d(header)).toString("hex"),
    header: header,
    coinbase: coinbase,
    coinbaseTxid: util.reverseBuffer(coinbaseTxid).toString("hex"),
    txCount: txs.length + 1,
    txData: Buffer.concat(
      txs.map(function (t) {
        return Buffer.from(t.data, "hex");
      })
    ),
    height: tpl.height,
    bits: tpl.bits,
    coinbaseValue: tpl.coinbasevalue,
    previousblockhash: tpl.previousblockhash,
  };
};

/**
 * Serializes a getblocktemplate-mode aux block for submitblock:
 * header (80) | auxpow | tx count | coinbase | transactions.
 *
 * @param {Object} block - result of buildTemplateAuxBlock
 * @param {Buffer} auxPowBuffer - result of buildAuxPow
 * @returns {string} hex
 */
exports.serializeTemplateAuxBlock = function (block, auxPowBuffer) {
  return Buffer.concat([
    block.header,
    auxPowBuffer,
    util.varIntBuffer(block.txCount),
    block.coinbase,
    block.txData,
  ]).toString("hex");
};

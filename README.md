# High Performance SHA256 Stratum Pool Server

[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

High performance Stratum poolserver with enhanced SHA256 support in Node.js. One instance of this software can startup and manage multiple coin pools, each with their own daemon and stratum port :)

## 🚀 New Features in This Fork

### AsicBoost Support with Version Rolling

- **Full AsicBoost compatibility** for modern SHA256 ASIC miners
- **Version rolling** (BIP320) support for improved mining efficiency
- Automatic detection and negotiation of version rolling mask
- Compatible with all major ASIC manufacturers (Bitmain, MicroBT, Canaan, etc.)

### Solo Mining Mode

- Complete solo mining functionality
- Direct block rewards to miner addresses
- Real-time solo mining statistics

### Enhanced PROP Payout Mode

- **Fixed and properly implemented** proportional payout system
- Accurate share tracking and reward distribution
- Improved round management
- Fair distribution based on actual work contributed

### Hardening for Public Pools (v1.5.1)

- At most 10 `mining.authorize` requests per connection, then the connection is closed (each one costs a daemon `validateaddress` call)
- A non-string authorize password is treated as empty instead of throwing
- A blocknotify that arrives while the pool is still starting is skipped instead of throwing

### Merged Mining (AuxPoW) for Solo Miners (v1.5.0)

- Namecoin-style merged mining: solo miners mine one or more aux coins on the same work as the parent coin
- Aux coins defined once, grouped, and enabled per port (`auxGroup`); pool-mode miners keep plain parent jobs
- Several Namecoin-standard coins share one merged-mining tree; coins with a different byte order or slot rule (e.g. ESF) run in a group of their own
- `getblocktemplate` aux mode for nodes without aux-block RPCs (e.g. VargaMesh): the pool builds the aux block itself and submits it with `submitblock`
- Miner payout addresses per aux coin in the password (e.g. `m=solo,s256=<address>`), checked with the coin's daemon at login
- Works with AsicBoost version rolling: the auxpow carries the parent header with the rolled version

---

## Notice

This is a module for Node.js that will do nothing on its own. Unless you're a Node.js developer who would like to handle stratum authentication and raw share data then this module will not be of use to you. For a full featured portal that uses this module, see [sha256-nomp](https://github.com/janos-raul/sha256-nomp) (based on [s-nomp](https://github.com/s-nomp/s-nomp)). It handles payments, website front-end, database layer, mutli-coin/pool support, auto-switching miners between coins/pools, etc.. The portal also has an [MPOS](https://github.com/MPOS/php-mpos) compatibility mode so that the it can function as a drop-in-replacement for [python-stratum-mining](https://github.com/Crypto-Expert/stratum-mining).

[![NPM](https://nodei.co/npm/stratum-pool.png?downloads=true&stars=true)](https://nodei.co/npm/stratum-pool/)

## Why

This server was built to be more efficient and easier to setup, maintain and scale than existing stratum poolservers which are written in python. Compared to the spaghetti state of the latest [stratum-mining python server](https://github.com/Crypto-Expert/stratum-mining/), this software should also have a lower barrier to entry for other developers to fork and add features or fix bugs.

## Features

### Core Features

- Daemon RPC interface
- Stratum TCP socket server
- Block template / job manager
- P2P to get block notifications as peer node
- Optimized generation transaction building
- Connecting to multiple daemons for redundancy
- Process share submissions
- Session managing for purging DDoS/flood initiated zombie workers
- Auto ban IPs that are flooding with invalid shares
- **POW** (proof-of-work) & **POS** (proof-of-stake) support
- Transaction messages support
- Vardiff (variable difficulty / share limiter)
- When started with a coin daemon that hasn't finished syncing to the network it shows the blockchain download progress and initializes once synced

### Enhanced SHA256 Features (New)

- ✓ **AsicBoost Support** - Overt AsicBoost with version rolling
- ✓ **Version Rolling (BIP320)** - Efficient nonce space distribution
- ✓ **Multi-Version Support** - `mining.multi_version` extension for overt AsicBoost
- ✓ **Solo Mining Mode** - Direct mining without pool shares
- ✓ **Proper PROP Implementation** - Fair proportional reward distribution
- ✓ **Advanced Security Module** - Comprehensive DDoS protection and rate limiting
- ✓ **Merged Mining (AuxPoW)** - Solo miners merge-mine Namecoin-standard, ESF-style and getblocktemplate-mode (VargaMesh) aux coins

### Hashing Algorithms Supported

- ✓ **SHA256** (Bitcoin, Bitcoin Cash, etc.)
- ✓ **SHA256 with AsicBoost**

## Requirements

- node v24+ (see `.nvmrc`)
- coin daemon (preferably one with a relatively updated API)
- for merged mining: each aux coin's daemon with `createauxblock`/`getauxblock` and `submitauxblock`, or, in `getblocktemplate` mode, `getblocktemplate` (reporting `auxpow`) and `submitblock`

## Installation

### Install as a node module by cloning repository

```bash
git clone https://github.com/janos-raul/node-stratum-pool.git node_modules/stratum-pool
npm update
```

## Configuration

### Basic Coin Configuration

```javascript
var myCoin = {
  "name": "bitcoin",
  "symbol": "BTC",
  "algorithm": "sha256",
  "reward": "POW",
  "asicboost": true,
  "versionMask": "0x3fffe000",
  "enforcePoolVersionMask": true,
  "versionRollingMinBits": 16,
  "asicboostMinDifficulty": 1000,
  "asicboostMaxClients": 1000,
  "multiVersion": {
    "enabled": true,
    "maxVersions": 4,
    "generationMode": "sequential"
  },
  "coinbasePayouts": {
    "enabled": false,
    "coinbaseOnly": false,
    "feeHandledInCoinbase": false
  },
  "txMessages": true,                   // Enables the pool signature OP_RETURN output
  "txMessageText": "",                  // Custom OP_RETURN text (max 255 bytes, truncated if longer);
                                         // falls back to a built-in default if left empty
  "segwit": true,
  "default_witness_commitment": true,   // Informational only — witness commitment is included
                                         // automatically whenever the daemon's GBT response provides
                                         // one; this flag is not read anywhere and does not gate it
  "blockTime": 300,                     // Used for luck (luckDays/luckHours/luckMinute) calculations
  "minConf": 101,                       // Informational/reference only — the value that actually
                                         // gates payouts is the pool config's paymentProcessing.minConf

"addressValidation": {
		"validateWorkerUsername": true,
		"addressPrefix": "bc1",
		"minLength": 30,
		"maxLength": 42
  },

"explorer": {
        "txURL": "https://bitcoinexplorer.org/tx/",
        "blockURL": "https://bitcoinexplorer.org/block/"
    },

"rpc": {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "bitcoinrpc",
            "password": "password"
  }
}
```

### Pool Configuration with New Features

```javascript
var Stratum = require('stratum-pool');

var pool = Stratum.createPool({
    // Basic settings
    "enabled": true,                     // Enable this pool
    "coin": "bitcoin.json",              // Reference to coin config file
    "asicboost": true,                   // Enable ASICBoost for this pool
    "blockIdentifier": "",               // Text embedded in the coinbase scriptSig, wrapped in slashes
                                          // (e.g. "mypool.com" -> "/mypool.com/"). Threaded per-coin all
                                          // the way through transaction building, so different coins in
                                          // the same process can safely use different values. Truncated
                                          // at 64 bytes to stay within the scriptSig's 100-byte consensus
                                          // limit. Falls back to a built-in default if left empty.

	  // ============================================================================
	  // SECURITY MODULE - Advanced DDoS Protection & Rate Limiting
	  // ============================================================================

	  "security": {
		"enabled": true,                    // Master switch for security features

		// Rate Limiting Configuration
		// Tracks and limits connection attempts, malformed messages, and floods per IP
		"rateLimit": {
		  "enabled": true,                  // Enable rate limiting
		  "window": 60000,                  // Time window in ms (60000 = 1 minute)
		  "maxConnections": 10,             // Max connections per IP per window
		  "maxMalformed": 3,                // Max malformed messages before ban
		  "maxFloods": 2                    // Max socket flood detections before ban
		},

		// Auto-Ban System Configuration
		// Progressive ban system with escalating durations based on strikes
		"ban": {
		  "enabled": true,                  // Enable automatic IP banning
		  "duration": 600000,               // Initial ban duration in ms (600000 = 10 minutes)
		  "maxStrikes": 3,                  // Number of strikes before permanent ban
		  "permanentDuration": 86400000     // Permanent ban duration in ms (86400000 = 24 hours)
		}
	  },

    // Pool wallet and fee addresses
    "address": "YOUR_POOL_WALLET_ADDRESS",    // Main pool payout address

    "rewardRecipients": {
        // IMPORTANT: This is a COINBASE-LEVEL split, deducted BEFORE poolFee/soloFee!
        // If you set this > 0, it reduces the block reward available for fee calculation
        // Example: 6.25 BTC block with 1.0% here = 0.0625 BTC to fee address at coinbase
        //          Remaining 6.1875 BTC is then split by poolFee/soloFee percentages
        // RECOMMENDED: Set to 0.0 and use poolFee/soloFee instead for simpler accounting
        "YOUR_FEE_ADDRESS": 0.0          // Coinbase reward split (0.0 = disabled, recommended)
    },

    // Payment processing configuration
    "paymentProcessing": {
        "txfee": 0.0004,                 // Transaction fee for payouts
        "minConf": 101,                  // Confirmations before payment (must match coin config)
        "enabled": true,                 // Enable automatic payments
        "soloMining": true,              // Enable solo mining mode
        "paymentMode": "prop",           // Payment mode: "prop" or "pplnt"
        "poolFee": 2.0,                  // Pool mining fee (2.0 = 2%) - applied AFTER rewardRecipients
        "soloFee": 2.0,                  // Solo mining fee (2.0 = 2%) - applied AFTER rewardRecipients
        "paymentInterval": 3600,         // Payment interval in seconds (3600 = 1 hour)
        "minimumPayment": 0.01,          // Minimum payout for pool miners
        "minimumPayment_solo": 0.01,     // Minimum payout for solo miners
        "maxBlocksPerPayment": 5,        // Maximum blocks to process per payment run

        // Payment daemon connection
        "daemon": {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "rpcuser",
            "password": "rpcpassword"
        }
    },

    // TLS/SSL configuration (optional)
    "tlsOptions": {
        "enabled": false,
        "serverKey": "",
        "serverCert": "",
        "ca": ""
    },

    // Mining ports configuration
    "ports": {
        "50212": {                       // Port number
            "diff": 25000,               // Starting difficulty
            "tls": false,                // Enable TLS for this port
            "soloMining": true,          // Allow solo mining on this port
            "varDiff": {                 // Variable difficulty settings
                "minDiff": 10000,        // Minimum difficulty
                "maxDiff": 500000,       // Maximum difficulty
                "targetTime": 30,        // Target time between shares (seconds)
                "retargetTime": 200,     // How often to adjust difficulty (seconds)
                "variancePercent": 5     // Allowed variance percentage
            }
        },
        "50213": {                       // Higher difficulty port for larger miners
            "diff": 50000,
            "tls": false,
            "soloMining": true,
            "varDiff": {
                "minDiff": 50000,
                "maxDiff": 5000000,
                "targetTime": 35,
                "retargetTime": 240,
                "variancePercent": 5
            }
        }
    },

    // Pool identifier for multi-region setups
    "poolId": "main",

    // Daemon instances for block submission and monitoring
    "daemons": [
        {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "rpcuser",
            "password": "rpcpassword"
        }
    ]
}, authorizeFn);
```

Any daemon entry may also set `"wallet": "<name>"`: RPCs then go to `/wallet/<name>`, which Bitcoin Core-based daemons require for wallet calls when more than one wallet is loaded (error -19).

### Event Handling with New Features

```javascript
// Share event
pool.on('share', function(isValidShare, isValidBlock, data) {
    /*
    data object includes:
        - job: the job ID this share was submitted against
        - ip: submitting miner's IP address
        - worker: full worker name (address.workername)
        - difficulty: the miner's currently assigned difficulty
        - isSoloMining: boolean, true if this worker is solo mining
        - isAsicBoost: boolean, true if the share used AsicBoost version rolling
        - version: the block version used for this share
        - error: present only when isValidShare is false
    */

            if (!isValidBlock)
                emitShare();
            else{
                SubmitBlock(blockHex, function(){

    console.log('Share data:', JSON.stringify(data));
});
```

### Merged Mining

Merged mining is off unless `mergedMining.enabled` is `true`. Aux coins are defined once in `auxCoins`, `groups` list the coins mined together, and a port opts in with `auxGroup`. Only **solo** miners on such a port get the group's job (a coinbase carrying the merged-mining tag); pool-mode miners and ports without `auxGroup` get the plain parent job.

```javascript
var pool = Stratum.createPool({
    // ...coin, address, daemons as usual
    ports: {
        3333: { diff: 65536, auxGroup: "standard" },
        3334: { diff: 65536, auxGroup: "esf" },
        3335: { diff: 65536 }                 // plain parent mining only
    },
    mergedMining: {
        enabled: true,
        auxPollInterval: 5000,               // ms between aux work polls (createauxblock / getauxblock / getblocktemplate)
        auxCoins: {
            sha256coin: {
                symbol: "S256",
                chainId: 598,
                byteOrder: "namecoin",       // default
                slotRule: "namecoin",        // default
                addressParam: "s256",        // miners pass s256=<address> in the password
                address: "<pool S256 address>",   // createauxblock payout
                daemon: { host: "127.0.0.1", port: 25332, user: "rpcuser", password: "rpcpass" }
            },
            esf: {
                symbol: "ESF",
                chainId: 1175,
                byteOrder: "reversed",       // tree root written byte-reversed
                slotRule: "modulo",          // slot = nonce % size
                addressParam: "esf",
                address: "<pool ESF address>",
                daemon: { host: "127.0.0.1", port: 25359, user: "rpcuser", password: "rpcpass" }
            },
            vargamesh: {
                symbol: "VMESH",
                chainId: 22093,              // 0x564D
                mode: "getblocktemplate",    // no aux-block RPCs: the pool builds the block
                addressParam: "vmesh",
                address: "<pool VMESH address>",  // paid by the aux block's coinbase
                daemon: { host: "127.0.0.1", port: 29667, user: "rpcuser", password: "rpcpass" }
            }
        },
        groups: {
            standard: ["sha256coin", "vargamesh"],  // Namecoin-standard coins may share a group
            esf: ["esf"]                     // non-standard coins must be alone
        }
    }
}, authorizeFn);
```

How it works:

- Each aux coin used by a port gets its own daemon connection and is polled with `createauxblock <address>` (or `getauxblock <address>` for coins without `createauxblock`, such as ESF). New aux work rebuilds only the jobs of the groups containing that coin. When the aux chain has a new block (`previousblockhash` changed) the jobs go out with `clean_jobs=true`, since work on the old block can no longer win it; a refresh on the same block (new transactions) is sent with `clean_jobs=false`. Nodes that return a new hash on every call for the same block (ESF) are refreshed on a new block or once a minute.
- `mode: "getblocktemplate"` is for aux nodes without aux-block RPCs (VargaMesh). The pool polls `getblocktemplate`, requires `auxpow: true` and the configured chain ID, and builds the aux block itself: a coinbase paying the whole `coinbasevalue` to `address` (the script comes from the node's `validateaddress`) plus the witness commitment, the template's transactions, its version (already carrying the AuxPoW flag) and `auxpow_childnonce` as the nonce. The block is rebuilt on a new tip, or every 30 s for new transactions. A hit is submitted with `submitblock` as header + auxpow + transactions.
- A group's coins sit in one merged-mining tree at their Namecoin slots. Two coins collide exactly when their chain IDs are equal modulo the tree size, so the pool picks the smallest tree (up to 4096 slots) where they differ and uses merkle nonce 0.
- Every share on a group job is checked against each aux coin's target before the pool's own difficulty check, and a hit is submitted with `submitauxblock` in Namecoin's auxpow format (with `hashBlock`, coinbase index 0, the coin's chain branch, and the parent header including the rolled AsicBoost version).
- A share that meets an aux target on work for an aux block that is no longer the tip is logged as stale and not submitted (the node would only answer "inconclusive").
- A miner's aux addresses (`s256=`, `esf=`, … from each coin's `addressParam`) are checked with that coin's `validateaddress` at login; an invalid address refuses the login, an unreachable daemon accepts it with a warning.

The pool refuses to start if the config is inconsistent: an `auxGroup` not in `groups`, an unknown coin, duplicate chain IDs or `addressParam`s, a non-standard coin sharing a group, chain IDs that collide at every tree size, or a coinbase scriptSig that could exceed 100 bytes (`blockIdentifier` is capped at 30 bytes when a port merge-mines).

```javascript
pool.on('auxBlock', function(accepted, data) {
    /*
    data: coin, symbol, auxHash, auxHeight, auxCoinbaseValue, txHash (aux coinbase txid when accepted),
          worker, isSoloMining, auxAddress (the miner's address for this coin, or null),
          parentHash, parentHeight, shareDiff, error (when rejected)
    */
});
```

Paying the miner is up to the portal: [sha256-nomp](https://github.com/janos-raul/sha256-nomp) records accepted blocks with an `auxAddress` as solo blocks of the aux coin, so that coin's own payment processor pays the finder.

## Usage Examples

### Basic SHA256 Pool with AsicBoost

```javascript
var bitcoin = {
  name: "bitcoin",
  symbol: "BTC",
  algorithm: "sha256",
  reward: "POW",
  asicboost: true,
  versionMask: "0x3fffe000",
  enforcePoolVersionMask: true,
  versionRollingMinBits: 16,
  asicboostMinDifficulty: 1000,
  asicboostMaxClients: 1000,
  multiVersion: {
    enabled: true,
    maxVersions: 4,
    generationMode: "sequential",
  },
  coinbasePayouts: {
    enabled: false,
    coinbaseOnly: false,
    feeHandledInCoinbase: false,
  },
  txMessages: true, // Enables the pool signature OP_RETURN output
  txMessageText: "", // Custom OP_RETURN text (max 255 bytes); falls back to a
  // built-in default if left empty
  segwit: true,
  default_witness_commitment: true, // Informational only — included automatically whenever the
  // daemon's GBT response provides one, not gated by this flag
  blockTime: 300, // Used for luck calculations
  minConf: 101, // Informational only — real gate is paymentProcessing.minConf
};

// Create pool with AsicBoost enabled
var pool = Stratum.createPool({
  coin: bitcoin,
  address: "bc1qpool...",
  asicboost: true,
  // ... other configuration
});
```

### Solo Mining Setup

```javascript
// Configure solo mining port, solo mining detection is based on user password "m=solo"
"ports": {
    "3334": {
        "diff": 8192,
        "soloMining": true,
        "varDiff": {
            "minDiff": 8192,
            "maxDiff": 1048576,
            "targetTime": 30,
            "retargetTime": 200,
            "variancePercent": 5
        }
    }
}
```

## Stratum Extensions

This implementation supports the following stratum extensions:

- `mining.subscribe` with version rolling support
- `mining.configure` for AsicBoost negotiation
- `mining.multi_version` for overt AsicBoost with multiple versions
- `mining.suggest_difficulty` — miner-requested starting difficulty, honored alongside the pool's own per-port default
- `mining.submit` with version bits

### mining.multi_version Support

The `mining.multi_version` extension allows miners to request multiple block versions simultaneously, enabling overt AsicBoost mining. This is an alternative to `mining.configure` version rolling.

#### How it works:

1. Miner sends: `{"method": "mining.multi_version", "params": [4]}`
2. Pool responds with `result: true` if enabled
3. Pool sends jobs with multiple versions in `mining.notify`
4. Miner can use any of the provided versions for share submission

#### Coin Configuration:

```javascript
{
  "name": "bitcoin",
  "symbol": "BTC",
  "algorithm": "sha256",
  // ... other config ...

  "multiVersion": {
    "enabled": true,        // Enable mining.multi_version support
    "maxVersions": 4,       // Maximum versions a miner can request (1-16)
    "mode": "sequential"    // Version generation mode: "sequential"
  }
}
```

#### Configuration Options:

| Option        | Type    | Default      | Description                                    |
| ------------- | ------- | ------------ | ---------------------------------------------- |
| `enabled`     | boolean | false        | Enable/disable multi_version support           |
| `maxVersions` | number  | 4            | Maximum number of versions a miner can request |
| `mode`        | string  | "sequential" | How versions are generated ("sequential")      |

#### Miner Compatibility:

Miners supporting `mining.multi_version`:

- Custom firmware with multi_version support
- Some Bitmain firmware variants
- Mining proxies with multi_version capability

## Testing

Test your AsicBoost implementation:

```bash
# Test with bfgminer
bfgminer -o stratum+tcp://localhost:3333 -u walletaddress -p x --version-rolling

# Test with cgminer
cgminer -o stratum+tcp://localhost:3333 -u walletaddress -p x
```

## Performance Optimizations

- AsicBoost reduces power consumption by ~20%
- Version rolling improves efficiency for high-hashrate miners
- Optimized share validation for SHA256
- Efficient job distribution for large mining farms

## Security Features

### Advanced Security Module

The stratum pool includes a comprehensive security system designed to protect against various attacks:

#### Features:

- **Rate Limiting**: Tracks connections, malformed messages, and socket floods per IP
- **Progressive Ban System**: Escalating ban durations based on strike count
- **Automatic Cleanup**: Expired bans and old tracking data are automatically purged
- **Real-time Monitoring**: Events and statistics for all security actions
- **Memory Efficient**: Designed to handle high-traffic scenarios without memory leaks

#### Protection Against:

- **Connection Flooding**: Limits rapid connection attempts from single IPs
- **Malformed Messages**: Detects and bans clients sending invalid stratum messages
- **Socket Flooding**: Protects against buffer overflow attacks
- **Share Spam**: Works with existing share-based banning system
- **Repeated Offenders**: Progressive bans become longer with each strike

#### How the Ban System Works:

1. **First Offense**: 10-minute ban (1x duration)
2. **Second Offense**: 20-minute ban (2x duration)
3. **Third Offense**: 24-hour "permanent" ban
4. **Automatic Expiration**: All bans expire automatically after their duration
5. **Cleanup**: Old tracking data is purged every 5 minutes to prevent memory bloat

#### Important Notes:

**WSL2 Users**:
If running your pool in WSL2, be aware that all connections appear to come from the same internal NAT IP (typically `172.x.x.x`). This means:

- Banning an attacker would ban ALL miners
- You should set `"enabled": false` for development
- For production, deploy on native Linux or use HAProxy with PROXY protocol

**TLS and HTTP on a plain stratum port**:
A connection whose first bytes are a TLS handshake (a miner or rental service trying `stratum+ssl`) or an HTTP request (a browser, a port checker) is closed without counting a malformed-message strike, so services that try TLS first are not banned. HTTP clients get a short `400` reply pointing to `stratum+tcp://`. The per-IP connection rate limit still applies.

**TCP Proxy Protocol**:
If using HAProxy or nginx with PROXY protocol:

1. Set `"tcpProxyProtocol": true` in your pool config
2. Configure your load balancer to send PROXY headers
3. The pool will extract real client IPs from PROXY headers

**Production Deployment**:
For maximum security in production:

- Enable the security module with conservative thresholds
- Monitor security statistics regularly
- Use external DDoS protection (Cloudflare, AWS Shield, etc.)
- Deploy on native Linux for accurate IP tracking
- Consider multiple security layers (firewall + pool security)

#### Implementation Details:

The security module is implemented in `lib/security.js` and integrates with:

- **Connection Handler**: Checks for bans on new connections
- **Stratum Protocol**: Validates all incoming messages
- **Socket Layer**: Monitors buffer sizes and data rates
- **Pool Manager**: Coordinates bans across multiple coin pools

All security tracking is in-memory for performance, with automatic cleanup every 5 minutes to prevent memory growth.

---

<div align="center">

## Maintained By

### **janos-raul**

#### Developer & Maintainer

[![Website](https://img.shields.io/badge/Pool-sha256--mining.go.ro-blue?style=for-the-badge)](https://sha256-mining.go.ro:50300)

_Building high-performance SHA256 mining infrastructure_

</div>

---

## Credits

- Original stratum-pool developers
- [vekexasia](//github.com/vekexasia) - co-developer & great tester
- [LucasJones](//github.com/LucasJones) - got p2p block notify working
- [TheSeven](//github.com/TheSeven) - technical guidance
- SHA256-NOMP Contributors - AsicBoost, solo mining, and PROP implementation

## Donations

To support continued development:

- BTC: `bc1q0aa3k39ww33z24p3wpk72jjn32h2n5rfr85pnx`
- BTCS: `bs1q8dnz4q52czdusl8hy04fw3jryj2kc3earck3y2`
- BCH: `qzhpajyfz7yvl8963rre5zqdp72pqy47ysttst0wmr`

## License

Released under the GNU General Public License v2

http://www.gnu.org/licenses/gpl-2.0.html

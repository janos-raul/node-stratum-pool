# Configuration

The coin object and the `createPool` options, with the events the pool emits. Back to the [README](../README.md).

## Basic Coin Configuration

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

## Pool Configuration with New Features

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

## Event Handling with New Features

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

    console.log('Share data:', JSON.stringify(data));
});
```

## Solo Mining Setup

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

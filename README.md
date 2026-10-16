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

### Merged Mining (AuxPoW) for Solo Miners

- Solo miners merge-mine one or more aux coins on the same work as the parent coin: Namecoin-standard coins in a shared tree, ESF-style coins in their own group, and `getblocktemplate`-mode coins (VargaMesh) without aux-block RPCs
- Aux payout addresses per coin in the password (e.g. `m=solo,s256=<address>`); an aux node's blocknotify updates merged miners at once
- See [Merged Mining](guides/merged-mining.md)

### What's New

Latest release: **v1.5.4**. Release notes are in the [Changelog](CHANGELOG.md).

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
- ✓ **Multi-Version Support** - `mining.multi_version` extension for overt AsicBoost ([Stratum Extensions](guides/stratum-extensions.md))
- ✓ **Solo Mining Mode** - Direct mining without pool shares
- ✓ **Proper PROP Implementation** - Fair proportional reward distribution
- ✓ **Advanced Security Module** - Comprehensive DDoS protection and rate limiting ([Security](guides/security.md))
- ✓ **Merged Mining (AuxPoW)** - Solo miners merge-mine Namecoin-standard, ESF-style and getblocktemplate-mode (VargaMesh) aux coins ([Merged Mining](guides/merged-mining.md))

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

## Quick Start

Every option of the coin object and `createPool` is explained in the [Configuration](guides/configuration.md) guide.

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

## Guides

- [Configuration](guides/configuration.md) - coin object, `createPool` options (security, payments, ports, daemons), events, solo mining ports
- [Merged Mining](guides/merged-mining.md) - aux coins, groups, `getblocktemplate` mode, aux blocknotify, the `auxBlock` event
- [Stratum Extensions](guides/stratum-extensions.md) - `mining.configure`, `mining.multi_version`, `mining.suggest_difficulty`
- [Security](guides/security.md) - rate limiting, progressive bans, WSL2 / proxy notes
- [Changelog](CHANGELOG.md) - release notes

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

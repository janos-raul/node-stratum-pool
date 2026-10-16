# Merged Mining

Solo miners merge-mine aux coins (AuxPoW) on the parent coin's work. Back to the [README](../README.md).

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
        auxPollInterval: 5000,               // ms between aux work polls (createauxblock / getauxblock / getblocktemplate); a blocknotify from the aux node (processAuxBlockNotify) polls at once
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

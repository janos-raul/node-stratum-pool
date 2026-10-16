# Changelog

All notable changes to this stratum-pool fork, newest first. [sha256-nomp](https://github.com/janos-raul/sha256-nomp) pins a release by tag.

## v1.5.5

### Added

- **Per-connection share counts.** Each stratum client has `connectedAt` and `shareStats` (`accepted`, `stale`, `rejected`) for the shares since the connection opened. Stale = "job not found" (sent on a job that ended with a new block); rejected = every other refused share, including malformed submits. The portal shows them per worker. `client.shares` stays the banning counter (it is reset)
- **Instant aux tip updates (blocknotify for aux coins).** `pool.processAuxBlockNotify(coin, blockHash)`: a blocknotify from an aux coin's node makes every parent pool that merge-mines the coin fetch the new aux work at once (`getblocktemplate` or `createauxblock`/`getauxblock`), and miners get it with `clean_jobs=true`. Before, parent pools saw a new aux tip only at their next aux poll (`auxPollInterval`, 5 s), so miners hashed up to 5 s on the old tip and any aux block found then was orphaned ("inconclusive"). `auxPollInterval` stays as the fallback. The call returns false for coins the pool does not merge-mine, and skips tips the pool already works on

## v1.5.4

### Changed

- Leaner logs: each pool message is written once. When the portal listens for `log` events it logs them itself (with coin and thread), so the internal logger is only a fallback; the component is kept as a `[Component] ` prefix in the text
- Routine lines that every cluster thread repeats (job rebroadcasts, new aux blocks, block notifications) are logged by the first thread only

## v1.5.3

### Fixed

- Fresh block times with merged mining: aux chain updates no longer restart the job rebroadcast timer. A merge-mined aux chain that changes more often than `jobRebroadcastTimeout` used to postpone the parent's template refresh until the next parent block, so parent blocks carried the previous block's time (`curtime`). The template is now refreshed every `jobRebroadcastTimeout` seconds as intended

## v1.5.2

### Fixed

- Startup recovery: the pool no longer gives up when a daemon is not ready at startup (RPC not up yet, "Loading block index", or no peers yet: `getblocktemplate` "not connected"). The daemon check, the init RPCs and the first job are retried (10s, 20s, ... then once a minute) and the stratum ports open as soon as a block template is available. After a power cut, coins whose daemons need a while to find peers used to stay offline until a manual restart
- An invalid pool address still stops the coin (configuration error)

## v1.5.1

### Security

Hardening for public pools:

- At most 10 `mining.authorize` requests per connection, then the connection is closed (each one costs a daemon `validateaddress` call)
- A non-string authorize password is treated as empty instead of throwing
- A blocknotify that arrives while the pool is still starting is skipped instead of throwing

## v1.5.0

### Added

Merged mining (AuxPoW) for solo miners, see [Merged Mining](guides/merged-mining.md):

- Namecoin-style merged mining: solo miners mine one or more aux coins on the same work as the parent coin
- Aux coins defined once, grouped, and enabled per port (`auxGroup`); pool-mode miners keep plain parent jobs
- Several Namecoin-standard coins share one merged-mining tree; coins with a different byte order or slot rule (e.g. ESF) run in a group of their own
- `getblocktemplate` aux mode for nodes without aux-block RPCs (e.g. VargaMesh): the pool builds the aux block itself and submits it with `submitblock`
- Miner payout addresses per aux coin in the password (e.g. `m=solo,s256=<address>`), checked with the coin's daemon at login
- Works with AsicBoost version rolling: the auxpow carries the parent header with the rolled version

## 1.44 and earlier

No per-version notes. The fork's features from this period are listed in the [README](README.md#-new-features-in-this-fork): AsicBoost with version rolling, `mining.multi_version`, solo mining mode, the fixed PROP payout mode and the security module.

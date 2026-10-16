# Stratum Extensions

Back to the [README](../README.md).

This implementation supports the following stratum extensions:

- `mining.subscribe` with version rolling support
- `mining.configure` for AsicBoost negotiation
- `mining.multi_version` for overt AsicBoost with multiple versions
- `mining.suggest_difficulty` — miner-requested starting difficulty, honored alongside the pool's own per-port default
- `mining.submit` with version bits

## mining.multi_version Support

The `mining.multi_version` extension allows miners to request multiple block versions simultaneously, enabling overt AsicBoost mining. This is an alternative to `mining.configure` version rolling.

### How it works:

1. Miner sends: `{"method": "mining.multi_version", "params": [4]}`
2. Pool responds with `result: true` if enabled
3. Pool sends jobs with multiple versions in `mining.notify`
4. Miner can use any of the provided versions for share submission

### Coin Configuration:

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

### Configuration Options:

| Option        | Type    | Default      | Description                                    |
| ------------- | ------- | ------------ | ---------------------------------------------- |
| `enabled`     | boolean | false        | Enable/disable multi_version support           |
| `maxVersions` | number  | 4            | Maximum number of versions a miner can request |
| `mode`        | string  | "sequential" | How versions are generated ("sequential")      |

### Miner Compatibility:

Miners supporting `mining.multi_version`:

- Custom firmware with multi_version support
- Some Bitmain firmware variants
- Mining proxies with multi_version capability

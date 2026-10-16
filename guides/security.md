# Security

Back to the [README](../README.md).

## Advanced Security Module

The stratum pool includes a comprehensive security system designed to protect against various attacks:

### Features:

- **Rate Limiting**: Tracks connections, malformed messages, and socket floods per IP
- **Progressive Ban System**: Escalating ban durations based on strike count
- **Automatic Cleanup**: Expired bans and old tracking data are automatically purged
- **Real-time Monitoring**: Events and statistics for all security actions
- **Memory Efficient**: Designed to handle high-traffic scenarios without memory leaks

### Protection Against:

- **Connection Flooding**: Limits rapid connection attempts from single IPs
- **Malformed Messages**: Detects and bans clients sending invalid stratum messages
- **Socket Flooding**: Protects against buffer overflow attacks
- **Share Spam**: Works with existing share-based banning system
- **Repeated Offenders**: Progressive bans become longer with each strike

### How the Ban System Works:

1. **First Offense**: 10-minute ban (1x duration)
2. **Second Offense**: 20-minute ban (2x duration)
3. **Third Offense**: 24-hour "permanent" ban
4. **Automatic Expiration**: All bans expire automatically after their duration
5. **Cleanup**: Old tracking data is purged every 5 minutes to prevent memory bloat

### Important Notes:

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

### Implementation Details:

The security module is implemented in `lib/security.js` and integrates with:

- **Connection Handler**: Checks for bans on new connections
- **Stratum Protocol**: Validates all incoming messages
- **Socket Layer**: Monitors buffer sizes and data rates
- **Pool Manager**: Coordinates bans across multiple coin pools

All security tracking is in-memory for performance, with automatic cleanup every 5 minutes to prevent memory growth.

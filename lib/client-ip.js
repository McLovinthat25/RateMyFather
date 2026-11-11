// Server-determined client IP (audit F-07, Iteration 2).
//
// The abuse token and every per-IP rate limiter must be keyed on an IP
// the server itself determined, never on a client-supplied header value.
// The old code hashed the FIRST X-Forwarded-For entry, which is the
// value the client itself supplied, so rotating it defeated every
// token-keyed control at once.
//
// Proxy chain in production:
//   visitor -> Cloudflare -> Render load balancer -> app
// Each proxy appends the IP it saw to X-Forwarded-For, so the entries
// the app sees are:
//   [ <client-forged entries...>, <real client IP>, <Cloudflare edge IP> ]
// on the custom domain, and
//   [ <client-forged entries...>, <real client IP> ]
// on the direct onrender.com domain (Render appends the real client IP).
// The real client IP is therefore the entry the LAST proxy appended,
// i.e. the LAST entry — unless the last entry is a Cloudflare edge IP,
// in which case Cloudflare appended the client IP and Render appended
// the edge IP, so the real client is the SECOND-TO-LAST entry. Entries
// to the left of that are attacker-forgeable and must never be used.
// (Express's req.ip with `trust proxy, 1` resolves to the last entry,
// i.e. the Cloudflare edge IP on the custom domain, so it cannot be
// used as the client IP either.)
//
// Cloudflare edge ranges are hardcoded below, fetched from
// https://www.cloudflare.com/ips (ips-v4 and ips-v6) on 2026-11-11.
// Cloudflare publishes new ranges rarely, but they DO change: refresh
// this list whenever Cloudflare announces a change, and re-check it at
// least once a year. If a new edge range is missing here, visitors
// behind that edge get the edge IP as their "client" IP instead of
// their own — the abuse token and rate limits would then be shared
// across everyone behind that edge (fail-closed direction for abuse,
// but legitimate visitors could trip each other's limits). A stale
// range that Cloudflare no longer uses is harmless: it only ever
// matches an IP that is no longer an edge IP, and the fallback is the
// last XFF entry, which is still the last proxy's append.

const net = require('net');

// Cloudflare IPv4 ranges, https://www.cloudflare.com/ips-v4/ (2026-11-11).
const CF_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

// Cloudflare IPv6 ranges, https://www.cloudflare.com/ips-v6/ (2026-11-11).
const CF_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseCidrV4(cidr) {
  const [addr, prefix] = cidr.split('/');
  const base = ipv4ToInt(addr);
  const bits = Number(prefix);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: base & mask, mask };
}

const CF_V4_PARSED = CF_V4.map(parseCidrV4).filter(Boolean);

// Expand an IPv6 address to 8 groups of 16 bits. Handles '::' compression
// and embedded IPv4 (e.g. ::ffff:1.2.3.4). Returns null if unparseable.
function ipv6Groups(ip) {
  let head = ip;
  let tail = '';
  const dbl = ip.indexOf('::');
  if (dbl !== -1) {
    head = ip.slice(0, dbl);
    tail = ip.slice(dbl + 2);
  }
  const parsePart = (s) => {
    if (!s) return [];
    const out = [];
    for (const piece of s.split(':')) {
      if (piece.includes('.')) {
        const v4 = ipv4ToInt(piece);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const h = parsePart(head);
  const t = parsePart(tail);
  if (h === null || t === null) return null;
  if (dbl === -1) {
    if (h.length !== 8) return null;
    return h;
  }
  const missing = 8 - h.length - t.length;
  if (missing < 0) return null;
  return [...h, ...Array(missing).fill(0), ...t];
}

function parseCidrV6(cidr) {
  const [addr, prefix] = cidr.split('/');
  const groups = ipv6Groups(addr);
  const bits = Number(prefix);
  if (!groups || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  return { groups, bits };
}

const CF_V6_PARSED = CF_V6.map(parseCidrV6).filter(Boolean);

function isCloudflareIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const ver = net.isIP(ip);
  if (ver === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return false;
    return CF_V4_PARSED.some(({ base, mask }) => (n & mask) === base);
  }
  if (ver === 6) {
    const groups = ipv6Groups(ip);
    if (!groups) return false;
    return CF_V6_PARSED.some(({ groups: base, bits }) => {
      let remaining = bits;
      for (let i = 0; i < 8 && remaining > 0; i++) {
        const take = Math.min(16, remaining);
        const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
        if ((groups[i] & mask) !== (base[i] & mask)) return false;
        remaining -= take;
      }
      return true;
    });
  }
  return false;
}

// The server-determined client IP for a request. See the header comment
// for the chain reasoning. Never returns a client-forged XFF entry:
// only the last entry (or second-to-last when the last is a Cloudflare
// edge IP) is trusted, because only those were appended by a proxy.
// Falls back to req.ip / the socket address when there is no usable
// X-Forwarded-For header at all.
function realClientIp(req) {
  const xff = String((req.headers && req.headers['x-forwarded-for']) || '');
  const entries = xff.split(',').map((s) => s.trim()).filter(Boolean)
    .filter((e) => net.isIP(e) !== 0);
  if (entries.length) {
    const last = entries[entries.length - 1];
    if (isCloudflareIp(last) && entries.length >= 2) return entries[entries.length - 2];
    return last;
  }
  return (req && req.ip) || (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { realClientIp, isCloudflareIp, ipv6Groups };

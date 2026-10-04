export interface TargetCheck { ok: boolean; reason: string; url?: URL }

function ipv4Private(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 0 && h === "0.0.0.0");
}

function ipv6Private(h: string): boolean {
  if (!h.startsWith("[") || !h.endsWith("]")) return false;
  const ip = h.slice(1, -1).toLowerCase();
  if (ip === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return ipv4Private(mapped[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex) {
    const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
    return ipv4Private([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }
  return /^f[cd][0-9a-f]{0,2}:/.test(ip) || /^fe[89ab][0-9a-f]?:/.test(ip);
}

/** Allow only loopback / private-network http(s) targets. WHATWG URL normalizes numeric hosts (0x7f000001 → 127.0.0.1). */
export function isAllowedTarget(raw: string, opts: { iOwnThis?: boolean } = {}): TargetCheck {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: `not a valid URL: ${raw}` }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: `unsupported protocol ${url.protocol}`, url };
  if (opts.iOwnThis) return { ok: true, reason: "allowed by --i-own-this / iOwnThis", url };
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return { ok: true, reason: "localhost", url };
  if (ipv4Private(h) || ipv6Private(h)) return { ok: true, reason: "loopback/private address", url };
  return { ok: false, reason: `${h} is not localhost or a private address; pass --i-own-this (or set iOwnThis in .wreck-it/config.json) only for targets you own`, url };
}

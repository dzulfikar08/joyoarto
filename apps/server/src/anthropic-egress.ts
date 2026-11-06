/** Anthropic's published egress range for MCP connectors (https://platform.claude.com/docs/en/api/ip-addresses). */
const ANTHROPIC_EGRESS = { base: (160 << 24) | (79 << 16) | (104 << 8), bits: 21 };

export function isAnthropicEgress(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  const value = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  const mask = (~0 << (32 - ANTHROPIC_EGRESS.bits)) >>> 0;
  return ((value & mask) >>> 0) === ((ANTHROPIC_EGRESS.base & mask) >>> 0);
}

/**
 * Bridge listen-address resolution.
 *
 * The bridge is configured with a literal IP so the operator controls exactly
 * which interface it is exposed on. A DHCP lease change silently invalidates
 * that choice: the address disappears from the host, the old socket lingers on
 * a dead address, and nothing on the LAN can reach the bridge any more —
 * while `bridge status` keeps reporting `enabled: true`.
 *
 * This module answers two questions without any I/O:
 *   1. is the configured address still present on this host?
 *   2. if not, is there an address that is obviously the same intent?
 *
 * "Same intent" is deliberately narrow. A DHCP lease change moves the host
 * inside its own subnet, so only a non-internal address of the same family in
 * the same subnet (IPv4 /24, IPv6 /64) is adopted. An address on a different
 * network — a VPN, a second NIC, a public interface — is never adopted
 * automatically, because that would expose the bridge somewhere the operator
 * did not choose. Loopback is never adopted either: it would silently take the
 * bridge off the LAN while still looking healthy.
 */

import { isIP } from 'node:net';

/** Wildcards already bind every interface, so they are never "absent". */
const WILDCARDS = new Set(['0.0.0.0', '::']);

export const BRIDGE_LISTEN_STATES = Object.freeze([
  'present', 'rebindable', 'absent', 'unconfigured',
]);

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Flatten `os.networkInterfaces()` into the addresses a bridge may bind.
 * Internal (loopback) addresses are kept but marked, so callers can exclude
 * them from adoption while still recognising an explicitly configured one.
 */
export function bridgeHostAddresses(interfaces = {}) {
  const result = [];
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      const address = normalize(entry?.address);
      if (address === '' || isIP(address) === 0) continue;
      result.push({ address, family: isIP(address), internal: entry?.internal === true });
    }
  }
  return result.sort((left, right) => (left.address < right.address ? -1
    : left.address > right.address ? 1 : 0));
}

/** IPv4 /24 or IPv6 /64 prefix, used as the "same network" test. */
function subnetKey(address) {
  const family = isIP(address);
  if (family === 4) return address.split('.').slice(0, 3).join('.');
  if (family !== 6) return null;
  // Expand the IPv6 form enough to compare the first four hextets.
  const [head] = address.split('%');
  const parts = head.split('::');
  const left = parts[0] === '' ? [] : parts[0].split(':');
  const right = parts.length > 1 ? (parts[1] === '' ? [] : parts[1].split(':')) : [];
  const fill = Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0');
  const hextets = (parts.length > 1 ? [...left, ...fill, ...right] : left)
    .map((entry) => entry.replace(/^0+(?=[0-9a-f])/u, ''));
  return hextets.slice(0, 4).join(':');
}

/**
 * Decide which address the bridge should actually listen on.
 *
 * @param {object} options
 * @param {string|null} options.configured configured literal address.
 * @param {object} [options.interfaces] `os.networkInterfaces()` shaped object.
 * @returns {{state: string, effective: string|null, configured: string|null,
 *   candidates: string[], reason: string|null}}
 */
export function resolveBridgeListenAddress({ configured, interfaces = {} } = {}) {
  const wanted = normalize(configured);
  if (wanted === '' || isIP(wanted) === 0) {
    return { state: 'unconfigured', effective: null, configured: null, candidates: [], reason: 'listen_address_unconfigured' };
  }
  if (WILDCARDS.has(wanted)) {
    return { state: 'present', effective: wanted, configured: wanted, candidates: [], reason: null };
  }

  const addresses = bridgeHostAddresses(interfaces);
  if (addresses.some((entry) => entry.address === wanted)) {
    return { state: 'present', effective: wanted, configured: wanted, candidates: [], reason: null };
  }

  const family = isIP(wanted);
  const wantedSubnet = subnetKey(wanted);
  const candidates = addresses
    .filter((entry) => !entry.internal && entry.family === family
      && wantedSubnet !== null && subnetKey(entry.address) === wantedSubnet)
    .map((entry) => entry.address);

  if (candidates.length === 0) {
    return { state: 'absent', effective: null, configured: wanted, candidates: [],
      reason: 'configured_address_absent_from_host' };
  }
  // Deterministic pick; `candidates` is reported so an ambiguous host is visible.
  return { state: 'rebindable', effective: candidates[0], configured: wanted, candidates,
    reason: 'configured_address_absent_rebound_within_subnet' };
}

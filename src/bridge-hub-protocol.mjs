/**
 * Bridge hub registration protocol — the wire contract between a terminal's
 * `lattice bridge` and the hub that aggregates them for the public dashboard.
 *
 * This module owns validation and pure registry mutation only. It does not open
 * a socket, read a clock, or touch disk — that belongs to the hub server (bh2)
 * and the terminal heartbeat client (bh3). Keeping the contract pure lets it be
 * characterization-tested before either side exists, and keeps bh2/bh3 from
 * inventing their own conflict or staleness rules.
 *
 * Design decisions this module encodes (see docs/adr/0162 for the full record):
 *
 * - The registry is keyed by `project_id`, not `terminal_id`, because hub routes
 *   `/projects/<id>/*` by project. A terminal that owns several projects appears
 *   as several entries sharing the same terminal_id/address/port.
 * - The request never carries an address. The caller passes the address the
 *   registration connection actually arrived from (`remoteAddress`); a terminal
 *   can only ever register itself, the same safety property bridge-registrar.mjs
 *   already relies on for the ssh-based upstream registrar.
 * - A registration call declares a terminal's *complete* current project
 *   portfolio and replaces that terminal's prior contribution wholesale. A
 *   project the terminal owned before but omits now is released — there is no
 *   separate "deregister" verb, and no partial application: a heartbeat either
 *   lands in full or is rejected in full.
 * - A project_id already owned by a *different* terminal is a conflict unless
 *   named in `adopt`. Conflicts are collected and reported together — a batch
 *   never partially lands, so a caller is never left unsure which half won.
 * - Staleness is read-time only. `projectBridgeHubRegistry` marks an entry
 *   'offline' once `last_seen_at` exceeds the TTL; it never deletes the entry.
 *   The plan's fail-closed requirement is "show offline", not "make it vanish".
 */

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_PROJECT_IDS = 256;

/** Suggested terminal heartbeat cadence. Not part of the wire contract — the hub
 * owns both constants and can retune them without a protocol version bump. */
export const BRIDGE_HUB_HEARTBEAT_INTERVAL_MS = 30_000;
/** Grace window after the last heartbeat before a project is shown offline. */
export const BRIDGE_HUB_HEARTBEAT_TTL_MS = 90_000;

export class BridgeHubProtocolError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'BridgeHubProtocolError';
    this.code = code;
    this.detail = detail;
  }
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function uniqueIdentifierArray(value, { min = 0, max = MAX_PROJECT_IDS } = {}) {
  return Array.isArray(value) && value.length >= min && value.length <= max
    && value.every(identifier) && new Set(value).size === value.length;
}

function sorted(ids) {
  return [...ids].sort((left, right) => left.localeCompare(right, 'en'));
}

/** A terminal's registration/heartbeat request, as it crosses the wire. */
export function validateBridgeHubRegistrationRequest(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'adopt,display_name,port,project_ids,schema,terminal_id'
    && value.schema === 'lattice.bridge_hub_registration_request.v1'
    && identifier(value.terminal_id)
    && typeof value.display_name === 'string' && value.display_name.length > 0
    && value.display_name === value.display_name.trim()
    && Number.isSafeInteger(value.port) && value.port > 0 && value.port <= 65_535
    && uniqueIdentifierArray(value.project_ids, { min: 1 })
    && uniqueIdentifierArray(value.adopt, { max: value.project_ids.length })
    && value.adopt.every((projectId) => value.project_ids.includes(projectId));
}

/** A single project's routing entry as stored in the hub registry. */
function validRegistryEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    && Object.keys(entry).sort().join(',')
      === 'address,display_name,last_seen_at,port,project_id,registered_at,terminal_id'
    && identifier(entry.project_id) && identifier(entry.terminal_id)
    && typeof entry.display_name === 'string' && entry.display_name.length > 0
    && typeof entry.address === 'string' && entry.address.length > 0
    && Number.isSafeInteger(entry.port) && entry.port > 0 && entry.port <= 65_535
    && Number.isFinite(Date.parse(entry.registered_at)) && Number.isFinite(Date.parse(entry.last_seen_at));
}

export function validateBridgeHubRegistryEntry(value) {
  return validRegistryEntry(value);
}

function validRegistry(registry) {
  return Array.isArray(registry) && registry.every(validRegistryEntry);
}

/**
 * Apply one registration/heartbeat call to a registry snapshot. Pure: takes the
 * current entries and returns the next ones plus a result summary, mutating
 * nothing. Throws `BridgeHubProtocolError` only for a malformed registry or
 * request; a project_id already held by another terminal is no longer fatal —
 * see the contention rules inline.
 */
export function applyBridgeHubRegistration({ registry, request, remoteAddress, now = new Date(),
  ttlMs = BRIDGE_HUB_HEARTBEAT_TTL_MS }) {
  if (!validRegistry(registry)) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRY_INVALID', 'bridge hub registry is invalid');
  }
  if (!validateBridgeHubRegistrationRequest(request)) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRATION_INVALID', 'bridge hub registration request is invalid');
  }
  if (typeof remoteAddress !== 'string' || remoteAddress.length === 0) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRATION_INVALID', 'remote address is required');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRATION_INVALID', 'now must be a valid Date');
  }
  const { terminal_id: terminalId, display_name: displayName, port, project_ids: projectIds, adopt } = request;
  const requestedSet = new Set(projectIds);
  const adoptSet = new Set(adopt);

  // A heartbeat carries the terminal's whole active set, so one contested
  // project_id used to fail the entire request and strand every unrelated
  // project on that terminal — invisibly, since the daemon only logs the
  // rejection to a stderr nobody reads. Contested ids are now settled one at a
  // time and the rest are accepted:
  //
  //   owner offline (no heartbeat within the TTL) — the entry is very likely a
  //     leftover from a terminal that moved on, so the live claimant takes it
  //     over. Nothing else ever retracts it: entries are never expired.
  //   owner online — the project genuinely belongs to another live terminal.
  //     Reject just that id and report it, so the operator can adopt on purpose.
  //     Handing it over unconditionally would make two live terminals trade
  //     ownership every heartbeat and flip the published route back and forth.
  const claimed = registry.filter((entry) => requestedSet.has(entry.project_id)
    && entry.terminal_id !== terminalId && !adoptSet.has(entry.project_id));
  const offline = (entry) => now.getTime() - Date.parse(entry.last_seen_at) > ttlMs;
  const rejected = claimed.filter((entry) => !offline(entry))
    .map((entry) => ({ project_id: entry.project_id, owning_terminal_id: entry.terminal_id }))
    .sort((left, right) => left.project_id.localeCompare(right.project_id, 'en'));
  const reclaimed = sorted(claimed.filter(offline).map((entry) => entry.project_id));

  const rejectedSet = new Set(rejected.map((entry) => entry.project_id));
  const acceptedIds = projectIds.filter((projectId) => !rejectedSet.has(projectId));
  const acceptedSet = new Set(acceptedIds);

  const registeredAtByProject = new Map(registry
    .filter((entry) => entry.terminal_id === terminalId)
    .map((entry) => [entry.project_id, entry.registered_at]));
  const adopted = sorted(acceptedIds.filter((projectId) => adoptSet.has(projectId)
    && !registeredAtByProject.has(projectId)));
  // Full-state reconciliation: every entry this terminal owned is dropped, then
  // rebuilt from the accepted ids. A project omitted from this call — dropped
  // locally, or never re-sent after a crash — is released, not left as a
  // phantom no future heartbeat can retract. Rejected ids stay with their live
  // owner, so `others` keeps them.
  const others = registry.filter((entry) => entry.terminal_id !== terminalId
    && !acceptedSet.has(entry.project_id));
  const mine = acceptedIds.map((projectId) => ({
    project_id: projectId,
    terminal_id: terminalId,
    display_name: displayName,
    address: remoteAddress,
    port,
    registered_at: registeredAtByProject.get(projectId) ?? now.toISOString(),
    last_seen_at: now.toISOString(),
  }));
  const nextRegistry = [...others, ...mine]
    .sort((left, right) => left.project_id.localeCompare(right.project_id, 'en'));

  return {
    registry: nextRegistry,
    result: {
      // v2: partial acceptance. v1 answered a contested id with a 409 that threw
      // the whole request away; v2 accepts what it can and names what it could
      // not. A v1 terminal reading a v2 result sees a 200 and simply does not
      // notice `rejected` — still strictly better than losing every project.
      schema: 'lattice.bridge_hub_registration_result.v2',
      terminal_id: terminalId,
      address: remoteAddress,
      port,
      registered: sorted(acceptedIds),
      adopted,
      rejected,
      reclaimed_from_offline: reclaimed,
    },
  };
}

/**
 * Read-time projection for the aggregate `/projects/` view and per-project
 * routing. Never mutates or drops entries — a terminal that stopped
 * heartbeating shows as 'offline' forever, not gone, until it re-registers, a
 * different terminal explicitly adopts the project, or a different terminal
 * claims it while this one is past the TTL (see applyBridgeHubRegistration).
 */
export function projectBridgeHubRegistry({ registry, now = new Date(), ttlMs = BRIDGE_HUB_HEARTBEAT_TTL_MS }) {
  if (!validRegistry(registry)) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRY_INVALID', 'bridge hub registry is invalid');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRATION_INVALID', 'now must be a valid Date');
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new BridgeHubProtocolError('BRIDGE_HUB_REGISTRATION_INVALID', 'ttlMs must be a positive integer');
  }
  return registry
    .map((entry) => ({
      schema: 'lattice.bridge_hub_registry_projection_entry.v1',
      project_id: entry.project_id,
      terminal_id: entry.terminal_id,
      display_name: entry.display_name,
      address: entry.address,
      port: entry.port,
      status: now.getTime() - Date.parse(entry.last_seen_at) <= ttlMs ? 'online' : 'offline',
      last_seen_at: entry.last_seen_at,
    }))
    .sort((left, right) => left.project_id.localeCompare(right.project_id, 'en'));
}

import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

import { networkInterfaces } from 'node:os';

import { resolveBridgeListenAddress } from './bridge-address.mjs';
import {
  BridgeConfigError, bridgeConfigPaths, normalizeBridgeAllowedHost, readBridgeConfig,
} from './bridge-config.mjs';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const UNTRUSTED_CLIENT_IP_HEADERS = new Set([
  'cf-connecting-ip', 'client-ip', 'fastly-client-ip', 'true-client-ip',
  'x-cluster-client-ip', 'x-proxyuser-ip',
]);

function dashboardRuntimeDir(env) {
  const configured = env.LATTICE_DASHBOARD_RUNTIME_DIR;
  return typeof configured === 'string' && path.isAbsolute(configured)
    ? configured : path.join(bridgeConfigPaths(env).root, 'dashboard');
}

function duplicateJsonKey(node) {
  if (node?.type === 'object') {
    const keys = new Set();
    for (const property of node.children ?? []) {
      const [key, child] = property.children ?? [];
      if (keys.has(key?.value) || duplicateJsonKey(child)) return true;
      keys.add(key?.value);
    }
  } else if (node?.type === 'array') return (node.children ?? []).some(duplicateJsonKey);
  return false;
}

async function readDashboardDescriptor(ref) {
  let before;
  let handle;
  try {
    before = await lstat(ref);
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600 || before.size > 65_536) {
      throw new BridgeConfigError('BRIDGE_UPSTREAM_INVALID', 'dashboard descriptor is unsafe');
    }
    handle = await open(ref, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.size > 65_536) {
      throw new BridgeConfigError('BRIDGE_UPSTREAM_INVALID', 'dashboard descriptor changed during validation');
    }
    const text = await handle.readFile('utf8');
    const after = await lstat(ref);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      throw new BridgeConfigError('BRIDGE_UPSTREAM_INVALID', 'dashboard descriptor changed during read');
    }
    const errors = [];
    const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
    if (errors.length > 0 || tree === undefined || duplicateJsonKey(tree)) {
      throw new BridgeConfigError('BRIDGE_UPSTREAM_INVALID', 'dashboard descriptor JSON is invalid');
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BridgeConfigError) throw error;
    throw new BridgeConfigError('BRIDGE_UPSTREAM_UNAVAILABLE', 'dashboard descriptor is unavailable', undefined, error);
  } finally { await handle?.close(); }
}

export async function resolveBridgeUpstream(upstream, {
  env = process.env, healthTimeoutMs = 2_000,
} = {}) {
  if (upstream.mode === 'url') return new URL(upstream.url);
  let descriptor;
  try {
    descriptor = await readDashboardDescriptor(path.join(dashboardRuntimeDir(env), 'daemon.json'));
  } catch (error) {
    throw new BridgeConfigError('BRIDGE_UPSTREAM_UNAVAILABLE', 'dashboard descriptor is unavailable', undefined, error);
  }
  if (descriptor?.schema !== 'lattice.todo_dashboard_daemon.v1'
    || Object.keys(descriptor).sort().join(',') !== 'pid,port,schema,started_at'
    || !Number.isSafeInteger(descriptor.pid) || descriptor.pid <= 0
    || !Number.isSafeInteger(descriptor.port) || descriptor.port <= 0 || descriptor.port > 65_535
    || typeof descriptor.started_at !== 'string') {
    throw new BridgeConfigError('BRIDGE_UPSTREAM_INVALID', 'dashboard descriptor is invalid');
  }
  try {
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/__lattice/health`, {
      signal: AbortSignal.timeout(healthTimeoutMs),
    });
    const health = response.status === 200 ? await response.json() : null;
    if (health?.schema !== 'lattice.todo_dashboard_health.v1' || health.pid !== descriptor.pid
      || health.port !== descriptor.port) throw new Error('dashboard health mismatch');
  } catch (error) {
    throw new BridgeConfigError('BRIDGE_UPSTREAM_UNAVAILABLE',
      'dashboard descriptor could not be attested against loopback health', undefined, error);
  }
  return new URL(`http://127.0.0.1:${descriptor.port}/`);
}

function responseError(response, status, code) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify({ schema: 'lattice.bridge_http_error.v1', code })}\n`);
}

function connectionTokens(headers) {
  const value = headers.connection;
  return new Set((Array.isArray(value) ? value.join(',') : value ?? '')
    .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function forwardHeaders(headers) {
  const nominated = connectionTokens(headers);
  return Object.fromEntries(Object.entries(headers)
    .filter(([name, value]) => value !== undefined && name !== 'host'
      && name.toLowerCase() !== 'forwarded' && name.toLowerCase() !== 'x-real-ip'
      && !name.toLowerCase().startsWith('x-forwarded-')
      && !UNTRUSTED_CLIENT_IP_HEADERS.has(name.toLowerCase())
      && !HOP_BY_HOP.has(name.toLowerCase()) && !nominated.has(name.toLowerCase())));
}

function validatedRequestHost(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || /[\s\\/@,]/u.test(value)) {
    throw new BridgeConfigError('BRIDGE_HOST_INVALID', 'request Host is invalid');
  }
  let parsed;
  try { parsed = new URL(`http://${value}`); } catch {
    throw new BridgeConfigError('BRIDGE_HOST_INVALID', 'request Host is invalid');
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.pathname !== '/'
    || parsed.search !== '' || parsed.hash !== '') {
    throw new BridgeConfigError('BRIDGE_HOST_INVALID', 'request Host is invalid');
  }
  const rawHostname = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
    ? parsed.hostname.slice(1, -1) : parsed.hostname;
  const hostname = normalizeBridgeAllowedHost(rawHostname);
  const authorityHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  return { hostname, authority: parsed.port === '' ? authorityHost : `${authorityHost}:${parsed.port}` };
}

function forwardedHeaders(incoming, host) {
  const remote = incoming.socket.remoteAddress ?? 'unknown';
  const forwardedFor = remote.includes(':') ? `"[${remote}]"` : remote;
  return {
    forwarded: `for=${forwardedFor};host="${host.authority}";proto=http`,
    'x-forwarded-for': remote,
    'x-forwarded-host': host.authority,
    'x-forwarded-proto': 'http',
    'x-real-ip': remote,
  };
}

function upstreamUrl(base, requestUrl) {
  if (typeof requestUrl !== 'string' || requestUrl.includes('#') || !/^\/(?!\/)[^\s]*$/u.test(requestUrl)) {
    throw new BridgeConfigError('BRIDGE_REQUEST_TARGET_INVALID', 'bridge requires an origin-form request target');
  }
  const rawPath = requestUrl.split('?', 1)[0];
  if (rawPath.includes('\\') || rawPath.includes('%')) {
    throw new BridgeConfigError('BRIDGE_REQUEST_TARGET_INVALID',
      'bridge request target contains encoded path bytes or a backslash');
  }
  if (rawPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new BridgeConfigError('BRIDGE_REQUEST_TARGET_INVALID', 'bridge request target contains a dot segment');
  }
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const target = new URL(requestUrl.slice(1), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(basePath)) {
    throw new BridgeConfigError('BRIDGE_REQUEST_TARGET_INVALID', 'bridge request target escapes upstream base');
  }
  return target;
}

function decodedRequestPath(requestUrl) {
  if (typeof requestUrl !== 'string') return null;
  try { return decodeURIComponent(requestUrl.split('?', 1)[0]); } catch { return null; }
}

export async function startBridgeServer({
  config, env = process.env,
  instanceToken = null,
  resolveUpstream = (upstream) => resolveBridgeUpstream(upstream, { env }),
  interfaces = networkInterfaces(),
} = {}) {
  if (config?.enabled !== true) throw new BridgeConfigError('BRIDGE_DISABLED', 'bridge is disabled');
  if (!Array.isArray(config.allowed_hosts) || config.allowed_hosts.length === 0) {
    throw new BridgeConfigError('BRIDGE_CONFIG_INVALID', 'bridge allowed hosts are required');
  }
  // A DHCP lease change moves the host inside its own subnet and strands the
  // configured literal. Follow it rather than binding a dead address, but only
  // within the same subnet (see bridge-address.mjs for why that bound matters).
  const resolvedListen = resolveBridgeListenAddress({ configured: config.listen.address, interfaces });
  if (resolvedListen.effective === null) {
    throw new BridgeConfigError('BRIDGE_LISTEN_ADDRESS_ABSENT',
      'configured bridge listen address is not present on this host',
      { ...config.listen, listen_state: resolvedListen.state });
  }
  const listenAddress = resolvedListen.effective;
  let allowedHosts = new Set(config.allowed_hosts);
  // The rebound address has to answer for itself, otherwise every request to it
  // is rejected by the Host allow-list the operator never knew had gone stale.
  if (listenAddress !== config.listen.address) {
    allowedHosts.add(normalizeBridgeAllowedHost(listenAddress));
  }
  let currentConfig = config;
  const handleRequest = async (incoming, response) => {
    let requestHost;
    try { requestHost = validatedRequestHost(incoming.headers.host); } catch (error) {
      responseError(response, 400, error?.code ?? 'BRIDGE_HOST_INVALID');
      return;
    }
    if (!allowedHosts.has(requestHost.hostname)) {
      responseError(response, 421, 'BRIDGE_HOST_NOT_ALLOWED');
      return;
    }
    if (incoming.url === '/__lattice/bridge-health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      const attested = typeof instanceToken === 'string'
        && incoming.headers['x-lattice-bridge-instance-token'] === instanceToken;
      response.end(`${JSON.stringify(attested
        ? { schema: 'lattice.bridge_health.v1', pid: process.pid,
          address: currentConfig.listen.address, port: currentConfig.listen.port,
          updated_at: currentConfig.updated_at ?? null }
        : { schema: 'lattice.bridge_health.v1', status: 'available' })}\n`);
      return;
    }
    if (decodedRequestPath(incoming.url) === '/__lattice/health') {
      responseError(response, 404, 'BRIDGE_INTERNAL_PATH_DENIED');
      return;
    }
    let target;
    try { target = upstreamUrl(await resolveUpstream(currentConfig.upstream), incoming.url); } catch (error) {
      responseError(response, error?.code === 'BRIDGE_REQUEST_TARGET_INVALID' ? 400 : 503,
        error?.code ?? 'BRIDGE_UPSTREAM_UNAVAILABLE');
      return;
    }
    let upstreamResponse = null;
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: incoming.method,
      headers: { ...forwardHeaders(incoming.headers), ...forwardedHeaders(incoming, requestHost), host: target.host },
    }, (incomingResponse) => {
      upstreamResponse = incomingResponse;
      response.writeHead(incomingResponse.statusCode ?? 502, forwardHeaders(incomingResponse.headers));
      incomingResponse.once('error', () => response.destroy());
      incomingResponse.pipe(response);
    });
    request.once('error', (error) => responseError(response, 502,
      error?.code === 'ECONNREFUSED' ? 'BRIDGE_UPSTREAM_REFUSED' : 'BRIDGE_PROXY_FAILED'));
    incoming.once('aborted', () => request.destroy());
    response.once('close', () => {
      if (!response.writableFinished) {
        request.destroy();
        upstreamResponse?.destroy();
      }
    });
    incoming.pipe(request);
  };
  const server = createServer((incoming, response) => {
    handleRequest(incoming, response).catch((error) => responseError(response, 500,
      error?.code ?? 'BRIDGE_REQUEST_FAILED'));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: listenAddress, port: config.listen.port, exclusive: true }, resolve);
  }).catch((error) => {
    throw new BridgeConfigError(error?.code === 'EADDRINUSE' ? 'BRIDGE_PORT_UNAVAILABLE' : 'BRIDGE_BIND_FAILED',
      'bridge listen failed', { ...config.listen, effective_address: listenAddress }, error);
  });
  const boundAddress = server.address();
  const actualPort = typeof boundAddress === 'object' && boundAddress !== null
    ? boundAddress.port : config.listen.port;
  let closed = false;
  return Object.freeze({
    address: listenAddress,
    configured_address: config.listen.address,
    rebound: listenAddress !== config.listen.address,
    port: actualPort,
    updateConfig(next) {
      if (next?.enabled !== true || next.listen.address !== config.listen.address
        || next.listen.port !== config.listen.port) {
        throw new BridgeConfigError('BRIDGE_RECONFIGURE_INVALID', 'live bridge binding cannot be mutated in place');
      }
      currentConfig = next;
      allowedHosts = new Set(next.allowed_hosts);
      if (listenAddress !== config.listen.address) {
        allowedHosts.add(normalizeBridgeAllowedHost(listenAddress));
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const completion = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections?.();
      await completion;
    },
  });
}

export function bridgeRuntimeController({ env = process.env, instanceToken = null } = {}) {
  let active = null;
  let fingerprint = null;
  return Object.freeze({
    async reconcile() {
      const config = await readBridgeConfig({ env });
      const next = config === null || !config.enabled ? null : JSON.stringify(config);
      if (next === fingerprint) return active;
      if (next === null) {
        await active?.close();
        active = null;
        fingerprint = null;
        return null;
      }
      // Compare against the CONFIGURED address: a rebound binding still serves
      // the same configuration, and comparing the effective address would tear
      // the server down and rebuild it on every reconcile.
      if (active !== null && active.configured_address === config.listen.address
        && active.port === config.listen.port) {
        active.updateConfig(config);
        fingerprint = next;
        return active;
      }
      const replacement = await startBridgeServer({ config, env, instanceToken });
      const previous = active;
      active = replacement;
      fingerprint = next;
      await previous?.close();
      return active;
    },
    async close() {
      await active?.close();
      active = null;
      fingerprint = null;
    },
  });
}

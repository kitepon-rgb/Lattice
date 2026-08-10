import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBridgeHubRegistration, BridgeHubProtocolError, BRIDGE_HUB_HEARTBEAT_TTL_MS,
  projectBridgeHubRegistry, validateBridgeHubRegistrationRequest, validateBridgeHubRegistryEntry,
} from '../src/bridge-hub-protocol.mjs';

function request(overrides = {}) {
  return {
    schema: 'lattice.bridge_hub_registration_request.v1',
    terminal_id: 'kikoeru-mac',
    display_name: 'kikoeru',
    port: 53939,
    project_ids: ['kikoeru'],
    adopt: [],
    ...overrides,
  };
}

test('登録requestは既定形なら妥当と判定する', () => {
  assert.equal(validateBridgeHubRegistrationRequest(request()), true);
});

test('登録requestはaddress fieldを持てない（送信元から導出する契約）', () => {
  assert.equal(validateBridgeHubRegistrationRequest({ ...request(), address: '192.168.1.10' }), false);
});

test('登録requestはproject_idsの重複・adoptの範囲外指定・不正portを拒否する', () => {
  assert.equal(validateBridgeHubRegistrationRequest(request({ project_ids: ['a', 'a'] })), false);
  assert.equal(validateBridgeHubRegistrationRequest(request({ adopt: ['not-requested'] })), false);
  assert.equal(validateBridgeHubRegistrationRequest(request({ port: 0 })), false);
  assert.equal(validateBridgeHubRegistrationRequest(request({ port: 65_536 })), false);
  assert.equal(validateBridgeHubRegistrationRequest(request({ terminal_id: '' })), false);
  assert.equal(validateBridgeHubRegistrationRequest(request({ project_ids: [] })), false);
});

test('新規登録はremoteAddressをentryのaddressへ写し、requestのportとdisplay_nameを保持する', () => {
  const { registry, result } = applyBridgeHubRegistration({
    registry: [], request: request(), remoteAddress: '192.168.1.42',
    now: new Date('2026-08-10T04:00:00.000Z'),
  });
  assert.equal(registry.length, 1);
  const [entry] = registry;
  assert.equal(validateBridgeHubRegistryEntry(entry), true);
  assert.equal(entry.project_id, 'kikoeru');
  assert.equal(entry.terminal_id, 'kikoeru-mac');
  assert.equal(entry.address, '192.168.1.42');
  assert.equal(entry.port, 53939);
  assert.equal(entry.registered_at, '2026-08-10T04:00:00.000Z');
  assert.equal(entry.last_seen_at, '2026-08-10T04:00:00.000Z');
  assert.deepEqual(result, {
    schema: 'lattice.bridge_hub_registration_result.v1',
    terminal_id: 'kikoeru-mac', address: '192.168.1.42', port: 53939,
    registered: ['kikoeru'], adopted: [],
  });
});

test('同じ端末の再登録（heartbeat）はregistered_atを保ちlast_seen_atだけ進める', () => {
  const first = applyBridgeHubRegistration({
    registry: [], request: request(), remoteAddress: '192.168.1.42',
    now: new Date('2026-08-10T04:00:00.000Z'),
  });
  const second = applyBridgeHubRegistration({
    registry: first.registry, request: request(), remoteAddress: '192.168.1.42',
    now: new Date('2026-08-10T04:00:30.000Z'),
  });
  assert.equal(second.registry.length, 1);
  assert.equal(second.registry[0].registered_at, '2026-08-10T04:00:00.000Z');
  assert.equal(second.registry[0].last_seen_at, '2026-08-10T04:00:30.000Z');
});

test('同じ端末が次のheartbeatでprojectを外すと該当entryを解放する', () => {
  const first = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['kikoeru', 'sub-project'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  });
  assert.equal(first.registry.length, 2);
  const second = applyBridgeHubRegistration({
    registry: first.registry, request: request({ project_ids: ['kikoeru'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:01:00.000Z'),
  });
  assert.deepEqual(second.registry.map((entry) => entry.project_id), ['kikoeru']);
});

test('別端末が未adoptで既存project_idを主張すると全体を拒否し、registryもresultも変えない', () => {
  const owned = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['kikoeru', 'chromeblocker'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;

  assert.throws(() => applyBridgeHubRegistration({
    registry: owned,
    request: request({ terminal_id: 'yuzu-win', display_name: 'yuzu-pc',
      project_ids: ['chromeblocker', 'new-project'] }),
    remoteAddress: '192.168.1.77', now: new Date('2026-08-10T04:05:00.000Z'),
  }), (error) => {
    assert.ok(error instanceof BridgeHubProtocolError);
    assert.equal(error.code, 'BRIDGE_HUB_PROJECT_CONFLICT');
    assert.deepEqual(error.detail.conflicts, [{ project_id: 'chromeblocker', owning_terminal_id: 'kikoeru-mac' }]);
    return true;
  });
  // 拒否された呼び出しは何も書かない: 元のarrayは別参照のまま中身も変わらない。
  assert.deepEqual(owned.map((entry) => entry.terminal_id), ['kikoeru-mac', 'kikoeru-mac']);
});

test('adoptへ明示した衝突project_idだけ所有者が移り、他のprojectはそのまま残る', () => {
  const owned = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['kikoeru', 'chromeblocker'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;

  const { registry, result } = applyBridgeHubRegistration({
    registry: owned,
    request: request({ terminal_id: 'yuzu-win', display_name: 'yuzu-pc',
      project_ids: ['chromeblocker'], adopt: ['chromeblocker'] }),
    remoteAddress: '192.168.1.77', now: new Date('2026-08-10T04:05:00.000Z'),
  });
  assert.deepEqual(result.adopted, ['chromeblocker']);
  const byProject = Object.fromEntries(registry.map((entry) => [entry.project_id, entry]));
  assert.equal(byProject.chromeblocker.terminal_id, 'yuzu-win');
  assert.equal(byProject.chromeblocker.address, '192.168.1.77');
  assert.equal(byProject.kikoeru.terminal_id, 'kikoeru-mac');
});

test('複数のproject_id衝突は1回のエラーへまとめて報告する', () => {
  const owned = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['alpha', 'beta'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;
  assert.throws(() => applyBridgeHubRegistration({
    registry: owned,
    request: request({ terminal_id: 'other', project_ids: ['alpha', 'beta'] }),
    remoteAddress: '192.168.1.99', now: new Date('2026-08-10T04:05:00.000Z'),
  }), (error) => {
    assert.deepEqual(error.detail.conflicts, [
      { project_id: 'alpha', owning_terminal_id: 'kikoeru-mac' },
      { project_id: 'beta', owning_terminal_id: 'kikoeru-mac' },
    ]);
    return true;
  });
});

test('壊れたregistryや無効なnowはtyped errorで拒否する', () => {
  assert.throws(() => applyBridgeHubRegistration({
    registry: [{ not: 'valid' }], request: request(), remoteAddress: '192.168.1.42',
  }), (error) => error instanceof BridgeHubProtocolError && error.code === 'BRIDGE_HUB_REGISTRY_INVALID');
  assert.throws(() => applyBridgeHubRegistration({
    registry: [], request: request(), remoteAddress: '192.168.1.42', now: new Date('invalid'),
  }), (error) => error.code === 'BRIDGE_HUB_REGISTRATION_INVALID');
  assert.throws(() => applyBridgeHubRegistration({
    registry: [], request: request(), remoteAddress: '',
  }), (error) => error.code === 'BRIDGE_HUB_REGISTRATION_INVALID');
});

test('TTL内のentryはonline、TTLを超えたentryはofflineだが消えずに残る', () => {
  const owned = applyBridgeHubRegistration({
    registry: [], request: request(), remoteAddress: '192.168.1.42',
    now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;

  const fresh = projectBridgeHubRegistry({ registry: owned, now: new Date('2026-08-10T04:00:30.000Z') });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].status, 'online');

  const stale = projectBridgeHubRegistry({
    registry: owned, now: new Date(Date.parse('2026-08-10T04:00:00.000Z') + BRIDGE_HUB_HEARTBEAT_TTL_MS + 1),
  });
  assert.equal(stale.length, 1);
  assert.equal(stale[0].status, 'offline');
  assert.equal(stale[0].project_id, 'kikoeru');
  assert.equal(stale[0].address, '192.168.1.42');
});

test('projectBridgeHubRegistryはカスタムttlMsを尊重する', () => {
  const owned = applyBridgeHubRegistration({
    registry: [], request: request(), remoteAddress: '192.168.1.42',
    now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;
  const projected = projectBridgeHubRegistry({
    registry: owned, now: new Date('2026-08-10T04:00:05.000Z'), ttlMs: 1_000,
  });
  assert.equal(projected[0].status, 'offline');
});

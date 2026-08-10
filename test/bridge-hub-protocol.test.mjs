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
    schema: 'lattice.bridge_hub_registration_result.v2',
    terminal_id: 'kikoeru-mac', address: '192.168.1.42', port: 53939,
    registered: ['kikoeru'], adopted: [], rejected: [], reclaimed_from_offline: [],
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

test('生きている端末が持つproject_idだけを弾き、同じrequestの他projectは受理する', () => {
  // heartbeatは端末のactive集合を丸ごと送るので、全体拒否は衝突1件で無関係な
  // project全部を公開面から消していた。しかも拒否はdaemonのstderrにしか出ず、
  // 利用者から見える症状は「新規projectがいつまでも公開工程表に出ない」だけだった
  // （2026-08-10報告）。
  const owned = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['kikoeru', 'chromeblocker'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;

  const { registry, result } = applyBridgeHubRegistration({
    registry: owned,
    request: request({ terminal_id: 'yuzu-win', display_name: 'yuzu-pc',
      project_ids: ['chromeblocker', 'new-project'] }),
    // 所有者kikoeru-macのlast_seenから30秒。TTL(90秒)内なので生きている。
    remoteAddress: '192.168.1.77', now: new Date('2026-08-10T04:00:30.000Z'),
  });
  assert.deepEqual(result.registered, ['new-project']);
  assert.deepEqual(result.rejected, [{ project_id: 'chromeblocker', owning_terminal_id: 'kikoeru-mac' }]);
  assert.deepEqual(result.reclaimed_from_offline, []);
  const byProject = Object.fromEntries(registry.map((entry) => [entry.project_id, entry]));
  assert.equal(byProject.chromeblocker.terminal_id, 'kikoeru-mac', '生きた所有者から奪わない');
  assert.equal(byProject['new-project'].terminal_id, 'yuzu-win', '無関係なprojectは巻き添えにしない');
  assert.equal(byProject.kikoeru.terminal_id, 'kikoeru-mac');
});

test('TTLを過ぎた端末が持つproject_idは、主張してきた端末へ差し替える', () => {
  // 所有entryは期限切れでも消えないので、残骸が残ったままだと新しい端末は永久に
  // その project を配信できない。生死で二分し、offline側だけ明け渡す。
  const owned = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['kikoeru', 'chromeblocker'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;

  const { registry, result } = applyBridgeHubRegistration({
    registry: owned,
    request: request({ terminal_id: 'yuzu-win', display_name: 'yuzu-pc',
      project_ids: ['chromeblocker'] }),
    // TTL 90秒を大きく超えた時刻。所有者はofflineである。
    remoteAddress: '192.168.1.77', now: new Date('2026-08-10T04:05:00.000Z'),
  });
  assert.deepEqual(result.registered, ['chromeblocker']);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.reclaimed_from_offline, ['chromeblocker']);
  const byProject = Object.fromEntries(registry.map((entry) => [entry.project_id, entry]));
  assert.equal(byProject.chromeblocker.terminal_id, 'yuzu-win');
  assert.equal(byProject.chromeblocker.address, '192.168.1.77');
  assert.equal(byProject.kikoeru.terminal_id, 'kikoeru-mac', '同じ端末の他projectは触らない');
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

test('複数の衝突はproject_id順にまとめて報告し、full-state整合を壊さない', () => {
  const owned = applyBridgeHubRegistration({
    registry: [], request: request({ project_ids: ['alpha', 'beta'] }),
    remoteAddress: '192.168.1.42', now: new Date('2026-08-10T04:00:00.000Z'),
  }).registry;
  const { registry, result } = applyBridgeHubRegistration({
    registry: owned,
    request: request({ terminal_id: 'other', project_ids: ['alpha', 'beta', 'gamma', 'delta'] }),
    remoteAddress: '192.168.1.99', now: new Date('2026-08-10T04:00:30.000Z'),
  });
  assert.deepEqual(result.rejected, [
    { project_id: 'alpha', owning_terminal_id: 'kikoeru-mac' },
    { project_id: 'beta', owning_terminal_id: 'kikoeru-mac' },
  ]);
  assert.deepEqual(result.registered, ['delta', 'gamma']);

  // 受理された集合＝この端末の所有集合。次のheartbeatで外したprojectは解放される
  // （full-state reconciliation）。弾かれた分は元の所有者に残ったままである。
  const dropped = applyBridgeHubRegistration({
    registry,
    request: request({ terminal_id: 'other', project_ids: ['gamma'] }),
    remoteAddress: '192.168.1.99', now: new Date('2026-08-10T04:01:00.000Z'),
  });
  assert.deepEqual(dropped.registry.map((entry) => `${entry.project_id}:${entry.terminal_id}`),
    ['alpha:kikoeru-mac', 'beta:kikoeru-mac', 'gamma:other']);
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

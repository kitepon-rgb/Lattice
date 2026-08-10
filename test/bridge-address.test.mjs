import assert from 'node:assert/strict';
import test from 'node:test';

import { bridgeHostAddresses, pickBridgeLanAddress, resolveBridgeListenAddress } from '../src/bridge-address.mjs';

const iface = (entries) => entries;

// 実機で起きた形: DHCPリースでMacのLAN IPが .102 -> .103 へ変わった。
const AFTER_DHCP_CHANGE = {
  lo0: iface([{ address: '127.0.0.1', internal: true }, { address: '::1', internal: true }]),
  en0: iface([{ address: '192.168.1.103', internal: false },
    { address: 'fe80::1cbd:4ff:fe6d:1', internal: false }]),
};

test('設定アドレスがホストに存在すればそのまま使う', () => {
  const result = resolveBridgeListenAddress({
    configured: '192.168.1.103', interfaces: AFTER_DHCP_CHANGE,
  });
  assert.equal(result.state, 'present');
  assert.equal(result.effective, '192.168.1.103');
  assert.equal(result.reason, null);
});

test('同一subnet内でアドレスが変わったら再bind先として解決する', () => {
  const result = resolveBridgeListenAddress({
    configured: '192.168.1.102', interfaces: AFTER_DHCP_CHANGE,
  });
  assert.equal(result.state, 'rebindable');
  assert.equal(result.effective, '192.168.1.103');
  assert.equal(result.configured, '192.168.1.102');
  assert.deepEqual(result.candidates, ['192.168.1.103']);
  assert.equal(result.reason, 'configured_address_absent_rebound_within_subnet');
});

test('別networkのアドレスは自動採用しない', () => {
  // VPNや第二NICが生きていても、設定と別subnetなら露出先を勝手に変えない。
  const result = resolveBridgeListenAddress({
    configured: '192.168.1.102',
    interfaces: {
      lo0: iface([{ address: '127.0.0.1', internal: true }]),
      utun0: iface([{ address: '10.8.0.5', internal: false }]),
      en1: iface([{ address: '172.16.4.9', internal: false }]),
    },
  });
  assert.equal(result.state, 'absent');
  assert.equal(result.effective, null);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.reason, 'configured_address_absent_from_host');
});

test('loopbackは再bind先に採らない', () => {
  const result = resolveBridgeListenAddress({
    configured: '127.0.0.2',
    interfaces: { lo0: iface([{ address: '127.0.0.1', internal: true }]) },
  });
  assert.equal(result.state, 'absent');
  assert.equal(result.effective, null);
});

test('wildcardは常にpresent扱いにする', () => {
  for (const wildcard of ['0.0.0.0', '::']) {
    const result = resolveBridgeListenAddress({ configured: wildcard, interfaces: {} });
    assert.equal(result.state, 'present', wildcard);
    assert.equal(result.effective, wildcard);
  }
});

test('未設定・不正値はunconfiguredとして返す', () => {
  for (const value of [null, undefined, '', 'not-an-ip']) {
    const result = resolveBridgeListenAddress({ configured: value, interfaces: AFTER_DHCP_CHANGE });
    assert.equal(result.state, 'unconfigured', String(value));
    assert.equal(result.effective, null);
  }
});

test('IPv6は/64一致だけを同一networkとみなす', () => {
  const interfaces = {
    en0: iface([{ address: '2001:db8:0:1::20', internal: false },
      { address: '2001:db8:0:2::30', internal: false }]),
  };
  const same = resolveBridgeListenAddress({ configured: '2001:db8:0:1::10', interfaces });
  assert.equal(same.state, 'rebindable');
  assert.equal(same.effective, '2001:db8:0:1::20');

  const different = resolveBridgeListenAddress({ configured: '2001:db8:0:9::10', interfaces });
  assert.equal(different.state, 'absent');
});

test('同一subnetに複数候補があっても決定的に選び候補を全部返す', () => {
  const interfaces = {
    en0: iface([{ address: '192.168.1.130', internal: false }]),
    en1: iface([{ address: '192.168.1.120', internal: false }]),
  };
  const first = resolveBridgeListenAddress({ configured: '192.168.1.102', interfaces });
  const second = resolveBridgeListenAddress({ configured: '192.168.1.102', interfaces });
  assert.equal(first.effective, second.effective);
  assert.deepEqual(first.candidates, ['192.168.1.120', '192.168.1.130']);
});

test('bridgeHostAddressesはinternal区別とfamilyを保つ', () => {
  const addresses = bridgeHostAddresses(AFTER_DHCP_CHANGE);
  const loopback = addresses.find((entry) => entry.address === '127.0.0.1');
  const lan = addresses.find((entry) => entry.address === '192.168.1.103');
  assert.equal(loopback.internal, true);
  assert.equal(loopback.family, 4);
  assert.equal(lan.internal, false);
  assert.equal(lan.family, 4);
});

test('pickBridgeLanAddressはinternal以外の先頭候補（sort済み）を選ぶ', () => {
  const result = pickBridgeLanAddress({ interfaces: AFTER_DHCP_CHANGE });
  assert.equal(result.address, '192.168.1.103');
  assert.deepEqual(result.candidates, ['192.168.1.103', 'fe80::1cbd:4ff:fe6d:1']);
});

test('pickBridgeLanAddressはfamilyでIPv4/IPv6を絞り込める', () => {
  const v6Only = pickBridgeLanAddress({ interfaces: AFTER_DHCP_CHANGE, family: 6 });
  assert.equal(v6Only.address, 'fe80::1cbd:4ff:fe6d:1');
});

test('pickBridgeLanAddressはinternalしか無ければnullを返す（loopbackを自動採用しない）', () => {
  const result = pickBridgeLanAddress({
    interfaces: { lo0: [{ address: '127.0.0.1', internal: true }] },
  });
  assert.equal(result.address, null);
  assert.deepEqual(result.candidates, []);
});

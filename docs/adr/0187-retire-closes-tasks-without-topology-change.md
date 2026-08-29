# ADR 0187: retireは計画の形を変えずに工程を恒久除去する

- status: accepted
- date: 2026-08-29

## 文脈

digest束縛plan（v7）からのタスク除去は改訂封筒＋markdown原簿＋plan間束縛の再結線を要求し、
revise-setがv3封筒を受けないため、plan間束縛を持つv7 planでは正規の除去経路が存在しなかった
（polyで実被弾）。消費計画が消えた工程がready/blockedに残り続け、待機席の誤claimを誘発した。

## 決定

`todo retire --plan --task --reason` を状態遷移として追加する。pending/blockedからのみ遷移、
理由必須（blocked_reason fieldへ格納しstate recordの形を変えない）。topologyは不変のため
plan間束縛（expected_topology_digest）に影響しない。retiredはstatus/frontier/ganttの表示から
消え、履歴と理由はsnapshot/journalが保持する。retiredの前提を持つ工程はreadyにならず、
全taskがdone/retiredのPhaseはgate_readyになる。

## 帰結

- v0.66.0で出荷（詳細パネルからの除去はv0.66.1）。表示からの除去は消去ではなく、journalに全履歴が残る

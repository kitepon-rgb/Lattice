# ADR 0161 — host駆動managed epochをadapter能力として宣言する

- Status: Accepted
- Date: 2026-08-09
- Extends: [ADR 0126](0126-distribute-scripted-adapter-controller.md)
- Preserves: [ADR 0125](0125-public-runtime-adapter-registry-cli.md)

## Context

ADR 0126は、同梱scripted controllerだけをfile名で判別してmanaged epochをhostから駆動した。
work-order controllerも公開CLIの同じ駆動経路を必要とするが、adapter名やfile名の分岐を増やすと、
実dispatchをhostが所有するという境界を実装の偶然へ依存させる。また同じ駆動predicateは初回activateだけでなく、
intentional serial recompile後のepochにも使われるため、初回dispatchだけを表す能力名では契約が狭すぎる。

## Decision

1. `lattice.runtime_adapter_registration_input.v2`へexact boolean `host_driven_epoch`を追加する。
   公開`run adapter register --schema --json`はv2を返し、v1入力も受理し続ける。
2. registryはv2入力から`lattice.runtime_adapter_capabilities.v2`を導出し、同じbooleanと自己digestを
   launch descriptorへ束縛する。v1入力は従来のcapabilities v1を導出する。
3. controller handshakeのcapabilities v2も同じbooleanを宣言する。hostは登録時のv2/trueと
   controllerのv2/trueが同じcapabilities digestへ束縛された時だけmanaged epochを駆動する。
4. v2/false、片側だけのv2、digest不一致、未知versionは自動駆動しない。work-order controllerが
   staleなv1登録へ接続した時は`WORK_ORDER_CAPABILITIES_MISMATCH`でv2再登録を要求し、無言停止にしない。
5. 既存scripted controllerのcapabilities v1と配布bin名によるgateだけは後方互換として残す。
   work-orderを含む新adapterをadapter名やfile名で特別扱いしない。

## Protected behavior

- 実dispatch、lease、gate、receipt adjudicationはhostが所有する。controllerの能力宣言はhost駆動を
  受け入れる意思だけを表し、controller自身へdispatch所有権を移さない。
- registration input v1と既存scripted v1経路は引き続き有効である。
- 宣言が一致しないcontrollerを推測やfallbackで駆動しない。

## Consequences

- work-orderを含むadapterは、公開登録契約とhandshakeの両方で同意した場合だけ、初回と再compile後の
  managed epochをhostから一貫して駆動できる。
- 配布schemaはv1とv2を併存させ、公開schema面はlatest v2を示す。
- 既存のv1 work-order登録はv2で再登録するまでtypedに拒否される。

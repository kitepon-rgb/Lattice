# RC2 artifact v2 characterization

- Date: 2026-07-16
- Decision: [ADR 0040](../adr/0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md)
- Scope: artifact v2、execution identity v2、plan v3、v1 read compatibilityの実装前契約

## 固定した契約

- campaign入口は`artifactVersion: "v2"`を明示し、result schemaと`artifact_version`でv2を識別する。
- Codegraph identity v2はtarget repoの`codegraph.json` actual bytesを
  `identity/codegraph-config.json`へ保存し、そのdigestをexecution identityへ束縛する。
- artifact manifest v2はv1 exact setへconfig、ADR 0040、v1 manifest、v1 new planの4 payloadだけを追加する。
- plan `rc2-delivery-policy-v3`はv1 artifact内の`rc2-delivery-policy-v2`をpredecessorにし、31個のcausal predecessorを持つ。
- version-aware disk verifierはv1の14 checksを維持し、v2では`codegraph_config_binding`を加えた15 checksを行う。
- config payloadまたはv1 predecessor payloadをmanifestと共にresealしても、意味論的binding違反としてrejectする。

## Expected-red

実行:

```text
node --test test/rc2-campaign.test.mjs
```

結果:

```text
tests 5
pass 1
fail 4
cancelled 0
skipped 0
```

最初のfailureは`runRc2Campaign options must have exact repoRoot and baseRef`である。production APIが
`artifactVersion`をまだ受理しないために共有fixtureが一度rejectされ、残り3件も同じfixture Promiseから同一原因で失敗した。
config／artifact／version barrier実装へ到達する前の単一failureであり、H0c.2の実装開始条件を満たす。

## 未実装

この時点では`codegraph.json`、execution identity v2、artifact v2 writer／verifier、plan v3を実装していない。
v1 artifactは変更していない。

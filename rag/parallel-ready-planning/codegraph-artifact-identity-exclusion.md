# Codegraph live graphからimmutable execution preimageを分離する

- 更新日: 2026-07-16
- 確度: Codegraph 1.4.1 config仕様とRC2 fresh clone実測は高。別製品／別versionへの一般化は未検証。
- source: [[raw/codegraph-1.4.1-project-config-exclude-source-record]]

RC2 artifactは実行主体bytesを再検証できるよう`.mjs`として保存する。しかし保存bytesはuntrusted evidenceであり、現在のlive architectureではない。
artifact commit後のfresh full indexは同名symbolを二重収載し、live oracle sourceの`affectedTests`を3件から0件へ変えた。incremental indexは旧edgeを
保持して3件を返したため、`status complete／pending 0`だけではfresh coverageと等価でなかった。

Latticeでは`codegraph.json`のtracked-path `exclude`を使い、`research/campaigns/**/artifacts/**/identity/`だけをsensor scopeから外す。
artifact verifierは保存bytesを引き続き検証するため、証拠を削除する設計ではない。live source、fixture、test、plan／patch／JSON evidenceは除外しない。

configはCodegraph outputへ影響するcompiler inputである。したがって「ローカル環境設定」として暗黙化せず、actual config bytes／digestを
Codegraph execution identity、fresh run measurement、artifact manifestへbindする。artifact publication後にscopeを変えた場合は旧planへ追記せず、
旧artifactをpredecessorに新しいplan versionを再compileする。

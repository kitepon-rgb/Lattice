<!-- raw source record: 公開特許の書誌・claim確認先を保存し、性能証拠や法的判断には使わない -->

- 取得日: 2026-07-15
- 取得方法: Google Patentsの公開書誌、abstract、独立claimをWebで照合。
- 確度: 中（公開書誌／claim本文）、低（有効性・自由実施・法的status解釈は範囲外）

| publication | title / owner | 検証した機構 | 本研究での扱い |
|---|---|---|---|
| [US6892192B1](https://patents.google.com/patent/US6892192B1/en) | *Method and system for dynamic business process management using a partial order planner* | least-commitment／partial-orderでbusiness processを適応的に計画 | 古典POPの製品応用例。`US6892192`だけでは検索しづらく、B1 suffixを正規番号とする |
| [US12111859B2](https://patents.google.com/patent/US12111859B2/en) | *Enterprise generative artificial intelligence architecture* | orchestratorが複数agent/toolへfan-outし結果を統合 | parallel agent例。TODO DAGの直接根拠にはしない |
| [US12254334B2](https://patents.google.com/patent/US12254334B2/en) | IBM, *Bootstrapping dynamic orchestration workflow* | contextual execution dependency graphからagent sequenceを作る | dependency graph／実行順の既存例 |
| [US12039263B1](https://patents.google.com/patent/US12039263B1/en) | McKinsey, *Orchestration of parallel generative AI pipelines* | chunk別LLM処理のparallel fan-outと後段統合 | read-heavy fork/join例。writer conflictは扱わない |
| [US12412138B1](https://patents.google.com/patent/US12412138B1/en) | UiPath, *Agentic orchestration* | resource availabilityに基づくparallel steps、出力後の再計画、人手介入 | capacity-aware ready setとversioned replanの比較例 |
| [WO2024244271A1](https://patents.google.com/patent/WO2024244271A1/en) | Tencent, LLM task generation | targetをatomic taskとexecution flowchartへ分解 | atomicityの既存例。parallel／joinはclaimから断定しない |
| [US20250259042A1](https://patents.google.com/patent/US20250259042A1/en) | QOMPLX, collaborative agents | objective分解、dynamic delegation、parallel processing | capability routingの比較例。DAG／recoveryは断定しない |

JPO検索で有効hitが無いという主張と、AI特許に占めるagentic AI比率7%／5%は一次出典を特定できず、不採用とする。

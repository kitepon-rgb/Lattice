// Production入口はLattice同梱sensorだけを使用する。旧Codegraph名のexportは、
// 既存artifact schemaとconsumer ABIをbyte互換で読むための名前であり、外部runtimeへの入口ではない。
export {
  collectCodegraphEvidence,
  portableCodegraphOutcome,
} from './codegraph-adapter.mjs';

export {
  collectCodegraphEvidence as collectSensorEvidence,
  portableCodegraphOutcome as portableSensorOutcome,
} from './codegraph-adapter.mjs';

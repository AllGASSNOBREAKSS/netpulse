import type { TestResult } from "../lib/engine";
import type { MetricDef } from "../lib/metrics";
import type { ScorePart } from "../lib/scoring";
import Modal from "./Modal";

/** Detail panel for one metric: meaning, method, result, ranges, samples, action. */
export function MetricDetail({
  def,
  result,
  onClose,
}: {
  def: MetricDef;
  result: TestResult | null;
  onClose: () => void;
}) {
  const value = result ? def.value(result) : null;
  const samples = result && def.samples ? def.samples(result) : null;

  return (
    <Modal title={def.name} onClose={onClose}>
      {def.unavailable && (
        <div className="mi__unavailable">
          <strong>Not measured.</strong> {def.unavailable}
        </div>
      )}
      {def.experimental && !def.unavailable && (
        <div className="mi__unavailable">
          <strong>Experimental.</strong> This shows a related, honestly-labeled signal — not a definitive
          measurement of this metric. Read “How it's measured” for exactly what the number means.
        </div>
      )}

      <section className="mi">
        <h3 className="mi__h">What it means</h3>
        <p>{def.what}</p>
      </section>

      <section className="mi">
        <h3 className="mi__h">{def.unavailable ? "What it would take" : "How it's measured"}</h3>
        <p>{def.how}</p>
      </section>

      {!def.unavailable && (
        <section className="mi">
          <h3 className="mi__h">Your result</h3>
          <p className="mi__value">
            {value ?? "No test yet — run one from the Speed test tab."}
            {value && def.sub && result && def.sub(result) ? (
              <span className="mi__valuesub"> · {def.sub(result)}</span>
            ) : null}
          </p>
        </section>
      )}

      <section className="mi">
        <h3 className="mi__h">Healthy ranges</h3>
        <table className="mi__bands">
          <tbody>
            {def.bands.map((b) => (
              <tr key={b.range}>
                <td className="mi__range">{b.range}</td>
                <td>{b.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mi">
        <h3 className="mi__h">Why it matters</h3>
        <p>{def.why}</p>
      </section>

      {samples && (
        <section className="mi">
          <h3 className="mi__h">Raw samples</h3>
          <SampleStrip samples={samples.values} unit={samples.unit} />
          <p className="mi__caption">
            {samples.caption} · {samples.values.length} samples
          </p>
        </section>
      )}

      {result && (
        <section className="mi">
          <h3 className="mi__h">Recommended next action</h3>
          <p>{def.action(result)}</p>
        </section>
      )}
    </Modal>
  );
}

function SampleStrip({ samples, unit }: { samples: number[]; unit: string }) {
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  return (
    <div>
      <div className="mini-bars" aria-hidden="true">
        {samples.map((v, i) => (
          <span
            key={i}
            className="mini-bar"
            style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
            title={`${v >= 100 ? Math.round(v) : v.toFixed(1)} ${unit}`}
          />
        ))}
      </div>
      <div className="mi__minmax">
        min {min >= 100 ? Math.round(min) : min.toFixed(1)} · max {max >= 100 ? Math.round(max) : max.toFixed(1)} {unit}
      </div>
    </div>
  );
}

/** Transparent breakdown of the health score, straight from scoring.ts. */
export function ScoreDetail({
  score,
  parts,
  onClose,
}: {
  score: number;
  parts: ScorePart[];
  onClose: () => void;
}) {
  return (
    <Modal title={`Health score — ${score}/100`} onClose={onClose}>
      <p className="mi__intro">
        The score is the sum of six weighted components, each computed from measured data only.
        The formula is defined in one documented file (<code>src/lib/scoring.ts</code>) — this
        panel renders it directly.
      </p>
      <table className="score-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Measured input</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.id}>
              <td>
                <div className="score-table__label">{p.label}</div>
                <div className="score-table__rule">{p.rule}</div>
              </td>
              <td className="score-table__input">{p.input}</td>
              <td className="num">
                <div className="score-table__pts">
                  {p.earned} <span className="score-table__weight">/ {p.weight}</span>
                </div>
                <div className="score-bar">
                  <span className="score-bar__fill" style={{ width: `${(p.earned / p.weight) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

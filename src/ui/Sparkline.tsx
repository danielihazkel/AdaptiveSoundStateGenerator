/**
 * A single-series sparkline: one 2 px line in the accent, a recessive
 * baseline, a marker on the latest point, and a hover target per point that
 * names its value. Text stays in text tokens — the line carries identity.
 * Values are expected in 0..1 (session quality scores).
 */
export function Sparkline(props: {
  values: readonly number[];
  /** Accessible description of the series (direction, count). */
  label: string;
  /** Per-point tooltip text; index-aligned with `values`. */
  titles?: readonly string[];
  width?: number;
  height?: number;
}) {
  const width = props.width ?? 160;
  const height = props.height ?? 36;
  const pad = 4;
  const n = props.values.length;
  if (n === 0) return null;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i / (n - 1)) * (width - 2 * pad));
  const y = (v: number) => pad + (1 - Math.min(1, Math.max(0, v))) * (height - 2 * pad);
  const path = props.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = props.values[n - 1];
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={props.label}
    >
      <line className="sparkline-baseline" x1={pad} x2={width - pad} y1={y(0.5)} y2={y(0.5)} />
      <polyline className="sparkline-line" points={path} />
      <circle className="sparkline-last" cx={x(n - 1)} cy={y(last)} r={3} />
      {props.titles &&
        props.values.map((v, i) => (
          <circle key={i} className="sparkline-hit" cx={x(i)} cy={y(v)} r={7}>
            <title>{props.titles![i]}</title>
          </circle>
        ))}
    </svg>
  );
}

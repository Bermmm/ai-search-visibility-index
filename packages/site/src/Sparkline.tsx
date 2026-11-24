/** Tiny inline trend line for a brand's score over the published weeks (0–100 scale). */
export function Sparkline({ values }: { values: Array<number | null> }) {
  const width = 96;
  const height = 24;
  const recent = values.slice(-12);
  const points = recent
    .map((v, i) => (v === null ? null : { x: recent.length === 1 ? width / 2 : (i / (recent.length - 1)) * width, v }))
    .filter((p): p is { x: number; v: number } => p !== null)
    .map((p) => `${p.x.toFixed(1)},${(height - 2 - (p.v / 100) * (height - 4)).toFixed(1)}`);

  if (points.length < 2) return <span className="muted small">—</span>;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

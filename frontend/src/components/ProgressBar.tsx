interface Props {
  value: number;
  max: number;
}

export function ProgressBar({ value, max }: Props) {
  if (max <= 0) return <div className="muted" style={{ fontSize: 12 }}>без лимита</div>;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color = pct < 70 ? "green" : pct < 90 ? "yellow" : "red";
  return (
    <div>
      <div className={`progress ${color}`}>
        <div className="bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        {value.toLocaleString("ru-RU")} / {max.toLocaleString("ru-RU")} сом ({Math.round(pct)}%)
      </div>
    </div>
  );
}

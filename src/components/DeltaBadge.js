'use client';

export default function DeltaBadge({ current, previous }) {
  if (!previous || previous === 0) return null;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return null;
  const isUp = pct > 0;
  return (
    <span className={`text-xs font-medium ml-1.5 ${isUp ? 'text-green-600' : 'text-red-600'}`}>
      {isUp ? '↑' : '↓'}{Math.abs(pct)}%
    </span>
  );
}

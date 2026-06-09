import type { VolumeProfileResult } from '../api/types';

export function VolumeProfileOverlay({
  profile, priceToY, width, maxBarWidth = 130,
}: {
  profile: VolumeProfileResult;
  priceToY: (price: number) => number | null;
  width: number;
  maxBarWidth?: number;
}) {
  if (!profile.rows.length || width === 0) return null;
  const maxVol = Math.max(...profile.rows.map((r) => r.volume)) || 1;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {profile.rows.map((row, i) => {
        const yTop = priceToY(row.priceHigh);
        const yBot = priceToY(row.priceLow);
        if (yTop == null || yBot == null) return null;
        const h = Math.max(1, yBot - yTop - 1);
        const w = (row.volume / maxVol) * maxBarWidth;
        const inVA = row.priceLow >= profile.valueArea.low && row.priceHigh <= profile.valueArea.high;
        const isPoc = profile.poc >= row.priceLow && profile.poc < row.priceHigh;
        return (
          <rect
            key={i}
            x={width - w}
            y={yTop}
            width={w}
            height={h}
            fill={isPoc ? '#3b82f6' : inVA ? 'rgba(59,130,246,0.45)' : 'rgba(100,116,139,0.35)'}
          />
        );
      })}
    </svg>
  );
}

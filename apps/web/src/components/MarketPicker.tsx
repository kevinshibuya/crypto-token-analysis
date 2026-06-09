import { useMemo, useState } from 'react';
import type { Market } from '../api/types';

export function MarketPicker({
  markets, value, onChange,
}: { markets: Market[]; value: string; onChange: (c: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () => markets.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50),
    [markets, query],
  );
  return (
    <div className="relative">
      <input
        className="w-40 rounded bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none"
        placeholder="Search market…"
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-40 overflow-auto rounded bg-slate-900 shadow-lg">
          {filtered.map((m) => (
            <li key={m.name}>
              <button
                className="block w-full px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-700"
                onMouseDown={() => { onChange(m.name); setOpen(false); }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { SUPPORTED_INTERVALS } from '../intervals';

export function TimeframePills({ value, onChange }: { value: string; onChange: (i: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {SUPPORTED_INTERVALS.map((i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`rounded px-2 py-1 text-xs ${
            i === value ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

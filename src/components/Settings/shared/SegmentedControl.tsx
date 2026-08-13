interface Props {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

export function SegmentedControl({ options, value, onChange }: Props) {
  return (
    <div className="flex gap-0.5 rounded-[9px] border border-border bg-bg-secondary p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13px] transition-colors ${
            value === opt.value
              ? 'bg-bg-elevated font-medium text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary bg-transparent'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

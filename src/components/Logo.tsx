export function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-special-elite text-3xl font-normal tracking-tight ${className}`}
      aria-label="Spindex"
    >
      Spin
      <span className="text-orange-500">dex</span>
    </span>
  )
}

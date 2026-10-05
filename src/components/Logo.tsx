export function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-space-grotesk text-3xl font-bold tracking-tighter ${className}`}
      aria-label="Spindex"
    >
      Spin<span className="text-orange-500">dex</span>
    </span>
  )
}

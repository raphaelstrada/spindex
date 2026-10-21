import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ALL, EMPTY_FILTERS, storeMonoLabel, useStorefrontLanguage, type CatalogFilterOptions, type CatalogFilterValues } from '@/lib/storefront'
import { cn } from '@/lib/utils'

type CatalogFiltersProps = {
  values: CatalogFilterValues
  options: CatalogFilterOptions
  onChange: (values: CatalogFilterValues) => void
}

const fieldClass = 'h-11 rounded-none border-store-line bg-white text-store-ink focus:ring-store-ink focus-visible:ring-store-ink'

function FilterSelect({ id, label, value, options, onChange }: { id: string, label: string, value: string, options: string[], onChange: (value: string) => void }) {
  const { t } = useStorefrontLanguage()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={cn(storeMonoLabel, 'text-store-muted')}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={fieldClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t.all}</SelectItem>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function CatalogFilters({ values, options, onChange }: CatalogFiltersProps) {
  const { t } = useStorefrontLanguage()
  const set = (key: keyof CatalogFilterValues) => (value: string) => onChange({ ...values, [key]: value })
  const isFiltered = values.artist.trim() !== '' || values.genre !== ALL || values.year !== ALL || values.condition !== ALL || values.owner !== ALL

  return (
    <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
      <div className="col-span-2 space-y-1.5 md:col-span-1">
        <Label htmlFor="filter-artist" className={cn(storeMonoLabel, 'text-store-muted')}>{t.searchArtist}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-store-muted" aria-hidden="true" />
          <Input
            id="filter-artist"
            type="search"
            value={values.artist}
            placeholder={t.searchArtistPlaceholder}
            onChange={(event) => set('artist')(event.target.value)}
            className={cn(fieldClass, 'pl-9')}
          />
        </div>
      </div>
      <FilterSelect id="filter-genre" label={t.genre} value={values.genre} options={options.genres} onChange={set('genre')} />
      <FilterSelect id="filter-year" label={t.year} value={values.year} options={options.years} onChange={set('year')} />
      <FilterSelect id="filter-condition" label={t.condition} value={values.condition} options={options.conditions} onChange={set('condition')} />
      <FilterSelect id="filter-owner" label={t.owner} value={values.owner} options={options.owners} onChange={set('owner')} />
      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        disabled={!isFiltered}
        className={cn(storeMonoLabel, 'col-span-2 h-11 underline underline-offset-4 disabled:no-underline disabled:opacity-40 md:col-span-1 md:px-2', 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-ink')}
      >
        {t.clearFilters}
      </button>
    </div>
  )
}

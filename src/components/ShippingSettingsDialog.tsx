import { useState, type FormEvent } from 'react'
import { Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translations, type Language } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

type ShippingForm = {
  base_cad: string
  included_items: string
  additional_item_cad: string
  free_over_cad: string
}

const FIELDS = [
  { key: 'base_cad', label: 'baseCad', step: '0.01' },
  { key: 'included_items', label: 'includedItems', step: '1' },
  { key: 'additional_item_cad', label: 'additionalItemCad', step: '0.01' },
  { key: 'free_over_cad', label: 'freeOverCad', step: '0.01' },
] as const

// Edits the single shipping_settings row (RLS: admins only). The rule itself lives in the shipping_cad SQL function.
export function ShippingSettingsDialog({ language }: { language: Language }) {
  const t = translations[language].shop
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ShippingForm | null>(null)
  const [status, setStatus] = useState<'idle' | 'loadError' | 'saving' | 'saved' | 'saveError'>('idle')

  async function load() {
    setForm(null)
    setStatus('idle')
    const { data, error } = await supabase
      .from('shipping_settings')
      .select('base_cad, included_items, additional_item_cad, free_over_cad')
      .eq('id', 1)
      .single()
    if (error || !data) {
      console.error('Failed to load shipping settings', error)
      setStatus('loadError')
      return
    }
    setForm({
      base_cad: String(data.base_cad),
      included_items: String(data.included_items),
      additional_item_cad: String(data.additional_item_cad),
      free_over_cad: data.free_over_cad === null ? '' : String(data.free_over_cad),
    })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setStatus('saving')
    const { error } = await supabase
      .from('shipping_settings')
      .update({
        base_cad: Number(form.base_cad),
        included_items: Number(form.included_items),
        additional_item_cad: Number(form.additional_item_cad),
        free_over_cad: form.free_over_cad.trim() === '' ? null : Number(form.free_over_cad),
      })
      .eq('id', 1)
    if (error) console.error('Failed to save shipping settings', error)
    setStatus(error ? 'saveError' : 'saved')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) void load()
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Truck aria-hidden="true" />
          {t.shippingSettings}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.shippingSettingsTitle}</DialogTitle>
          <DialogDescription>{t.shippingSettingsDescription}</DialogDescription>
        </DialogHeader>
        {status === 'loadError' ? (
          <p role="alert" className="text-sm text-destructive">{t.loadError}</p>
        ) : !form ? (
          <p role="status" className="text-sm text-muted-foreground">{t.loading}</p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`shipping-${field.key}`}>{t[field.label]}</Label>
                <Input
                  id={`shipping-${field.key}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step={field.step}
                  required={field.key !== 'free_over_cad'}
                  value={form[field.key]}
                  onChange={(event) => {
                    setForm({ ...form, [field.key]: event.target.value })
                    setStatus('idle')
                  }}
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={status === 'saving'}>{status === 'saving' ? t.saving : t.save}</Button>
              <span role="status" className="text-sm text-muted-foreground">
                {status === 'saved' ? t.saved : status === 'saveError' ? t.saveError : ''}
              </span>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

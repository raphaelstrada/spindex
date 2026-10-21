import { useState } from 'react'
import { Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { translations, type Language } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

type Order = {
  id: string
  created_at: string
  email: string | null
  shipping: { name?: string | null, address?: Record<string, string | null> | null } | null
  total_cents: number | null
  currency: string | null
  record_ids: string[] | null
  status: string | null
}

type RecordName = { id: string, artist: string | null, title: string | null }

function formatAddress(shipping: Order['shipping']) {
  const address = shipping?.address
  return [
    shipping?.name,
    address?.line1,
    address?.line2,
    [address?.city, address?.state, address?.postal_code].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
}

// Read-only. RLS returns only orders that contain at least one of this admin's records, and the
// record lookup only resolves this admin's own records.
export function OrdersDialog({ language }: { language: Language }) {
  const t = translations[language].shop
  const [open, setOpen] = useState(false)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [names, setNames] = useState<Map<string, RecordName>>(new Map())
  const [failed, setFailed] = useState(false)

  async function load() {
    setOrders(null)
    setFailed(false)
    const { data, error } = await supabase
      .from('orders')
      .select('id, created_at, email, shipping, total_cents, currency, record_ids, status')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Failed to load orders', error)
      setFailed(true)
      return
    }
    const loaded = (data ?? []) as Order[]
    const ids = [...new Set(loaded.flatMap((order) => order.record_ids ?? []))]
    if (ids.length > 0) {
      const { data: records, error: recordsError } = await supabase.from('vinyl_records').select('id, artist, title').in('id', ids)
      if (recordsError) console.error('Failed to load order records', recordsError)
      setNames(new Map(((records ?? []) as RecordName[]).map((record) => [record.id, record])))
    }
    setOrders(loaded)
  }

  const dateFormat = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' })
  const formatTotal = (order: Order) => order.total_cents === null ? '' : new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en-CA', {
    style: 'currency',
    currency: (order.currency ?? 'cad').toUpperCase(),
  }).format(order.total_cents / 100)

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) void load()
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Receipt aria-hidden="true" />
          {t.orders}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t.ordersTitle}</DialogTitle>
        </DialogHeader>
        {failed ? (
          <p role="alert" className="text-sm text-destructive">{t.loadError}</p>
        ) : !orders ? (
          <p role="status" className="text-sm text-muted-foreground">{t.loading}</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noOrders}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.date}</TableHead>
                <TableHead>{t.customer}</TableHead>
                <TableHead>{t.records}</TableHead>
                <TableHead>{t.shipTo}</TableHead>
                <TableHead className="text-right">{t.total}</TableHead>
                <TableHead>{t.status}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="whitespace-nowrap">{dateFormat.format(new Date(order.created_at))}</TableCell>
                  <TableCell>{order.email}</TableCell>
                  <TableCell>
                    <ul className="space-y-1">
                      {(order.record_ids ?? []).map((id) => {
                        const record = names.get(id)
                        return (
                          <li key={id} className={record ? undefined : 'text-muted-foreground'}>
                            {record ? `${record.artist ?? ''}: ${record.title ?? ''}` : t.otherOwnerRecord}
                          </li>
                        )
                      })}
                    </ul>
                  </TableCell>
                  <TableCell>{formatAddress(order.shipping)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatTotal(order)}</TableCell>
                  <TableCell className={order.status === 'needs_review' ? 'font-medium text-destructive' : undefined}>
                    {order.status === 'needs_review' ? t.statusNeedsReview : t.statusPaid}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Fills vinyl_records.catalog_number from Discogs for records that have a discogs_link.
// Usage: node scripts/backfill-catno.js
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ws from 'ws'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const { data: records, error } = await supabase
  .from('vinyl_records')
  .select('id, discogs_link')
  .eq('collection_owner', 'Raphael')
  .not('discogs_link', 'is', null)
  .neq('discogs_link', '')
  .is('catalog_number', null)
if (error) throw error

let updated = 0
const failed = []
for (const record of records) {
  const { data, error: fnError } = await supabase.functions.invoke('discogs-search', {
    body: { releaseUrl: record.discogs_link },
  })
  const catno = data?.results?.[0]?.catalogNumber
  if (fnError || !catno) {
    failed.push(record.id)
  } else {
    const { error: updateError } = await supabase.from('vinyl_records').update({ catalog_number: catno }).eq('id', record.id)
    if (updateError) failed.push(record.id)
    else updated++
  }
  await delay(1100) // Discogs rate limit: 60 req/min
}

console.log(`Total: ${records.length} | updated: ${updated} | failed: ${failed.length}`)
if (failed.length) console.log('Failed ids:', failed.join(','))

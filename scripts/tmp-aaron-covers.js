// TEMPORARY: fills image_url for Aaron's records from a Discogs search by artist + title. Delete after use.
// Only image_url changes, never discogs_link, so no pressing is claimed. Records that already have a cover
// are left alone, so running it again just retries the ones still missing.
// Usage: node scripts/tmp-aaron-covers.js --test   (first 15 records, saves nothing)
//        node scripts/tmp-aaron-covers.js
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ws from 'ws'

dotenv.config({ path: '.env.local' })

const EMAIL = 'raphaelstrada@gmail.com'
const OWNER = 'Aaron'
const TEST_LIMIT = 15
const REQUEST_INTERVAL_MS = 2000 // One search can use several Discogs pages (60 requests/min).
const RATE_LIMIT_WAIT_MS = 60000
const MAX_RATE_LIMIT_RETRIES = 3

const testRun = process.argv.includes('--test')
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Same rule as normalizeMatchText in src/lib/record.ts, plus the "(2)" Discogs adds to duplicate artist names.
function normalize(value) {
  return value
    .replace(/\s*\(\d+\)\s*$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function askPassword() {
  // terminal: false, otherwise readline echoes the keys itself and stty -echo hides nothing.
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  execSync('stty -echo', { stdio: 'inherit' })
  try {
    return await prompt.question(`Password for ${EMAIL}: `)
  } finally {
    execSync('stty echo', { stdio: 'inherit' })
    prompt.close()
    console.log()
  }
}

async function search(record) {
  for (let retries = 0; ; retries++) {
    const { data, error } = await supabase.functions.invoke('discogs-search', {
      body: { artist: record.artist, title: record.title },
    })
    if (!error) return data?.results ?? []
    if (error.context?.status !== 429 || retries === MAX_RATE_LIMIT_RETRIES) {
      const body = await error.context?.text?.().catch(() => '')
      throw new Error(`HTTP ${error.context?.status}: ${body || error.message}`)
    }
    console.log('  Discogs rate limit, waiting 60s...')
    await delay(RATE_LIMIT_WAIT_MS)
  }
}

// Exact artist + title only. LPs first, so a 7" with the same name does not lend its sleeve to the album.
function pickCover(record, releases) {
  const artist = normalize(record.artist ?? '')
  const title = normalize(record.title ?? '')
  if (!artist || !title) return null
  const matches = releases.filter((release) => (
    normalize(release.artist) === artist
    && normalize(release.releaseTitle) === title
    && release.coverImage
    && !release.coverImage.includes('spacer.gif')
  ))
  return (matches.find((release) => release.recordType === 'LP') ?? matches[0])?.coverImage ?? null
}

const { error: authError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: await askPassword() })
if (authError) throw authError

const { data: admin, error: adminError } = await supabase.from('admins').select('collection_owner').maybeSingle()
if (adminError) throw adminError
if (admin?.collection_owner !== OWNER) throw new Error(`${EMAIL} is not the ${OWNER} admin.`)

const { data: allRecords, error } = await supabase
  .from('vinyl_records')
  .select('id, artist, title')
  .eq('collection_owner', OWNER)
  .is('image_url', null)
  .order('artist')
if (error) throw error

const records = testRun ? allRecords.slice(0, TEST_LIMIT) : allRecords
const noMatch = []
const failed = []
let updated = 0

for (const [index, record] of records.entries()) {
  const label = `${record.artist} - ${record.title}`
  const startedAt = Date.now()
  try {
    const cover = pickCover(record, await search(record))
    if (!cover) {
      noMatch.push(label)
      console.log(`${index + 1}/${records.length} no match: ${label}`)
    } else if (testRun) {
      updated++
      console.log(`${index + 1}/${records.length} would save: ${label}\n  ${cover}`)
    } else {
      const { data, error: updateError } = await supabase
        .from('vinyl_records')
        .update({ image_url: cover })
        .eq('id', record.id)
        .is('image_url', null)
        .select('id')
      if (updateError) throw updateError
      if (data.length !== 1) throw new Error('No row updated')
      updated++
      console.log(`${index + 1}/${records.length} saved: ${label}`)
    }
  } catch (recordError) {
    failed.push(label)
    console.log(`${index + 1}/${records.length} FAILED: ${label} (${recordError.message})`)
  }
  await delay(Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - startedAt)))
}

console.log(`\nTotal: ${records.length} | ${testRun ? 'would save' : 'saved'}: ${updated} | no match: ${noMatch.length} | failed: ${failed.length}`)
if (noMatch.length) console.log(`\nNo match:\n${noMatch.join('\n')}`)
if (failed.length) console.log(`\nFailed:\n${failed.join('\n')}`)
process.exit(0)

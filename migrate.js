import fs from 'fs'
import csv from 'csv-parser'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ws from 'ws'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false },
    realtime: { transport: ws } // Injects native WebSocket for Node 20 compatibility
  }
)

const CONSUMER_KEY = 'RCIDQQLSHEVlZPqDlrQE'
const CONSUMER_SECRET = 'hwPOiafTpwRcgxrjKDdGcxbDTYuVNPan'
const CSV_FILE = 'marketplace_inventory.csv'
const TARGET_OWNER = 'Tim' 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const authHeaders = { 
  'User-Agent': 'VinylCatalogApp/1.0',
  'Authorization': `Discogs key=${CONSUMER_KEY}, secret=${CONSUMER_SECRET}`
}

async function fetchDiscogsData(artist, title) {
  const query = encodeURIComponent(`${artist} ${title}`)
  const url = `https://api.discogs.com/database/search?q=${query}&type=release`
  try {
    const response = await fetch(url, { headers: authHeaders })
    if (!response.ok) return null
    const data = await response.json()
    return data.results?.length > 0 ? data.results[0] : null
  } catch (error) {
    return null
  }
}

async function fetchDiscogsPrice(releaseId) {
  const url = `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=USD`
  try {
    const response = await fetch(url, { headers: authHeaders })
    if (!response.ok) return null
    const data = await response.json()
    return data.lowest_price?.value || null
  } catch (error) {
    return null
  }
}

async function processInventory() {
  const records = []
  
  await new Promise((resolve) => {
    fs.createReadStream(CSV_FILE)
      .pipe(csv({
        // Sanitize headers by removing invisible BOM characters and quotes
        mapHeaders: ({ header }) => header.replace(/^[\uFEFF\xA0]+/, '').replace(/"/g, '').trim()
      }))
      .on('data', (data) => records.push(data))
      .on('end', resolve)
  })



  console.log(`Starting migration for ${records.length} records. Target Collection: ${TARGET_OWNER}...`)

  for (let i = 0; i < records.length; i++) {
    const row = records[i]
    
    const artist = row.artist ? row.artist.trim() : 'Unknown Artist'
    const title = row.album_name ? row.album_name.trim() : 'Unknown Title'
    const price = parseFloat(row.price?.replace(/[^0-9.-]+/g,"")) || null
    
    // 1. IDEMPOTENCY CHECK: Skip if record already exists in Supabase
    const { data: existingRecord } = await supabase
      .from('vinyl_records')
      .select('id')
      .eq('artist', artist)
      .eq('title', title)
      .eq('collection_owner', TARGET_OWNER)
      .maybeSingle()

    if (existingRecord) {
      console.log(`[${i + 1}/${records.length}] ⏭️ Skipped (Already in DB): ${artist} - ${title}`)
      continue 
    }

    console.log(`[${i + 1}/${records.length}] 🔍 Fetching from Discogs: ${artist} - ${title}`)
    
    const payload = {
      artist,
      title,
      price,
      source_url: row.source_url,
      collection_owner: TARGET_OWNER,
      sold: false,
      sell_possibility: true,
      
      // Default fallback values to bypass strict SQL CHECK constraints
      record_type: 'LP',
      record_size: '12"',
      media_condition: 'VG+',
      sleeve_condition: 'VG+',
      is_original: true,
      is_special_edition: false
    }

    // 2. Fetch Core Metadata
    const discogsData = await fetchDiscogsData(artist, title)

    if (discogsData) {
      payload.image_url = discogsData.cover_image
      payload.year_pressed = discogsData.year ? parseInt(discogsData.year) : null
      payload.genre = discogsData.genre ? discogsData.genre[0] : null
      payload.sub_genre = discogsData.style ? discogsData.style[0] : null
      payload.country_pressed = discogsData.country || null
      payload.record_label = discogsData.label ? discogsData.label[0] : null
      payload.discogs_link = `https://www.discogs.com${discogsData.uri}`
      
      // 3. Fetch Lowest Market Price
      if (discogsData.id) {
        const lowestPrice = await fetchDiscogsPrice(discogsData.id)
        payload.discogs_lowest_price = lowestPrice
      }
    }

    // 4. Insert payload into Supabase
    const { error } = await supabase.from('vinyl_records').insert([payload])
    
    if (error) {
        console.error(`❌ Supabase Error inserting ${title}:`, error.message)
    } else {
        console.log(`✅ Saved: ${title} ${payload.discogs_lowest_price ? `($${payload.discogs_lowest_price})` : ''}`)
    }

    // 2.2s timeout to safely accommodate two Discogs API calls per loop
    await delay(2200)
  }
  
  console.log("Migration complete!")
}

processInventory()

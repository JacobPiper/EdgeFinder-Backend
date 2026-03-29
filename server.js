const express = require('express')
const cors    = require('cors')
const axios   = require('axios')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

const SCRAPER_KEY = process.env.SCRAPER_API_KEY || '026b8a23d57e209afb4913b7ce511dfc'

let udCache = null
let udFetchedAt = null
const TTL = 6 * 60 * 1000

async function fetchUnderdog() {
  try {
    console.log('[Underdog] Fetching via ScraperAPI...')
    
    const targetUrl = 'https://api.underdogfantasy.com/v1/over_under_lines'
    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}`
    
    const res = await axios.get(scraperUrl, { timeout: 60000 })
    
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
    
    const players = {}, appearances = {}
    for (const p of data.players || []) {
      players[p.id] = { name: `${p.first_name} ${p.last_name}`.trim(), team: p.team_name || '' }
    }
    for (const a of data.appearances || []) {
      appearances[a.id] = {
        playerId: a.player_id,
        league: (a.sport_id || '').toUpperCase(),
        matchup: a.match_title || '',
        gameTime: a.scheduled_at || '',
      }
    }

    const lines = (data.over_under_lines || []).map(line => {
      const opt = line.options?.[0]
      if (!opt) return null
      const ap = appearances[line.appearance_stat?.appearance_id] || {}
      const pl = players[ap.playerId] || {}
      return {
        book: 'Underdog',
        player: pl.name || 'Unknown',
        team: pl.team || '',
        league: ap.league || 'Unknown',
        stat: line.appearance_stat?.display_stat || '',
        line: parseFloat(opt.over_under || 0),
        odds: -110,
        matchup: ap.matchup || '',
        gameTime: ap.gameTime || new Date().toISOString(),
      }
    }).filter(l => l && !isNaN(l.line) && l.line > 0)

    udCache = lines
    udFetchedAt = Date.now()
    console.log(`[Underdog] ${lines.length} lines cached`)
    return lines
  } catch(e) {
    console.error('[Underdog] Error:', e.message)
    return udCache || []
  }
}

app.get('/', (req, res) => res.json({ status: 'ok', underdog: udCache?.length || 0 }))

app.get('/api/lines', async (req, res) => {
  try {
    if (!udFetchedAt || Date.now() - udFetchedAt > TTL) await fetchUnderdog()
    res.json({ success: true, count: udCache?.length || 0, lines: udCache || [], fetchedAt: new Date().toISOString() })
  } catch(e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

app.get('/api/status', (req, res) => res.json({
  underdog: udCache?.length || 0,
  fetchedAt: udFetchedAt ? new Date(udFetchedAt).toISOString() : null
}))

app.post('/api/refresh', async (req, res) => {
  await fetchUnderdog()
  res.json({ success: true, count: udCache?.length || 0 })
})

app.listen(PORT, async () => {
  console.log(`EdgeFinder running on port ${PORT}`)
  await fetchUnderdog()
  console.log('Ready.')
})

setInterval(fetchUnderdog, TTL)

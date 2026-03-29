const express = require('express')
const cors    = require('cors')
const axios   = require('axios')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

let udCache = null
let udFetchedAt = null
const TTL = 6 * 60 * 1000
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchUnderdog() {
  try {
    console.log('[Underdog] Fetching...')
    await sleep(3000)
    const res = await axios.get('https://api.underdogfantasy.com/v1/over_under_lines', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json',
        'Referer': 'https://underdogfantasy.com/pick-em',
        'Origin': 'https://underdogfantasy.com',
      },
      timeout: 20000,
    })
    const players = {}, appearances = {}
    for (const p of res.data.players || []) {
      players[p.id] = { name: `${p.first_name} ${p.last_name}`.trim(), team: p.team_name || '' }
    }
    for (const a of res.data.appearances || []) {
      appearances[a.id] = { playerId: a.player_id, league: (a.sport_id||'').toUpperCase(), matchup: a.match_title||'', gameTime: a.scheduled_at||'' }
    }
    const lines = (res.data.over_under_lines || []).map(line => {
      const opt = line.options?.[0]
      if (!opt) return null
      const ap = appearances[line.appearance_stat?.appearance_id] || {}
      const pl = players[ap.playerId] || {}
      return { book:'Underdog', player: pl.name||'Unknown', team: pl.team||'', league: ap.league||'Unknown', stat: line.appearance_stat?.display_stat||'', line: parseFloat(opt.over_under||0), odds:-110, matchup: ap.matchup||'', gameTime: ap.gameTime||new Date().toISOString() }
    }).filter(l => l && !isNaN(l.line) && l.line > 0)
    udCache = lines
    udFetchedAt = Date.now()
    console.log(`[Underdog] ${lines.length} lines cached`)
    return lines
  } catch(e) {
    console.error('[Underdog] Error:', e.response?.status, e.message)
    return udCache || []
  }
}

app.get('/', (req, res) => res.json({ status:'ok', underdog: udCache?.length||0 }))

app.get('/api/lines', async (req, res) => {
  try {
    if (!udFetchedAt || Date.now() - udFetchedAt > TTL) await fetchUnderdog()
    res.json({ success:true, count: udCache?.length||0, lines: udCache||[], fetchedAt: new Date().toISOString() })
  } catch(e) { res.status(500).json({ success:false, error:e.message }) }
})

app.get('/api/status', (req, res) => res.json({ underdog: udCache?.length||0, fetchedAt: udFetchedAt ? new Date(udFetchedAt).toISOString() : null }))

app.post('/api/refresh', async (req, res) => {
  await fetchUnderdog()
  res.json({ success:true, count: udCache?.length||0 })
})

app.listen(PORT, async () => {
  console.log(`EdgeFinder running on port ${PORT}`)
  await fetchUnderdog()
  console.log('Ready.')
})

setInterval(fetchUnderdog, TTL)

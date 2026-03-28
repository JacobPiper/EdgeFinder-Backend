const express = require('express')
const cors    = require('cors')
const axios   = require('axios')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'a5f2fc77fd1ae5479ddcdacafb418b28'

let cache = { data: null, fetchedAt: null }
const TTL = 5 * 60 * 1000

async function fetchAllLines() {
  console.log('[OddsAPI] Fetching...')
  const SPORTS  = ['americanfootball_nfl','basketball_nba','baseball_mlb','icehockey_nhl']
  const BOOKS   = ['draftkings','fanduel','betmgm','bovada']
  const MARKETS = 'player_points,player_rebounds,player_assists,player_threes,player_passing_yards,player_rushing_yards,player_receiving_yards,player_receptions,player_strikeouts'

  const allLines = []

  for (const sport of SPORTS) {
    try {
      const eventsRes = await axios.get(
        `https://api.the-odds-api.com/v4/sports/${sport}/events`,
        { params: { apiKey: ODDS_API_KEY }, timeout: 10000 }
      )
      const events = (eventsRes.data || []).slice(0, 5)

      for (const event of events) {
        try {
          const res = await axios.get(
            `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`,
            {
              params: {
                apiKey: ODDS_API_KEY,
                regions: 'us',
                markets: MARKETS,
                bookmakers: BOOKS.join(','),
                oddsFormat: 'american',
              },
              timeout: 10000,
            }
          )

          const matchup  = `${event.away_team} vs ${event.home_team}`
          const gameTime = event.commence_time
          const league   = sport.includes('nfl') ? 'NFL'
            : sport.includes('nba') ? 'NBA'
            : sport.includes('mlb') ? 'MLB' : 'NHL'

          for (const bm of res.data?.bookmakers || []) {
            const book = bm.key === 'draftkings' ? 'DraftKings'
              : bm.key === 'fanduel' ? 'FanDuel'
              : bm.key === 'betmgm' ? 'BetMGM'
              : bm.title

            for (const market of bm.markets || []) {
              const stat = market.key.replace('player_','').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
              for (const o of market.outcomes || []) {
                if (o.name === 'Over') {
                  allLines.push({
                    book,
                    player: o.description || '',
                    team: '',
                    league,
                    stat,
                    line: parseFloat(o.point || 0),
                    odds: o.price || -110,
                    matchup,
                    gameTime,
                  })
                }
              }
            }
          }
        } catch(e) { console.error('event err:', e.message) }
      }
    } catch(e) { console.error('sport err:', e.message) }
  }

  cache = { data: allLines, fetchedAt: Date.now() }
  console.log(`[OddsAPI] ${allLines.length} lines cached`)
  return allLines
}

app.get('/', (req, res) => res.json({ status:'ok', count: cache.data?.length || 0 }))

app.get('/api/lines', async (req, res) => {
  try {
    if (!cache.data || Date.now() - cache.fetchedAt > TTL) await fetchAllLines()
    res.json({ success: true, count: cache.data.length, lines: cache.data, fetchedAt: new Date().toISOString() })
  } catch(e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

app.get('/api/status', (req, res) => {
  res.json({ count: cache.data?.length || 0, fetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null })
})

app.post('/api/refresh', async (req, res) => {
  await fetchAllLines()
  res.json({ success: true, count: cache.data?.length || 0 })
})

app.listen(PORT, async () => {
  console.log(`EdgeFinder running on port ${PORT}`)
  await fetchAllLines()
  console.log('Ready.')
})

setInterval(fetchAllLines, TTL)

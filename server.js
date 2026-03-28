const express = require('express')
const cors    = require('cors')
const axios   = require('axios')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

const ODDS_API_KEY = process.env.ODDS_API_KEY || 'a5f2fc77fd1ae5479ddcdacafb418b28'

const cache = {
  prizepicks: { data: null, fetchedAt: null },
  underdog:   { data: null, fetchedAt: null },
  sleeper:    { data: null, fetchedAt: null },
  betr:       { data: null, fetchedAt: null },
  oddsapi:    { data: null, fetchedAt: null },
}

const TTL = 5 * 60 * 1000

function fresh(source) {
  return cache[source].data !== null && Date.now() - cache[source].fetchedAt < TTL
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
}

// ── PRIZEPICKS ───────────────────────────────────────────────────────────────
async function fetchPrizePicks() {
  try {
    console.log('[PrizePicks] Fetching...')
    const res = await axios.get(
      'https://api.prizepicks.com/projections?per_page=250&single_stat=true&in_play=false',
      {
        headers: {
          ...BROWSER_HEADERS,
          'Referer': 'https://app.prizepicks.com/',
          'Origin': 'https://app.prizepicks.com',
          'X-Device-ID': 'web',
        },
        timeout: 15000
      }
    )

    const players = {}, leagues = {}
    for (const item of res.data.included || []) {
      if (item.type === 'new_player') {
        players[item.id] = {
          name: item.attributes.display_name || item.attributes.name,
          team: item.attributes.team || '',
        }
      }
      if (item.type === 'league') leagues[item.id] = item.attributes.name
    }

    const lines = (res.data.data || []).map(proj => {
      const attr   = proj.attributes
      const rels   = proj.relationships || {}
      const player = players[rels.new_player?.data?.id] || {}
      const league = leagues[rels.league?.data?.id] || attr.league || 'Unknown'
      return {
        book: 'PrizePicks',
        player: player.name || attr.description || 'Unknown',
        team: player.team || '',
        league,
        stat: attr.stat_type,
        line: parseFloat(attr.line_score),
        odds: -110,
        matchup: attr.description || '',
        gameTime: attr.start_time || new Date().toISOString(),
      }
    }).filter(l => !isNaN(l.line) && l.line > 0)

    cache.prizepicks = { data: lines, fetchedAt: Date.now() }
    console.log(`[PrizePicks] ${lines.length} lines cached`)
    return lines
  } catch (e) {
    console.error('[PrizePicks] Error:', e.message)
    return cache.prizepicks.data || []
  }
}

// ── UNDERDOG ─────────────────────────────────────────────────────────────────
async function fetchUnderdog() {
  try {
    console.log('[Underdog] Fetching...')
    const res = await axios.get(
      'https://api.underdogfantasy.com/v1/over_under_lines',
      { headers: { ...BROWSER_HEADERS, Referer: 'https://underdogfantasy.com/' }, timeout: 15000 }
    )

    const players = {}, appearances = {}
    for (const p of res.data.players || []) {
      players[p.id] = { name: `${p.first_name} ${p.last_name}`.trim(), team: p.team_name || '' }
    }
    for (const a of res.data.appearances || []) {
      appearances[a.id] = {
        playerId: a.player_id,
        league: (a.sport_id || '').toUpperCase(),
        matchup: a.match_title || '',
        gameTime: a.scheduled_at || ''
      }
    }

    const lines = (res.data.over_under_lines || []).map(line => {
      const opt        = line.options?.[0]
      if (!opt) return null
      const appearance = appearances[line.appearance_stat?.appearance_id] || {}
      const player     = players[appearance.playerId] || {}
      return {
        book: 'Underdog',
        player: player.name || 'Unknown',
        team: player.team || '',
        league: appearance.league || 'Unknown',
        stat: line.appearance_stat?.display_stat || '',
        line: parseFloat(opt.over_under || 0),
        odds: -110,
        matchup: appearance.matchup || '',
        gameTime: appearance.gameTime || new Date().toISOString(),
      }
    }).filter(l => l && !isNaN(l.line) && l.line > 0)

    cache.underdog = { data: lines, fetchedAt: Date.now() }
    console.log(`[Underdog] ${lines.length} lines cached`)
    return lines
  } catch (e) {
    console.error('[Underdog] Error:', e.message)
    return cache.underdog.data || []
  }
}

// ── SLEEPER ──────────────────────────────────────────────────────────────────
async function fetchSleeper() {
  try {
    console.log('[Sleeper] Fetching...')
    const res = await axios.get(
      'https://api.sleeper.com/lines/v1/props?status=open&sport=nfl,nba,mlb,nhl',
      { headers: BROWSER_HEADERS, timeout: 15000 }
    )

    const lines = (res.data || []).map(prop => ({
      book: 'Sleeper',
      player: prop.player_name || prop.display_name || 'Unknown',
      team: prop.team || '',
      league: (prop.sport || prop.league || 'Unknown').toUpperCase(),
      stat: prop.stat_type || prop.type || '',
      line: parseFloat(prop.line || prop.value || 0),
      odds: -110,
      matchup: prop.game_title || prop.matchup || '',
      gameTime: prop.start_time || prop.game_time || new Date().toISOString(),
    })).filter(l => !isNaN(l.line) && l.line > 0)

    cache.sleeper = { data: lines, fetchedAt: Date.now() }
    console.log(`[Sleeper] ${lines.length} lines cached`)
    return lines
  } catch (e) {
    console.error('[Sleeper] Error:', e.message)
    // Try alternate endpoint
    try {
      const res2 = await axios.get(
        'https://sleeper.com/lines/v1/props',
        { headers: BROWSER_HEADERS, timeout: 15000 }
      )
      const lines = (res2.data || []).map(prop => ({
        book: 'Sleeper',
        player: prop.player_name || 'Unknown',
        team: prop.team || '',
        league: (prop.sport || 'Unknown').toUpperCase(),
        stat: prop.stat_type || '',
        line: parseFloat(prop.line || 0),
        odds: -110,
        matchup: prop.game_title || '',
        gameTime: prop.start_time || new Date().toISOString(),
      })).filter(l => !isNaN(l.line) && l.line > 0)
      cache.sleeper = { data: lines, fetchedAt: Date.now() }
      console.log(`[Sleeper alt] ${lines.length} lines cached`)
      return lines
    } catch (e2) {
      console.error('[Sleeper alt] Error:', e2.message)
      return cache.sleeper.data || []
    }
  }
}

// ── BETR ─────────────────────────────────────────────────────────────────────
async function fetchBetr() {
  try {
    console.log('[Betr] Fetching...')
    // Try multiple known Betr endpoints
    const endpoints = [
      'https://api.betrapp.com/v1/props/open',
      'https://api.betrfantasy.com/v1/lines',
      'https://betrapp.com/api/v1/props',
    ]

    for (const url of endpoints) {
      try {
        const res = await axios.get(url, {
          headers: { ...BROWSER_HEADERS, Referer: 'https://betrapp.com/' },
          timeout: 8000
        })
        const data = res.data?.props || res.data?.lines || res.data || []
        if (Array.isArray(data) && data.length > 0) {
          const lines = data.map(prop => ({
            book: 'Betr',
            player: prop.player_name || prop.athlete_name || prop.name || 'Unknown',
            team: prop.team || '',
            league: (prop.league || prop.sport || 'Unknown').toUpperCase(),
            stat: prop.stat_type || prop.market || prop.type || '',
            line: parseFloat(prop.line || prop.value || prop.over_under || 0),
            odds: prop.odds || -110,
            matchup: prop.game || prop.matchup || prop.game_title || '',
            gameTime: prop.game_time || prop.start_time || new Date().toISOString(),
          })).filter(l => !isNaN(l.line) && l.line > 0)

          cache.betr = { data: lines, fetchedAt: Date.now() }
          console.log(`[Betr] ${lines.length} lines cached from ${url}`)
          return lines
        }
      } catch (err) {
        console.error(`[Betr] ${url} failed:`, err.message)
      }
    }

    cache.betr = { data: [], fetchedAt: Date.now() }
    return []
  } catch (e) {
    console.error('[Betr] Error:', e.message)
    return cache.betr.data || []
  }
}

// ── THE ODDS API (DraftKings, FanDuel, BetMGM) ───────────────────────────────
async function fetchOddsAPI() {
  try {
    console.log('[OddsAPI] Fetching player props...')

    const SPORTS = ['americanfootball_nfl', 'basketball_nba', 'baseball_mlb', 'icehockey_nhl']
    const BOOKS  = ['draftkings', 'fanduel', 'betmgm']
    const MARKETS = [
      'player_points', 'player_rebounds', 'player_assists', 'player_threes',
      'player_passing_yards', 'player_rushing_yards', 'player_receiving_yards',
      'player_receptions', 'player_strikeouts', 'player_hits'
    ].join(',')

    const allLines = []

    for (const sport of SPORTS) {
      try {
        const eventsRes = await axios.get(
          `https://api.the-odds-api.com/v4/sports/${sport}/events`,
          { params: { apiKey: ODDS_API_KEY }, timeout: 10000 }
        )

        const events = (eventsRes.data || []).slice(0, 4)

        for (const event of events) {
          try {
            const propsRes = await axios.get(
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

            for (const bookmaker of propsRes.data?.bookmakers || []) {
              const bookName = bookmaker.key === 'draftkings' ? 'DraftKings'
                : bookmaker.key === 'fanduel' ? 'FanDuel'
                : bookmaker.key === 'betmgm' ? 'BetMGM'
                : bookmaker.title

              for (const market of bookmaker.markets || []) {
                const statName = market.key
                  .replace('player_', '')
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, c => c.toUpperCase())

                for (const outcome of market.outcomes || []) {
                  if (outcome.name === 'Over') {
                    allLines.push({
                      book: bookName,
                      player: outcome.description || '',
                      team: '',
                      league,
                      stat: statName,
                      line: parseFloat(outcome.point || 0),
                      odds: outcome.price || -110,
                      matchup,
                      gameTime,
                    })
                  }
                }
              }
            }
          } catch (eventErr) {
            console.error(`[OddsAPI] event error:`, eventErr.message)
          }
        }
      } catch (sportErr) {
        console.error(`[OddsAPI] ${sport} error:`, sportErr.message)
      }
    }

    cache.oddsapi = { data: allLines, fetchedAt: Date.now() }
    console.log(`[OddsAPI] ${allLines.length} lines cached`)
    return allLines
  } catch (e) {
    console.error('[OddsAPI] Error:', e.message)
    return cache.oddsapi.data || []
  }
}

async function refreshAll() {
  console.log('--- Refreshing all sources ---')
  await Promise.allSettled([
    fetchPrizePicks(),
    fetchUnderdog(),
    fetchSleeper(),
    fetchBetr(),
    fetchOddsAPI(),
  ])
  console.log('--- Refresh complete ---')
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'EdgeFinder API',
    sources: {
      prizepicks: { count: cache.prizepicks.data?.length || 0, fresh: fresh('prizepicks') },
      underdog:   { count: cache.underdog.data?.length || 0,   fresh: fresh('underdog') },
      sleeper:    { count: cache.sleeper.data?.length || 0,     fresh: fresh('sleeper') },
      betr:       { count: cache.betr.data?.length || 0,        fresh: fresh('betr') },
      oddsapi:    { count: cache.oddsapi.data?.length || 0,     fresh: fresh('oddsapi') },
    }
  })
})

app.get('/api/lines', async (req, res) => {
  try {
    if (!fresh('prizepicks')) await fetchPrizePicks()
    if (!fresh('underdog'))   await fetchUnderdog()
    if (!fresh('sleeper'))    await fetchSleeper()
    if (!fresh('betr'))       await fetchBetr()
    if (!fresh('oddsapi'))    await fetchOddsAPI()

    const results = [
      ...(cache.prizepicks.data || []),
      ...(cache.underdog.data   || []),
      ...(cache.sleeper.data    || []),
      ...(cache.betr.data       || []),
      ...(cache.oddsapi.data    || []),
    ]

    // Include lines from last 12 hours onwards so we don't miss anything
    const cutoff = Date.now() - (12 * 60 * 60 * 1000)
    const filtered = results.filter(l => {
      if (!l.gameTime) return true
      try { return new Date(l.gameTime).getTime() > cutoff } catch { return true }
    })

    res.json({ success: true, count: filtered.length, lines: filtered, fetchedAt: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

app.get('/api/lines/prizepicks', async (req, res) => {
  if (!fresh('prizepicks')) await fetchPrizePicks()
  res.json({ success: true, count: cache.prizepicks.data?.length || 0, lines: cache.prizepicks.data || [] })
})
app.get('/api/lines/underdog', async (req, res) => {
  if (!fresh('underdog')) await fetchUnderdog()
  res.json({ success: true, count: cache.underdog.data?.length || 0, lines: cache.underdog.data || [] })
})
app.get('/api/lines/sleeper', async (req, res) => {
  if (!fresh('sleeper')) await fetchSleeper()
  res.json({ success: true, count: cache.sleeper.data?.length || 0, lines: cache.sleeper.data || [] })
})
app.get('/api/lines/betr', async (req, res) => {
  if (!fresh('betr')) await fetchBetr()
  res.json({ success: true, count: cache.betr.data?.length || 0, lines: cache.betr.data || [] })
})

app.post('/api/refresh', async (req, res) => {
  await refreshAll()
  res.json({ success: true, message: 'All sources refreshed' })
})

app.get('/api/status', (req, res) => {
  res.json({
    prizepicks: { count: cache.prizepicks.data?.length || 0, fresh: fresh('prizepicks'), fetchedAt: cache.prizepicks.fetchedAt ? new Date(cache.prizepicks.fetchedAt).toISOString() : null },
    underdog:   { count: cache.underdog.data?.length || 0,   fresh: fresh('underdog'),   fetchedAt: cache.underdog.fetchedAt   ? new Date(cache.underdog.fetchedAt).toISOString()   : null },
    sleeper:    { count: cache.sleeper.data?.length || 0,     fresh: fresh('sleeper'),     fetchedAt: cache.sleeper.fetchedAt     ? new Date(cache.sleeper.fetchedAt).toISOString()     : null },
    betr:       { count: cache.betr.data?.length || 0,        fresh: fresh('betr'),        fetchedAt: cache.betr.fetchedAt        ? new Date(cache.betr.fetchedAt).toISOString()        : null },
    oddsapi:    { count: cache.oddsapi.data?.length || 0,     fresh: fresh('oddsapi'),     fetchedAt: cache.oddsapi.fetchedAt     ? new Date(cache.oddsapi.fetchedAt).toISOString()     : null },
  })
})

app.listen(PORT, async () => {
  console.log(`EdgeFinder API running on port ${PORT}`)
  await refreshAll()
  console.log('Ready.')
})

setInterval(refreshAll, TTL)

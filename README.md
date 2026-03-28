# EdgeFinder Backend

Pulls live lines from PrizePicks, Underdog, Sleeper, Betr + DraftKings/FanDuel via The Odds API.
Pre-match only. Refreshes every 5 minutes.

## Endpoints
- GET /              → health check + cache status
- GET /api/lines     → all lines combined (pre-match only)
- GET /api/status    → cache freshness per source
- POST /api/refresh  → force refresh all sources

## Deploy to Railway

1. Go to railway.app → New Project → Deploy from GitHub
2. Upload this folder or connect your GitHub repo
3. Add environment variable: ODDS_API_KEY = your key
4. Railway auto-deploys and gives you a URL

## Environment Variables
- ODDS_API_KEY  → from the-odds-api.com (required for DraftKings/FanDuel lines)
- PORT          → set automatically by Railway

# pathrix-scout-mcp

Zero-cost, self-hosted intelligence layer for Claude. Scrapes Reddit, HN, GitHub, and 16+ RSS feeds, fuses results with RRF ranking, and exposes everything as MCP tools.

**No API keys required for Phase 1.** Only dependency: `gh auth login` (one command, free).

## Quick Start

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pathrix-scout": {
      "command": "npx",
      "args": ["pathrix-scout"]
    }
  }
}
```

Then restart Claude Desktop.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_topic` | Search any topic across Reddit, HN, GitHub, and RSS |
| `get_trending` | Trending content for a niche in the last N days |
| `scout_search` | Full-text search over previously fetched items |
| `scrape_own_profiles` | Scrape your own social profile stats |
| `get_profile_snapshot` | Latest stored profile snapshot |
| `raw_scrape` | Scrape without intelligence layer (raw results) |
| `score_and_rank` | Apply RRF + scoring to items you already have |
| `analyze_video` | Download and transcribe any public video (YouTube, Instagram) |

## Intelligence Pipeline

Results are ranked using a 3-stage pipeline matching last-30-days methodology:

1. **Per-source engagement scoring** - log1p normalized (Reddit: score + comments + upvote ratio; HN: score + comments; GitHub: stars + forks)
2. **Composite local rank score** - 65% text relevance (token Jaccard vs query) + 25% recency decay + 10% engagement
3. **RRF fusion** (K=60) with source quality weights: HN 0.80, GitHub 0.75, RSS 0.65, Reddit 0.60

Items appearing across multiple sources get summed RRF scores - consensus stories bubble up automatically.

## Sources (Phase 1 - no API keys needed)

- **Reddit** - public JSON API, no auth
- **Hacker News** - Algolia public search API
- **GitHub** - `gh` CLI (`brew install gh && gh auth login`)
- **RSS** (16 feeds) - TechCrunch, MIT Tech Review, VentureBeat, TLDR, Simon Willison, Hugging Face Blog, Latent Space, Ahead of AI, ArXiv cs.AI/cs.LG, HN Front Page, GitHub Trending, Product Hunt, SaaStr, Indie Hackers

## Vision Pipeline (Phase 2)

Requires: `brew install yt-dlp ffmpeg` and `pip install faster-whisper`

```
analyze_video(urls=["https://youtube.com/watch?v=..."]) 
  -> transcript + metadata
```

## Setup

```bash
# Phase 1 (required for GitHub scraping)
brew install gh && gh auth login

# Phase 2 (optional, for video transcription)
brew install yt-dlp ffmpeg
python3 -m venv .venv && source .venv/bin/activate
pip install faster-whisper
```

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `SCOUT_REDDIT_HANDLE` | - | Your Reddit username for profile sync |
| `SCOUT_YOUTUBE_HANDLE` | - | Your YouTube handle |
| `SCOUT_X_HANDLE` | - | Your X/Twitter handle |
| `SCOUT_IG_HANDLE` | - | Your Instagram handle |
| `SCOUT_WHISPER_MODEL` | `tiny` | Whisper model size: tiny/base/small |
| `SCOUT_TEMP_DIR` | `/tmp/pathrix-scout` | Temp dir for video downloads |

## Data Storage

SQLite at `~/.local/share/pathrix-scout/scout.db` - WAL mode, FTS5 search. Created automatically on first run. Separate from any Pathrix database.

## License

MIT

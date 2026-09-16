# Music Hangout

A lightweight shared music room: create a room, send the link, search YouTube, add songs to a live queue, and listen together.

## What is included

- One-click room creation with short room codes
- Shareable `/room/ABC123` links
- No user accounts; guests choose a display name
- YouTube song search through the official YouTube Data API
- Official YouTube embedded player for playback
- Shared real-time queue over WebSockets
- Cloudflare Durable Object per room as the source of truth
- Synchronized play, pause, seek, skip, and automatic next track
- Live participant list
- Responsive desktop/mobile interface
- Cloudflare Worker + Static Assets in one deployment

## Cloudflare setup

This project is designed for **Cloudflare Workers with Static Assets**, not the older Workers Sites setup.

### 1. Create a YouTube API key

In Google Cloud, enable **YouTube Data API v3** and create an API key. Restrict the key as appropriate for your project.

### 2. Add the secret to Cloudflare

Add a Worker secret named:

```text
YOUTUBE_API_KEY
```

With Wrangler locally:

```bash
npx wrangler secret put YOUTUBE_API_KEY
```

Or add the secret from the Cloudflare dashboard after importing this repository.

### 3. Deploy

```bash
npm install
npm run deploy
```

For local development:

```bash
npm install
npm run dev
```

Then open the local URL Wrangler prints.

## Cloudflare Git deployment

When importing this GitHub repository into Cloudflare Workers Builds:

- Framework preset: none / Worker
- Install command: `npm install`
- Deploy command: `npm run deploy`

The `wrangler.jsonc` file defines the Worker entry point, static assets, SPA routing, and `MusicRoomV2` Durable Object binding.

## Notes

- Browsers may require one click before they allow audio autoplay. The room includes a **Start listening** gate for that reason.
- Playback uses the official YouTube iframe player. The application does not download, extract, or re-host YouTube audio.
- Rooms persist their queue/playback state only while active or during the 30-minute empty-room grace period. Participant presence is derived from active WebSocket connections.


## Room lifecycle

Rooms are temporary. When the last listener leaves, playback is paused and the room gets a 30-minute grace period. If nobody rejoins before that timer ends, the Durable Object deletes all stored room state, including its queue and alarm. Rejoining during the grace period cancels cleanup.

The `MusicRoomV2` namespace intentionally replaces and deletes the original `MusicRoom` Durable Object namespace on deployment, clearing the early test rooms created before automatic cleanup existed.

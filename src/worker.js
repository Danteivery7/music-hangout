import { DurableObject } from "cloudflare:workers";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function cleanRoomCode(value = "") {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function makeRoomCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

function cleanName(value = "") {
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized.slice(0, 28) || "Guest";
}

function safeTrack(track) {
  if (!track || typeof track !== "object") return null;
  const videoId = String(track.videoId || "").trim();
  const title = String(track.title || "").trim().slice(0, 180);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title) return null;

  return {
    videoId,
    title,
    channel: String(track.channel || "YouTube").trim().slice(0, 100),
    thumbnail: String(track.thumbnail || "").trim().slice(0, 500),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "music-hangout" });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const roomCode = makeRoomCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
        const created = await room.fetch(`https://room.internal/create?room=${encodeURIComponent(roomCode)}`, { method: "POST" });
        if (created.status === 201) return json({ roomCode }, { status: 201 });
      }
      return json({ error: "Could not create a room. Try again." }, { status: 503 });
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 2) return json({ items: [] });
      if (!env.YOUTUBE_API_KEY) {
        return json(
          { error: "YouTube search is not configured yet. Add the YOUTUBE_API_KEY secret in Cloudflare." },
          { status: 503 },
        );
      }

      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("maxResults", "8");
      searchUrl.searchParams.set("videoEmbeddable", "true");
      searchUrl.searchParams.set("videoSyndicated", "true");
      searchUrl.searchParams.set("videoCategoryId", "10");
      searchUrl.searchParams.set("safeSearch", "moderate");
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

      const response = await fetch(searchUrl.toString(), {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        const message = await response.text();
        console.error("YouTube search failed", response.status, message.slice(0, 500));
        return json({ error: "YouTube search is temporarily unavailable." }, { status: 502 });
      }

      const data = await response.json();
      const items = (data.items || [])
        .filter((item) => item?.id?.videoId && item?.snippet?.title)
        .map((item) => ({
          videoId: item.id.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle || "YouTube",
          thumbnail:
            item.snippet.thumbnails?.medium?.url ||
            item.snippet.thumbnails?.high?.url ||
            item.snippet.thumbnails?.default?.url ||
            "",
        }));

      return json({ items });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})(\/ws)?$/);
    if (roomMatch) {
      const roomCode = cleanRoomCode(roomMatch[1]);
      const room = env.ROOMS.get(env.ROOMS.idFromName(roomCode));

      if (roomMatch[2] === "/ws") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return json({ error: "Expected a WebSocket upgrade." }, { status: 426 });
        }
        const upstream = new URL(request.url);
        upstream.hostname = "room.internal";
        upstream.protocol = "https:";
        upstream.pathname = "/ws";
        upstream.searchParams.set("room", roomCode);
        return room.fetch(new Request(upstream, request));
      }

      if (request.method === "GET") {
        const stateResponse = await room.fetch("https://room.internal/state");
        if (stateResponse.status === 404) return json({ error: "Room not found." }, { status: 404 });
        return stateResponse;
      }
    }

    return env.ASSETS.fetch(request);
  },
};

export class MusicRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.statePromise = this.ctx.storage.get("room");
  }

  async getState() {
    const stored = await this.statePromise;
    return stored || null;
  }

  async saveState(state) {
    this.statePromise = Promise.resolve(state);
    await this.ctx.storage.put("room", state);
  }

  participants() {
    const seen = new Map();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.id) continue;
      seen.set(attachment.id, {
        id: attachment.id,
        name: attachment.name || "Guest",
      });
    }
    return [...seen.values()];
  }

  publicState(state) {
    return {
      roomCode: state.roomCode,
      queue: state.queue,
      current: state.current,
      playback: state.playback,
      participants: this.participants(),
      serverNow: Date.now(),
    };
  }

  broadcast(state, except = null) {
    const payload = JSON.stringify({ type: "state", state: this.publicState(state) });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch {
        // Cloudflare will deliver a close/error event for stale sockets.
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      const existing = await this.getState();
      if (existing) return new Response(null, { status: 409 });

      const roomCode = cleanRoomCode(url.searchParams.get("room") || request.headers.get("x-room-code") || "");
      const fallbackCode = this.ctx.id.toString().slice(0, 6).toUpperCase();
      const state = {
        roomCode: roomCode || fallbackCode,
        createdAt: Date.now(),
        queue: [],
        current: null,
        playback: {
          status: "idle",
          startedAt: null,
          pausedAt: 0,
        },
      };
      await this.saveState(state);
      return new Response(null, { status: 201 });
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const state = await this.getState();
      if (!state) return new Response(null, { status: 404 });
      return json(this.publicState(state));
    }

    if (url.pathname === "/ws") {
      const state = await this.getState();
      if (!state) return new Response("Room not found", { status: 404 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const participant = {
        id: crypto.randomUUID(),
        name: cleanName(url.searchParams.get("name")),
        joinedAt: Date.now(),
      };

      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(participant);
      server.send(JSON.stringify({ type: "welcome", participantId: participant.id }));
      this.broadcast(state);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async advanceTrack(state) {
    const next = state.queue.shift() || null;
    state.current = next;
    state.playback = next
      ? { status: "playing", startedAt: Date.now(), pausedAt: 0 }
      : { status: "idle", startedAt: null, pausedAt: 0 };
    await this.saveState(state);
    this.broadcast(state);
  }

  async webSocketMessage(socket, rawMessage) {
    const state = await this.getState();
    if (!state) return;

    let message;
    try {
      message = JSON.parse(typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage));
    } catch {
      return;
    }

    const sender = socket.deserializeAttachment() || { id: "unknown", name: "Guest" };

    if (message.type === "request_state") {
      socket.send(JSON.stringify({ type: "state", state: this.publicState(state) }));
      return;
    }

    if (message.type === "add_track") {
      const track = safeTrack(message.track);
      if (!track) return;

      const queuedTrack = {
        ...track,
        queueId: crypto.randomUUID(),
        addedBy: sender.name,
        addedById: sender.id,
        addedAt: Date.now(),
      };

      if (!state.current) {
        state.current = queuedTrack;
        state.playback = { status: "playing", startedAt: Date.now(), pausedAt: 0 };
      } else {
        state.queue.push(queuedTrack);
      }
      await this.saveState(state);
      this.broadcast(state);
      return;
    }

    if (message.type === "remove_track") {
      const queueId = String(message.queueId || "");
      const nextQueue = state.queue.filter((track) => track.queueId !== queueId);
      if (nextQueue.length !== state.queue.length) {
        state.queue = nextQueue;
        await this.saveState(state);
        this.broadcast(state);
      }
      return;
    }

    if (message.type === "pause" && state.current && state.playback.status === "playing") {
      const elapsedMs = Math.max(0, Date.now() - state.playback.startedAt);
      state.playback = { status: "paused", startedAt: null, pausedAt: elapsedMs / 1000 };
      await this.saveState(state);
      this.broadcast(state);
      return;
    }

    if (message.type === "play" && state.current && state.playback.status === "paused") {
      state.playback = {
        status: "playing",
        startedAt: Date.now() - Math.round((state.playback.pausedAt || 0) * 1000),
        pausedAt: state.playback.pausedAt || 0,
      };
      await this.saveState(state);
      this.broadcast(state);
      return;
    }

    if (message.type === "seek" && state.current) {
      const seconds = Math.max(0, Math.min(Number(message.seconds) || 0, 60 * 60 * 6));
      state.playback =
        state.playback.status === "paused"
          ? { status: "paused", startedAt: null, pausedAt: seconds }
          : { status: "playing", startedAt: Date.now() - Math.round(seconds * 1000), pausedAt: seconds };
      await this.saveState(state);
      this.broadcast(state);
      return;
    }

    if (message.type === "skip") {
      await this.advanceTrack(state);
      return;
    }

    if (message.type === "track_ended") {
      const currentQueueId = String(message.queueId || "");
      if (state.current?.queueId === currentQueueId) {
        await this.advanceTrack(state);
      }
    }
  }

  async webSocketClose(socket) {
    const state = await this.getState();
    if (state) this.broadcast(state, socket);
  }

  async webSocketError(socket) {
    const state = await this.getState();
    if (state) this.broadcast(state, socket);
  }
}

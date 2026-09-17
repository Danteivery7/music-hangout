import { DurableObject } from "cloudflare:workers";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;
const DIRECTORY_NAME = "__MUSIC_HANGOUT_DIRECTORY__";
const DIRECTORY_STALE_MS = 24 * 60 * 60 * 1000;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function cleanRoomCode(value = "") {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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

function cleanRoomName(value = "") {
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized.slice(0, 48) || "Untitled room";
}

function cleanVisibility(value = "") {
  return String(value).toLowerCase() === "private" ? "private" : "public";
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

    if (url.pathname === "/api/rooms/browse" && request.method === "GET") {
      const directory = env.ROOMS.get(env.ROOMS.idFromName(DIRECTORY_NAME));
      return directory.fetch("https://room.internal/directory/list");
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const metadata = {
        roomName: cleanRoomName(body.roomName),
        visibility: cleanVisibility(body.visibility),
        creatorName: cleanName(body.creatorName || body.name),
      };

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const roomCode = makeRoomCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
        const created = await room.fetch(`https://room.internal/create?room=${encodeURIComponent(roomCode)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metadata),
        });
        if (created.status === 201) {
          return json({ roomCode, roomName: metadata.roomName, visibility: metadata.visibility }, { status: 201 });
        }
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

  participants(except = null) {
    const seen = new Map();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
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
      roomName: state.roomName || `Room ${state.roomCode}`,
      visibility: state.visibility || "private",
      creatorName: state.creatorName || "Guest",
      browseId: state.browseId || null,
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

  async directoryList() {
    const now = Date.now();
    const directory = (await this.ctx.storage.get("directory")) || {};
    let changed = false;

    for (const [code, entry] of Object.entries(directory)) {
      const expiredByRoom = entry.expiresAt && now > entry.expiresAt + 60_000;
      const staleFallback = now - Number(entry.updatedAt || entry.createdAt || 0) > DIRECTORY_STALE_MS;
      if (expiredByRoom || staleFallback) {
        delete directory[code];
        changed = true;
      }
    }

    if (changed) await this.ctx.storage.put("directory", directory);

    const rooms = Object.entries(directory)
      .map(([code, entry]) => ({
        browseId: entry.browseId,
        roomName: entry.roomName,
        visibility: entry.visibility,
        creatorName: entry.creatorName,
        participants: Number(entry.participants) || 0,
        currentTitle: entry.currentTitle || null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        roomCode: entry.visibility === "public" ? code : null,
      }))
      .sort((a, b) => (b.participants - a.participants) || (b.updatedAt - a.updatedAt));

    return json({ rooms, serverNow: now });
  }

  async registerDirectoryEntry(request) {
    const incoming = await request.json().catch(() => null);
    const roomCode = cleanRoomCode(incoming?.roomCode);
    if (!roomCode) return new Response(null, { status: 400 });
    const directory = (await this.ctx.storage.get("directory")) || {};
    directory[roomCode] = {
      browseId: String(incoming.browseId || ""),
      roomName: cleanRoomName(incoming.roomName),
      visibility: cleanVisibility(incoming.visibility),
      creatorName: cleanName(incoming.creatorName),
      participants: Math.max(0, Number(incoming.participants) || 0),
      currentTitle: String(incoming.currentTitle || "").slice(0, 180) || null,
      createdAt: Number(incoming.createdAt) || Date.now(),
      updatedAt: Date.now(),
      expiresAt: incoming.expiresAt == null ? null : Number(incoming.expiresAt) || null,
    };
    await this.ctx.storage.put("directory", directory);
    return new Response(null, { status: 204 });
  }

  async unregisterDirectoryEntry(request) {
    const incoming = await request.json().catch(() => null);
    const roomCode = cleanRoomCode(incoming?.roomCode);
    if (!roomCode) return new Response(null, { status: 400 });
    const directory = (await this.ctx.storage.get("directory")) || {};
    if (directory[roomCode]) {
      delete directory[roomCode];
      await this.ctx.storage.put("directory", directory);
    }
    return new Response(null, { status: 204 });
  }

  async updateDirectory(state, except = null) {
    if (!state?.roomCode) return;
    const directory = this.env.ROOMS.get(this.env.ROOMS.idFromName(DIRECTORY_NAME));
    const participants = this.participants(except).length;
    const expiresAt = state.emptySince != null ? state.emptySince + ROOM_IDLE_TTL_MS : null;
    await directory.fetch("https://room.internal/directory/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode: state.roomCode,
        browseId: state.browseId,
        roomName: state.roomName,
        visibility: state.visibility,
        creatorName: state.creatorName,
        participants,
        currentTitle: state.current?.title || null,
        createdAt: state.createdAt,
        expiresAt,
      }),
    });
  }

  async unregisterDirectory(state) {
    if (!state?.roomCode) return;
    const directory = this.env.ROOMS.get(this.env.ROOMS.idFromName(DIRECTORY_NAME));
    await directory.fetch("https://room.internal/directory/unregister", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: state.roomCode }),
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/directory/list" && request.method === "GET") {
      return this.directoryList();
    }
    if (url.pathname === "/directory/register" && request.method === "POST") {
      return this.registerDirectoryEntry(request);
    }
    if (url.pathname === "/directory/unregister" && request.method === "POST") {
      return this.unregisterDirectoryEntry(request);
    }

    if (url.pathname === "/create" && request.method === "POST") {
      const existing = await this.getState();
      if (existing) return new Response(null, { status: 409 });

      const metadata = await request.json().catch(() => ({}));
      const roomCode = cleanRoomCode(url.searchParams.get("room") || request.headers.get("x-room-code") || "");
      const fallbackCode = this.ctx.id.toString().slice(0, 6).toUpperCase();
      const state = {
        roomCode: roomCode || fallbackCode,
        roomName: cleanRoomName(metadata.roomName),
        visibility: cleanVisibility(metadata.visibility),
        creatorName: cleanName(metadata.creatorName),
        browseId: crypto.randomUUID(),
        createdAt: Date.now(),
        emptySince: Date.now(),
        queue: [],
        current: null,
        playback: {
          status: "idle",
          startedAt: null,
          pausedAt: 0,
        },
      };
      await this.saveState(state);
      await this.ctx.storage.setAlarm(state.emptySince + ROOM_IDLE_TTL_MS);
      await this.updateDirectory(state);
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

      if (state.emptySince != null) {
        state.emptySince = null;
        await this.saveState(state);
      }
      await this.ctx.storage.deleteAlarm();

      server.send(JSON.stringify({ type: "welcome", participantId: participant.id }));
      this.broadcast(state);
      await this.updateDirectory(state);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  connectedCount(except = null) {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket !== except && socket.readyState === WebSocket.OPEN).length;
  }

  async markRoomEmpty(state, except = null) {
    if (!state || this.connectedCount(except) > 0) return false;

    const now = Date.now();
    if (state.current && state.playback.status === "playing") {
      const elapsedMs = Math.max(0, now - state.playback.startedAt);
      state.playback = { status: "paused", startedAt: null, pausedAt: elapsedMs / 1000 };
    }

    state.emptySince = now;
    await this.saveState(state);
    await this.ctx.storage.setAlarm(now + ROOM_IDLE_TTL_MS);
    await this.updateDirectory(state, except);
    return true;
  }

  async alarm() {
    const state = await this.getState();
    if (!state) return;

    if (this.connectedCount() > 0) {
      if (state.emptySince != null) {
        state.emptySince = null;
        await this.saveState(state);
      }
      await this.updateDirectory(state);
      return;
    }

    if (state.emptySince == null) {
      state.emptySince = Date.now();
      await this.saveState(state);
      await this.ctx.storage.setAlarm(state.emptySince + ROOM_IDLE_TTL_MS);
      await this.updateDirectory(state);
      return;
    }

    const expiresAt = state.emptySince + ROOM_IDLE_TTL_MS;
    if (Date.now() < expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt);
      await this.updateDirectory(state);
      return;
    }

    await this.unregisterDirectory(state);
    this.statePromise = Promise.resolve(null);
    await this.ctx.storage.deleteAll();
  }

  async advanceTrack(state) {
    const next = state.queue.shift() || null;
    state.current = next;
    state.playback = next
      ? { status: "playing", startedAt: Date.now(), pausedAt: 0 }
      : { status: "idle", startedAt: null, pausedAt: 0 };
    await this.saveState(state);
    this.broadcast(state);
    await this.updateDirectory(state);
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
      await this.updateDirectory(state);
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
    if (!state) return;
    this.broadcast(state, socket);
    const becameEmpty = await this.markRoomEmpty(state, socket);
    if (!becameEmpty) await this.updateDirectory(state, socket);
  }

  async webSocketError(socket) {
    const state = await this.getState();
    if (!state) return;
    this.broadcast(state, socket);
    const becameEmpty = await this.markRoomEmpty(state, socket);
    if (!becameEmpty) await this.updateDirectory(state, socket);
  }
}

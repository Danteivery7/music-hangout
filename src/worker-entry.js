import baseWorker, { MusicRoom } from "./worker.js";

const LANDING_AUDIO_URL = "https://cdn1.suno.ai/ae48d12d-608a-40c2-9f08-4c1c0589d0d8.mp3";

export { MusicRoom };

async function proxyLandingAudio(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const upstreamHeaders = new Headers();
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  try {
    const upstream = await fetch(LANDING_AUDIO_URL, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      console.error("Landing audio upstream failed", upstream.status);
      return new Response("Background audio is temporarily unavailable.", { status: 502 });
    }

    const headers = new Headers();
    for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("content-type", "audio/mpeg");
    headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    headers.set("x-content-type-options", "nosniff");

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error("Landing audio proxy error", error);
    return new Response("Background audio is temporarily unavailable.", { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/landing-audio") {
      return proxyLandingAudio(request);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

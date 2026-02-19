// netlify/functions/youtube.js
// YouTube Data API v3 (search.list): 50개씩 페이지네이션 안정적으로 "더보기" 지원
// /api/youtube?max=50&pageToken=...

let cache = { channelId: null, ts: 0 };

exports.handler = async function (event) {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return json(500, { error: "Missing env var YOUTUBE_API_KEY in Netlify" });

    const qs = event.queryStringParameters || {};
    const max = Math.min(50, Math.max(1, Number(qs.max || 50)));
    const pageToken = qs.pageToken || "";
    const HANDLE = "BONNYpd";

    // channelId 캐시 (6시간)
    const now = Date.now();
    if (!cache.channelId || (now - cache.ts) > 6 * 60 * 60 * 1000) {
      const channelId = await resolveChannelIdFromHandle(HANDLE);
      if (!channelId) return json(500, { error: "Could not resolve channelId from handle" });
      cache.channelId = channelId;
      cache.ts = now;
    }

    const channelId = cache.channelId;

    // ✅ search.list 로 최신 업로드 순 50개씩
    const params = new URLSearchParams({
      part: "snippet",
      channelId,
      order: "date",
      type: "video",
      maxResults: String(max),
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);

    const items = (data.items || []).map((it) => {
      const sn = it.snippet || {};
      const videoId = it.id?.videoId || "";
      const title = sn.title || "";
      const published = sn.publishedAt || "";
      const description = sn.description || "";
      const thumbnail =
        (sn.thumbnails && (sn.thumbnails.high || sn.thumbnails.medium || sn.thumbnails.default)?.url) ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");
      const link = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";

      return { id: videoId, title, published, summary: description, thumbnail, link };
    }).filter(x => x.id && x.title);

    return json(200, {
      handle: `@${HANDLE}`,
      channelId,
      nextPageToken: data.nextPageToken || null,
      count: items.length,
      items,
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    return json(500, { error: String(err) });
  }
};

// --- helpers ---

async function resolveChannelIdFromHandle(handle) {
  const html = await fetchText(`https://www.youtube.com/@${handle}`);
  const patterns = [
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"externalId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /<meta itemprop="channelId" content="(UC[a-zA-Z0-9_-]{20,})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  const loose = html.match(/UC[a-zA-Z0-9_-]{20,}/);
  return loose ? loose[0] : null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (data && data.error) throw new Error(`YouTube API error: ${JSON.stringify(data.error)}`);
  return data;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html,*/*",
      "accept-language": "en-US,en;q=0.9,ko;q=0.8",
      "cookie": "CONSENT=YES+1;",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
  return await res.text();
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
    body: JSON.stringify(obj),
  };
}

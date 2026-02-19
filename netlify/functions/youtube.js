// netlify/functions/youtube.js
// Robust version: 여러 패턴으로 채널 ID(UC...)를 추출 → RSS(channel_id)로 영상 목록 반환

let cached = { channelId: null, ts: 0 };

exports.handler = async function (event) {
  try {
    const max = Math.min(100, Math.max(1, Number(event.queryStringParameters?.max || 30)));
    const HANDLE = "BONNYpd";
    const now = Date.now();

    // 1) channelId 캐시 (1시간)
    if (!cached.channelId || (now - cached.ts) > 60 * 60 * 1000) {
      const html = await fetchText(`https://www.youtube.com/@${HANDLE}`);

      const channelId = extractChannelId(html);

      if (!channelId) {
        // fallback 1: RSS user= 로 시도 (일부 채널은 동작)
        const rssUser = await fetchText(`https://www.youtube.com/feeds/videos.xml?user=${HANDLE}`);
        const idFromRssUser = (rssUser.match(/<yt:channelId>(UC[^<]+)<\/yt:channelId>/) || [])[1];
        if (idFromRssUser) {
          cached.channelId = idFromRssUser;
          cached.ts = now;
        } else {
          return json(500, { error: "Could not extract channelId from handle page (robust)", hint: "Try using explicit channel_id if needed." });
        }
      } else {
        cached.channelId = channelId;
        cached.ts = now;
      }
    }

    const channelId = cached.channelId;

    // 2) 안정적인 RSS(channel_id)
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      accept: "application/xml,text/xml,*/*",
    });

    const entries = xml.split("<entry>").slice(1).map(chunk => "<entry>" + chunk);

    const pick = (text, tag) => {
      const mm = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return mm ? mm[1].trim() : "";
    };

    const pickAttr = (text, tag, attr) => {
      const mm = text.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"[^>]*\\/?>`));
      return mm ? mm[1] : "";
    };

    const decode = (s) =>
      String(s || "")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", "\"")
        .replaceAll("&#39;", "'");

    const items = entries
      .map(e => {
        const title = decode(pick(e, "title"));
        const id = pick(e, "yt:videoId");
        const published = pick(e, "published");
        const link = pickAttr(e, "link", "href") || (id ? `https://www.youtube.com/watch?v=${id}` : "");
        const summary = decode(pick(e, "media:description") || pick(e, "summary"));
        const thumbnail = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
        return { id, title, published, link, thumbnail, summary };
      })
      .filter(x => x.id && x.title)
      .slice(0, max);

    return json(200, {
      handle: `@${HANDLE}`,
      channelId,
      updatedAt: new Date().toISOString(),
      count: items.length,
      items,
    });

  } catch (err) {
    return json(500, { error: String(err) });
  }
};

function extractChannelId(html) {
  // ✅ 여러 패턴으로 UC... 추출
  const patterns = [
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /"externalId":"(UC[a-zA-Z0-9_-]{20,})"/,
    /https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})/,
    /<meta itemprop="channelId" content="(UC[a-zA-Z0-9_-]{20,})"/,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }

  // 마지막 보루: UC로 시작하는 토큰을 넓게 탐색 (과탐 방지 위해 길이 제한)
  const loose = html.match(/UC[a-zA-Z0-9_-]{20,}/);
  return loose ? loose[0] : null;
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": opts.accept || "text/html,*/*",
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
      "cache-control": "public, max-age=300",
    },
    body: JSON.stringify(obj),
  };
}

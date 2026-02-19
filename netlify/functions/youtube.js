// netlify/functions/youtube.js
// 안정형: @BONNYpd 페이지에서 channelId(UC...) 추출 → RSS(channel_id)로 영상 목록 반환

let cached = { channelId: null, ts: 0 };

exports.handler = async function (event) {
  try {
    const max = Math.min(100, Math.max(1, Number(event.queryStringParameters?.max || 30)));
    const HANDLE = "BONNYpd";

    const now = Date.now();

    // 1시간 캐시
    if (!cached.channelId || (now - cached.ts) > 60 * 60 * 1000) {
      const chRes = await fetch(`https://www.youtube.com/@${HANDLE}`, {
        headers: {
          "user-agent": "Mozilla/5.0",
          "accept": "text/html,*/*",
        },
      });

      if (!chRes.ok) {
        return json(500, { error: "Failed to fetch channel page", status: chRes.status });
      }

      const html = await chRes.text();
      const m = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/);

      if (!m) {
        return json(500, { error: "Could not extract channelId from handle page" });
      }

      cached.channelId = m[1];
      cached.ts = now;
    }

    const channelId = cached.channelId;

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const res = await fetch(feedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "application/xml,text/xml,*/*",
      },
    });

    if (!res.ok) {
      return json(500, { error: "Failed to fetch YouTube feed", status: res.status });
    }

    const xml = await res.text();
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

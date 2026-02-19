// netlify/functions/youtube.js

let cached = { channelId: null, ts: 0 };

export default async (req) => {
  try {
    const url = new URL(req.url);
    const max = Number(url.searchParams.get("max") || 30);

    const HANDLE = "BONNYpd"; // ✅ 핸들 반영

    // 1) 채널ID 캐시(1시간)
    const now = Date.now();
    if (!cached.channelId || (now - cached.ts) > 60 * 60 * 1000) {
      const chRes = await fetch(`https://www.youtube.com/@${HANDLE}`, {
        headers: {
          "user-agent": "Mozilla/5.0",
          "accept": "text/html,*/*",
        },
      });
      if (!chRes.ok) {
        return json({ error: "Failed to fetch channel page", status: chRes.status }, 500);
      }
      const html = await chRes.text();

      const m = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/);
      if (!m) {
        return json({ error: "Could not extract channelId from handle page" }, 500);
      }

      cached.channelId = m[1];
      cached.ts = now;
    }

    const CHANNEL_ID = cached.channelId;

    // 2) RSS 가져오기 (가장 안정)
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
    const res = await fetch(feedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "application/xml,text/xml,*/*",
      }
    });

    if (!res.ok) {
      return json({ error: "Failed to fetch YouTube feed", status: res.status }, 500);
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
      (s || "")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", "\"")
        .replaceAll("&#39;", "'");

    const items = entries.map(e => {
      const title = decode(pick(e, "title"));
      const id = pick(e, "yt:videoId");
      const published = pick(e, "published");
      const link = pickAttr(e, "link", "href") || (id ? `https://www.youtube.com/watch?v=${id}` : "");
      const summary = decode(pick(e, "media:description") || pick(e, "summary"));
      const thumbnail = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
      return { id, title, published, link, thumbnail, summary };
    }).filter(x => x.id && x.title).slice(0, Math.max(1, Math.min(100, max)));

    return json({
      handle: `@${HANDLE}`,
      channelId: CHANNEL_ID,
      updatedAt: new Date().toISOString(),
      count: items.length,
      items
    }, 200);

  } catch (err) {
    return json({ error: String(err) }, 500);
  }
};

functi

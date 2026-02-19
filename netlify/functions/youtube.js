// netlify/functions/youtube.js

export default async (req) => {
  try {
    const url = new URL(req.url);

    // ✅ BONNYpd 핸들 반영
    const YOUTUBE_HANDLE = "BONNYpd";

    const max = Number(url.searchParams.get("max") || 30);

    // 핸들 기반 RSS 시도
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?user=${YOUTUBE_HANDLE}`;

    const res = await fetch(feedUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "application/xml,text/xml,*/*",
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({
        error: "Failed to fetch YouTube feed",
        status: res.status
      }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const xml = await res.text();

    const entries = xml.split("<entry>").slice(1).map(chunk => "<entry>" + chunk);

    const pick = (text, tag) => {
      const m = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };

    const pickAttr = (text, tag, attr) => {
      const m = text.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"[^>]*\\/?>`));
      return m ? m[1] : "";
    };

    const decode = (s) =>
      s.replaceAll("&amp;", "&")
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
    })
    .filter(x => x.id && x.title)
    .slice(0, Math.max(1, Math.min(100, max)));

    return new Response(JSON.stringify({
      channel: "@BONNYpd",
      updatedAt: new Date().toISOString(),
      count: items.length,
      items
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300"
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};

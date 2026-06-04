import type { VercelRequest, VercelResponse } from "@vercel/node";

const CONFLUENCE_BASE = "https://appdirect.jira.com/wiki";
const SPACE_KEY = "vComNoc";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = String(req.query.q ?? "").trim();
  if (!query) return res.status(400).json({ error: "Missing query param ?q=" });

  const email = process.env.CONFLUENCE_USER_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN;
  if (!email || !token) {
    return res.status(500).json({ error: "Confluence credentials not configured." });
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  try {
    // CQL search scoped to the vComNoc space, ordered by relevance
    const cql = `type=page AND space="${SPACE_KEY}" AND text~"${query.replace(/"/g, " ")}"`;
    const searchUrl = `${CONFLUENCE_BASE}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=5&expand=body.view,version,space`;

    const searchRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!searchRes.ok) {
      const text = await searchRes.text();
      return res.status(searchRes.status).json({ error: `Confluence error: ${searchRes.status} — ${text.slice(0, 200)}` });
    }

    const data = await searchRes.json() as {
      results: Array<{
        id: string;
        title: string;
        _links: { webui: string };
        body?: { view?: { value: string } };
      }>;
      totalSize: number;
    };

    // Strip HTML tags from body content, keep meaningful text
    function stripHtml(html: string): string {
      return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s{3,}/g, "\n\n")
        .trim();
    }

    const pages = data.results.map(page => ({
      id: page.id,
      title: page.title,
      url: `${CONFLUENCE_BASE}${page._links.webui}`,
      excerpt: page.body?.view?.value
        ? stripHtml(page.body.view.value).slice(0, 800)
        : "",
    }));

    return res.status(200).json({ pages, total: data.totalSize });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Search failed" });
  }
}

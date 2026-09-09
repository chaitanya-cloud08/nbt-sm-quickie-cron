// The indiatimes "wufs" global-feed endpoints don't publish a stable schema
// doc, and the field names have drifted across clients (title/hl, syn/synopsis,
// wu/weburl, etc). Rather than hard-coding one shape, we walk the parsed JSON
// looking for objects that look like an article (a headline-ish string field
// plus, ideally, a summary-ish field) and normalize whatever we find.

const TITLE_KEYS = ["title", "hl", "headline", "seotitle", "et"];
const SUMMARY_KEYS = ["syn", "synopsis", "summary", "seodescription", "description", "sy"];
const URL_KEYS = [
  "wu",
  "weburl",
  "web_url",
  "url",
  "canonicalurl",
  "canonical_url",
  "seolocation",
  "seo_location",
  "curl",
  "link",
  "articleurl",
  "article_url",
  "permalink",
  "shareurl",
  "share_url",
  "deeplink",
];
const DATE_KEYS = ["dl", "publishedon", "publishdate", "createdon"];
const NBT_BASE_URL = "https://navbharattimes.indiatimes.com";

function firstString(obj, keys) {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
  }
  return undefined;
}

function normalizeUrl(raw) {
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${NBT_BASE_URL}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function collectArticles(node, out, seen) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) collectArticles(item, out, seen);
    return;
  }

  const title = firstString(node, TITLE_KEYS);
  if (title && !seen.has(title)) {
    seen.add(title);
    const rawUrl = firstString(node, URL_KEYS);
    if (!rawUrl && process.env.QUICKIE_DEBUG_FEED) {
      console.log(`[quickie] no URL field found for "${title}". Keys present: ${Object.keys(node).join(", ")}`);
    }
    out.push({
      title,
      synopsis: firstString(node, SUMMARY_KEYS) || "",
      url: normalizeUrl(rawUrl),
      publishedAt: firstString(node, DATE_KEYS) || "",
    });
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectArticles(value, out, seen);
  }
}

async function fetchArticles(url, count) {
  const res = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*" },
  });
  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status} ${res.statusText} (${url})`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Feed did not return valid JSON: ${url}`);
  }

  const articles = [];
  collectArticles(data, articles, new Set());

  if (articles.length === 0) {
    throw new Error(`No articles could be parsed from feed: ${url}`);
  }

  return articles.slice(0, count);
}

module.exports = { fetchArticles };

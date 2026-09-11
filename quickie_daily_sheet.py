"""
Quickie of the Day — picks one NBT story, generates an Instagram caption +
hashtags via Groq, and logs the result to a Google Sheet.

Runs once, non-interactively (intended for cron / GitHub Actions, daily at
8am). Env vars required:
  GROQ_API_KEY               Groq API key
  GOOGLE_SHEETS_CREDS_PATH   Path to a Google service-account JSON key file
  GOOGLE_SHEET_ID            Target spreadsheet ID
Optional:
  GOOGLE_SHEET_TAB_NAME      Worksheet/tab name (default: "Quickie Of The Day")
"""

import json
import logging
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import gspread
import requests
from google.oauth2.service_account import Credentials

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("quickie")

# Feed sections to check, in priority order. Add more {"name", "msid"}
# entries here if you want additional fallback sections.
SECTION_PRIORITY = [
    {"name": "India", "msid": "1564454"},
]

FEED_URL_TEMPLATE = "https://global-feed.indiatimes.com/wufs/feed/list/article?client=nbt&pc=nbt&dm=t&msid={msid}"
NBT_BASE_URL = "https://navbharattimes.indiatimes.com"

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-120b"

USED_STORIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "used_stories.json")

SHEET_HEADER = [
    "Day",
    "Date",
    "Article MSID",
    "Article URL",
    "Quickie Image URL",
    "Article Headline",
    "Instagram Caption",
    "Hashtags",
]

QUICKIE_IMAGE_URL_TEMPLATE = "https://quickie.navbharattimes.com/api/feed/share-card?msid={msid}"

GROQ_SYSTEM_PROMPT = """You write Instagram captions for NBT's "Quickie" news brief brand.

Given a news headline and synopsis, return STRICT JSON only, no markdown, no commentary,
in this exact shape:
{"caption": "...", "hashtags": ["...", "...", ...]}

Rules for "caption":
- Written in Hindi.
- Two lines only, separated by a literal "\n" inside the JSON string:
  1. A crisp, hook-first, curiosity-driven line — make someone stop scrolling. Keep it
     tight: short words, no filler, no throat-clearing. Under 80 characters.
  2. A call-to-action telling the reader to comment the word "Quickie" to get the full
     story link sent to their DM — naming the story's topic in that line, e.g. for a
     story about the BRICS summit: 'BRICS समिट के बारे में और जानने के लिए कमेंट करें
     "Quickie" और पाएं अपने DM में लिंक'. Always keep the word "Quickie" in English
     inside quotes exactly like that, and phrase the rest of that line to fit today's
     topic. This line must always be on its own line, never merged into line 1.
- The two lines combined must stay under 200 characters.

Rules for "hashtags":
- An array of 8 to 12 hashtags, mixing:
  - broad reach tags such as #NBT, #NavbharatTimes, #QuickieOfTheDay
  - topical tags specific to this story
  - 1-2 trending-style tags
- Hindi and/or English hashtags are both fine.
"""


def get_field(obj, keys):
    for key in keys:
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def strip_html(text):
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def build_article_url(seolocation, article_id):
    path = (seolocation or "").strip("/")
    return f"{NBT_BASE_URL}/{path}/articleshow/{article_id}.cms"


def fetch_feed(msid):
    resp = requests.get(FEED_URL_TEMPLATE.format(msid=msid), timeout=15)
    resp.raise_for_status()
    return resp.json()


def match_trending_item(trending_entry, items):
    trend_headline = get_field(trending_entry, ["hl", "headline", "title"])
    trend_url = get_field(trending_entry, ["wu", "weburl", "url"])
    for item in items:
        item_headline = get_field(item, ["hl", "headline", "title"])
        item_url = get_field(item, ["wu", "weburl", "url"])
        if trend_headline and item_headline and trend_headline == item_headline:
            return item
        if trend_url and item_url and trend_url == item_url:
            return item
    return None


def load_used_stories():
    if not os.path.exists(USED_STORIES_PATH):
        return []
    try:
        with open(USED_STORIES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Could not read used_stories.json (%s); starting fresh", e)
        return []


def save_used_stories(used_ids):
    try:
        with open(USED_STORIES_PATH, "w", encoding="utf-8") as f:
            json.dump(used_ids, f, ensure_ascii=False, indent=2)
    except OSError as e:
        log.warning("Could not write used_stories.json: %s", e)


def select_story(used_ids):
    """Prefer trending items per section (in priority order, top trending entry
    first), matched to their full record in `items`; fall back to walking
    through `items` itself (most recent first) if there's no trending match,
    or once every trending candidate has already been used. Skips anything
    already in used_ids so a section doesn't dead-end after its top story is
    used once."""
    trending_candidates = []
    fallback_candidates = []

    for section in SECTION_PRIORITY:
        try:
            feed_data = fetch_feed(section["msid"])
        except (requests.RequestException, ValueError) as e:
            log.warning("Feed fetch failed for section %s (msid=%s): %s", section["name"], section["msid"], e)
            continue

        items = feed_data.get("items") or []
        trending = (feed_data.get("rlData") or {}).get("edittrendingItems") or []

        section_matches = 0
        for trend_entry in trending:
            matched = match_trending_item(trend_entry, items)
            if matched:
                trending_candidates.append((matched, "trending", section["name"]))
                section_matches += 1
        if trending and not section_matches:
            log.info("No item match for any trending entry in section %s", section["name"])

        for item in items:
            fallback_candidates.append((item, "recency_fallback", section["name"]))

    for item, source, section_name in trending_candidates + fallback_candidates:
        article_id = get_field(item, ["id", "msid"]) or str(item.get("id") or item.get("msid") or "")
        if not article_id:
            continue
        article_id = str(article_id)
        if article_id in used_ids:
            log.info("Candidate %s from %s (%s) already used, skipping", article_id, section_name, source)
            continue
        return item, source, section_name, article_id

    return None


def strip_code_fences(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def call_groq(headline, synopsis):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    payload = {
        "model": GROQ_MODEL,
        "max_tokens": 800,
        "reasoning_effort": "low",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": GROQ_SYSTEM_PROMPT},
            {"role": "user", "content": f"Headline: {headline}\nSynopsis: {synopsis}"},
        ],
    }
    resp = requests.post(
        GROQ_API_URL,
        headers={"content-type": "application/json", "authorization": f"Bearer {api_key}"},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    if not content or not content.strip():
        raise ValueError("Groq returned an empty response")
    return content


def parse_groq_response(content):
    parsed = json.loads(strip_code_fences(content))
    caption = parsed["caption"]
    hashtags = parsed["hashtags"]
    if not isinstance(caption, str) or not caption.strip():
        raise ValueError("Missing or empty 'caption' in Groq response")
    if "\n" not in caption.strip():
        raise ValueError("'caption' is missing the required line break before the CTA line")
    if not isinstance(hashtags, list) or not hashtags:
        raise ValueError("Missing or empty 'hashtags' in Groq response")
    return caption.strip(), [str(h).strip() for h in hashtags if str(h).strip()]


def generate_caption_and_hashtags(headline, synopsis):
    last_error = None
    for attempt in (1, 2):
        try:
            content = call_groq(headline, synopsis)
            return parse_groq_response(content)
        except Exception as e:
            last_error = e
            log.warning("Groq caption generation attempt %d/2 failed: %s", attempt, e)
    log.error("Groq caption generation failed twice, giving up: %s", last_error)
    return "GENERATION_FAILED", ["GENERATION_FAILED"]


def get_worksheet():
    creds_path = os.environ.get("GOOGLE_SHEETS_CREDS_PATH")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not creds_path:
        raise RuntimeError("GOOGLE_SHEETS_CREDS_PATH is not set")
    if not sheet_id:
        raise RuntimeError("GOOGLE_SHEET_ID is not set")
    tab_name = os.environ.get("GOOGLE_SHEET_TAB_NAME") or "Quickie Of The Day"

    creds = Credentials.from_service_account_file(
        creds_path, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(sheet_id)

    try:
        ws = sh.worksheet(tab_name)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=tab_name, rows=1000, cols=len(SHEET_HEADER))
        ws.append_row(SHEET_HEADER, value_input_option="RAW")
        return ws

    first_row = ws.row_values(1)
    if first_row != SHEET_HEADER:
        ws.update("A1", [SHEET_HEADER])

    return ws


def prepend_row(ws, row):
    """Inserts directly under the header (row 2), pushing existing rows down,
    so the most recent entry is always on top."""
    ws.insert_row(row, index=2, value_input_option="RAW")


def main():
    used_ids = load_used_stories()

    selection = select_story(used_ids)
    if selection is None:
        log.error("No unused story found across any configured section; aborting.")
        sys.exit(1)

    item, source, section_name, article_id = selection
    headline = get_field(item, ["hl", "headline", "title"]) or ""
    synopsis = strip_html(get_field(item, ["syn", "synopsis", "summary"]) or "")
    seolocation = get_field(item, ["seolocation", "seo_location"]) or ""
    article_url = build_article_url(seolocation, article_id)
    quickie_image_url = QUICKIE_IMAGE_URL_TEMPLATE.format(msid=article_id)

    log.info("Selected story %s from %s (%s): %s", article_id, section_name, source, headline)

    used_ids.append(article_id)
    save_used_stories(used_ids)

    caption, hashtags = generate_caption_and_hashtags(headline, synopsis)
    status = "Needs Review" if caption == "GENERATION_FAILED" else "Ready"

    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    row = [
        now.strftime("%A"),
        now.strftime("%d-%m-%Y"),
        article_id,
        article_url,
        quickie_image_url,
        headline,
        caption,
        " ".join(hashtags),
    ]

    try:
        ws = get_worksheet()
        prepend_row(ws, row)
    except Exception as e:
        log.error("Failed to write to Google Sheet: %s", e)
        sys.exit(1)

    log.info("Logged Quickie of the Day (status=%s): %s", status, headline)


if __name__ == "__main__":
    main()

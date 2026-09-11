# NBT Quickie Cron

This repo holds two independent daily automations:

1. [**"Sabse Tez, Quickie Se" quiz cron**](#1-sabse-tez-quickie-se-quiz-cron) (`src/`) — a
   5-question GK quiz card, 9:00 AM IST.
2. [**Quickie of the Day**](#2-quickie-of-the-day-instagram-caption-generator)
   (`quickie_daily_sheet.py`) — one story a day with an Instagram caption + hashtags,
   8:00 AM IST.

## 1. "Sabse Tez, Quickie Se" quiz cron

Automated daily script for the Instagram/Facebook Story quiz card series. Every day at
**9:00 AM IST** it:

1. Picks today's theme from the editorial calendar:

   | Day       | Theme          |
   |-----------|----------------|
   | Monday    | Education      |
   | Tuesday   | Entertainment  |
   | Wednesday | India News     |
   | Thursday  | Astro/Dharm    |
   | Friday    | Tech           |
   | Saturday  | Sports         |
   | Sunday    | World News     |

2. Pulls 5 articles for that theme from the NBT global feed
   (`https://global-feed.indiatimes.com/wufs/feed/list/article?client=nbt&pc=nbt&dm=t&msid=<theme-id>`).
3. Reads every question already written to the sheet, and asks Groq to turn each
   article into one **evergreen general-knowledge question** in Hindi (Devanagari)
   about the article's broad subject — deliberately *not* about the specific ongoing
   story (so the card never goes stale) and never a repeat of a previously-used
   question — plus 3 wrong-but-plausible options alongside the correct answer, for
   a multiple-choice card. If the model still returns a duplicate question, or is
   missing an option, the script retries automatically (up to 4 attempts) before
   failing loudly rather than posting bad data.
4. Inserts 5 rows (`Day, Date, Theme, Question, Correct Answer, Option 2, Option 3,
   Option 4`) at the top of a Google Sheet, right under the header, so the most
   recent day's quiz is always the first thing the social media SPOC sees, and
   drops them into the quiz template (slide 5 always links back to Quickie).

## Setup

### 1. Google Sheet + service account

1. Create (or reuse) a Google Sheet with a tab that will hold the rows.
2. Create a Google Cloud service account with the **Sheets API** enabled, and generate
   a JSON key for it.
3. Share the sheet with the service account's `client_email` (Editor access).
4. Note the spreadsheet ID (the long ID in the sheet's URL).

### 2. Repo secrets (Settings → Secrets and variables → Actions)

| Secret                        | Value                                                              |
|--------------------------------|---------------------------------------------------------------------|
| `GROQ_API_KEY`                 | A Groq API key (console.groq.com)                                   |
| `GOOGLE_SERVICE_ACCOUNT_JSON`  | The service account JSON (raw, or base64: `base64 -w0 key.json`)    |
| `SPREADSHEET_ID`               | The target spreadsheet ID                                           |
| `SHEET_NAME`                   | The tab name to append to (defaults to `Sheet1` if omitted)         |

### 3. Schedule

The workflow at [`.github/workflows/quickie-cron.yml`](.github/workflows/quickie-cron.yml)
runs on a `30 3 * * *` UTC cron (= 09:00 IST daily) and can also be triggered manually
from the Actions tab (`workflow_dispatch`).

## Running locally

```bash
npm install
cp .env.example .env   # fill in the values
node -r dotenv/config src/index.js   # or export the vars yourself and `npm start`
```

## Project layout

- `src/themes.js` — day-of-week → theme → feed msid mapping.
- `src/feed.js` — fetches and normalizes articles out of the global feed's JSON.
- `src/questionGenerator.js` — prompts Groq for 5 evergreen GK questions, each with a
  correct answer and 3 wrong options, avoiding any question already used, and retries
  if the model repeats itself or leaves an option out.
- `src/sheets.js` — reads previously-used questions and inserts new rows right
  under the header in the Google Sheet, so the newest entry is always on top.
- `src/index.js` — orchestrates the daily run.

## 2. Quickie of the Day (Instagram caption generator)

`quickie_daily_sheet.py` runs once a day (8:00 AM IST) and:

1. Checks the sections in `SECTION_PRIORITY` (top of the file) in order, and for each
   one prefers the top `rlData.edittrendingItems` entry — matched by headline/URL to
   its full record in `items` — falling back to `items[0]` if there's no trending match.
   Skips anything already in `used_stories.json`, so no story repeats.
2. Sends the headline and a cleaned synopsis to Groq (`openai/gpt-oss-120b`), asking for
   a Hindi Instagram caption plus 8-12 hashtags as strict JSON. Retries once on a bad
   response; after two failures it logs the error and still writes the row with
   `"GENERATION_FAILED"` in place of the caption/hashtags rather than crashing.
3. Appends one row (`Day, Date, Article MSID, Article URL, Quickie Image URL, Headline,
   Instagram Caption, Hashtags, Selection Source, Status`) to a Google Sheet tab (created
   automatically on first run if it doesn't exist). The Quickie Image URL is
   `https://quickie.navbharattimes.com/api/feed/share-card?msid=<article-id>`.

`SECTION_PRIORITY` in `quickie_daily_sheet.py` currently checks only the India News
section (msid `1564454`) — add more `{"name", "msid"}` entries there for additional
fallback sections.

### Setup

Reuses the same Google service account and Groq key as the quiz cron above. Env vars:

| Env var                      | Value                                                          |
|-------------------------------|-----------------------------------------------------------------|
| `GROQ_API_KEY`                | A Groq API key                                                  |
| `GOOGLE_SHEETS_CREDS_PATH`    | Path to the service account JSON key file                       |
| `GOOGLE_SHEET_ID`             | The target spreadsheet ID                                       |
| `GOOGLE_SHEET_TAB_NAME`       | Optional; defaults to `Quickie Of The Day`                      |

The workflow at
[`.github/workflows/quickie-daily-sheet.yml`](.github/workflows/quickie-daily-sheet.yml)
writes the `GOOGLE_SERVICE_ACCOUNT_JSON` secret out to a temp file for
`GOOGLE_SHEETS_CREDS_PATH`, reuses the `SPREADSHEET_ID` secret for `GOOGLE_SHEET_ID`, and
reads an optional `QUICKIE_SHEET_TAB_NAME` secret. It also commits `used_stories.json`
back to the branch after each run — GitHub Actions runners are ephemeral, so without
that the "never repeat a story" tracking would reset on every run.

### Running locally

```bash
pip install -r requirements.txt
export GROQ_API_KEY=...
export GOOGLE_SHEETS_CREDS_PATH=./service-account.json
export GOOGLE_SHEET_ID=...
python quickie_daily_sheet.py
```

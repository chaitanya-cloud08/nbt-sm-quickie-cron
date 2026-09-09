# NBT Quickie Cron — "Sabse Tez, Quickie Se"

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
3. Asks Claude to turn each article into one **evergreen general-knowledge question**
   about the article's broad subject — deliberately *not* about the specific ongoing
   story, so the card never goes stale if the news facts change later.
4. Appends 5 rows (`Day, Date, Theme, Question, Answer`) to a Google Sheet, so the
   social media SPOC can pick them up and drop them into the quiz template (slide 5
   always links back to Quickie).

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
| `ANTHROPIC_API_KEY`            | An Anthropic API key                                                |
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
- `src/questionGenerator.js` — prompts Claude for 5 evergreen GK Q&As.
- `src/sheets.js` — appends rows to the Google Sheet (writes the header once).
- `src/index.js` — orchestrates the daily run.

// Day-of-week -> theme -> global-feed category msid, per the Quickie editorial calendar.
// getDay() from JS Date: 0=Sunday ... 6=Saturday.

const THEMES_BY_DAY = {
  0: { theme: "World News", msid: "2279801" },
  1: { theme: "Education", msid: "2279784" },
  2: { theme: "Entertainment", msid: "2279793" },
  3: { theme: "India News", msid: "1564454" },
  4: { theme: "Astro/Dharm", msid: "17127056" },
  5: { theme: "Tech", msid: "19615041" },
  6: { theme: "Sports", msid: "2279790" },
};

const GLOBAL_FEED_MSID = "2354729";

function feedUrl(msid) {
  return `https://global-feed.indiatimes.com/wufs/feed/list/article?client=nbt&pc=nbt&dm=t&msid=${msid}`;
}

function themeForDate(date) {
  const entry = THEMES_BY_DAY[date.getDay()];
  return { ...entry, feedUrl: feedUrl(entry.msid) };
}

module.exports = { THEMES_BY_DAY, GLOBAL_FEED_MSID, feedUrl, themeForDate };

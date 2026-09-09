const { themeForDate } = require("./themes");
const { fetchArticles } = require("./feed");
const { generateQuestions } = require("./questionGenerator");
const { appendRows, getExistingQuestions } = require("./sheets");

const ARTICLES_NEEDED = 5;

function formatDate(date) {
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function dayName(date) {
  return date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" });
}

async function main() {
  const now = new Date();
  const { theme, feedUrl } = themeForDate(now);

  console.log(`[quickie] ${dayName(now)} ${formatDate(now)} — theme: ${theme}`);
  console.log(`[quickie] fetching articles from ${feedUrl}`);
  const articles = await fetchArticles(feedUrl, ARTICLES_NEEDED);
  console.log(`[quickie] got ${articles.length} articles`);

  const usedQuestions = await getExistingQuestions();
  console.log(`[quickie] ${usedQuestions.length} previously-used questions loaded from the sheet`);

  const qa = await generateQuestions(theme, articles, usedQuestions);
  console.log(`[quickie] generated ${qa.length} questions`);

  const day = dayName(now);
  const date = formatDate(now);
  const rows = qa.map(({ question, answer, wrongOptions }) => [
    day,
    date,
    theme,
    question,
    answer,
    wrongOptions[0] || "",
    wrongOptions[1] || "",
    wrongOptions[2] || "",
  ]);

  await appendRows(rows);
  console.log(`[quickie] appended ${rows.length} rows to the sheet`);
}

main().catch((err) => {
  console.error("[quickie] failed:", err);
  process.exit(1);
});

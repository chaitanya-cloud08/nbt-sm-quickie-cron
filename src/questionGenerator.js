// Turns today's 5 articles into 5 evergreen GK questions for the Quickie quiz.
// Deliberately steers away from facts tied to the specific ongoing story
// (scores, breaking developments, "as of today" figures) since those can
// change or age out before the card ships on social; instead it asks about
// the stable general-knowledge subject each article touches on.

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.QUICKIE_MODEL || "llama-3.1-8b-instant";

function buildPrompt(theme, articles) {
  const articleList = articles
    .map((a, i) => `${i + 1}. ${a.title}${a.synopsis ? ` — ${a.synopsis}` : ""}`)
    .join("\n");

  return `You are building today's "Sabse Tez, Quickie Se" quiz card for NBT's Instagram/Facebook Stories.

Today's theme is: ${theme}

Here are 5 articles from today's NBT feed for this theme (used only as topic inspiration):
${articleList}

For EACH article, write one general-knowledge quiz question inspired by its broad subject area — NOT about the specific ongoing news event, and NOT reliant on any fact that could change (scores, ongoing figures, "as of now" details, breaking developments). The question must be a stable, evergreen general-knowledge fact related to the article's subject (e.g. if the article is about a cricket match, ask a GK question about cricket history/rules, not about the match result).

Rules:
- Exactly 5 questions, one per article, in the same order as the articles.
- Each question should be short, punchy, quiz-card friendly, suitable for a Hindi-English (Hinglish) urban Indian social media audience.
- Each answer should be short (a word or short phrase).
- Do not reference "the article" or "today's news" in the question.
- Return ONLY valid JSON, an array of 5 objects: [{"question": "...", "answer": "..."}, ...]. No markdown, no commentary.`;
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not find a JSON array in model response: ${text}`);
  return JSON.parse(match[0]);
}

async function generateQuestions(theme, articles) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildPrompt(theme, articles) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq API request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const questions = extractJsonArray(text);

  if (!Array.isArray(questions) || questions.length !== 5) {
    throw new Error(`Expected exactly 5 questions, got: ${JSON.stringify(questions)}`);
  }

  return questions.map((q) => ({
    question: String(q.question || "").trim(),
    answer: String(q.answer || "").trim(),
  }));
}

module.exports = { generateQuestions };

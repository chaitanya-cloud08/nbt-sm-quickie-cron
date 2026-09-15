// Turns today's articles into one evergreen GK question per article for the
// Quickie quiz. Deliberately steers away from facts tied to the specific
// ongoing story (scores, breaking developments, "as of today" figures) since
// those can change or age out before the card ships on social; instead it
// asks about the stable general-knowledge subject each article touches on.

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.QUICKIE_MODEL || "openai/gpt-oss-120b";
const MAX_ATTEMPTS = 4;
// Keep the avoid-list from ballooning the prompt on a long-running sheet.
const MAX_AVOID_LIST = 300;

function normalize(question) {
  return question.replace(/[\s।?!.,؟]/g, "").toLowerCase();
}

function buildPrompt(theme, articles, avoidQuestions) {
  const count = articles.length;
  const articleList = articles
    .map((a, i) => `${i + 1}. ${a.title}${a.synopsis ? ` — ${a.synopsis}` : ""}`)
    .join("\n");

  const avoidBlock =
    avoidQuestions.length > 0
      ? `\nThese questions have ALREADY been used on previous days — you must NOT repeat any of them, and must not ask the same fact rephrased:\n${avoidQuestions
          .slice(-MAX_AVOID_LIST)
          .map((q) => `- ${q}`)
          .join("\n")}\n`
      : "";

  return `You are building today's "Sabse Tez, Quickie Se" quiz card for NBT's Instagram/Facebook Stories.

Today's theme is: ${theme}

Here are ${count} articles from today's NBT feed for this theme (used only as topic inspiration):
${articleList}
${avoidBlock}
For EACH article, write one general-knowledge quiz question inspired by its broad subject area — NOT about the specific ongoing news event, and NOT reliant on any fact that could change (scores, ongoing figures, "as of now" details, breaking developments). The question must be a stable, evergreen general-knowledge fact related to the article's subject (e.g. if the article is about a cricket match, ask a GK question about cricket history/rules, not about the match result).

For EACH question also write 3 wrong options (distractors) for a multiple-choice card: plausible enough to genuinely make someone pause and think, of the same type/category as the correct answer (e.g. if the answer is a year, all 3 wrong options should also be years; if it's a person, all 3 should be people from the same field), but clearly and unambiguously incorrect once you know the real fact — never a second defensible right answer.

Rules:
- Write the question, the correct answer, and all 3 wrong options in Hindi, using Devanagari script (NBT is a Hindi publication) — not English, not Hinglish transliteration.
- Exactly ${count} questions, one per article, in the same order as the articles.
- Each question should be short, punchy, and quiz-card friendly.
- The correct answer and each wrong option should be short (a word or short phrase).
- Do not reference "the article" or "today's news" in the question.
- All ${count} questions must be about different facts from each other, and none may match or closely paraphrase any question in the "already used" list above.
- Respond with ONLY a JSON object of the form {"questions": [{"question": "...", "answer": "...", "wrongOptions": ["...", "...", "..."]}, ...]} containing exactly ${count} entries, each with exactly 3 wrongOptions, all text in Hindi (Devanagari). No markdown, no commentary, no extra keys.`;
}

function extractQuestions(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`Could not find JSON in model response: ${text}`);
    parsed = JSON.parse(match[0]);
  }
  return Array.isArray(parsed) ? parsed : parsed.questions;
}

async function callGroq(theme, articles, avoidQuestions) {
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
      max_tokens: 4096,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildPrompt(theme, articles, avoidQuestions) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq API request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!text.trim()) {
    throw new Error(`Groq returned an empty response. Full payload: ${JSON.stringify(data)}`);
  }
  const questions = extractQuestions(text);
  const expectedCount = articles.length;

  if (!Array.isArray(questions) || questions.length !== expectedCount) {
    throw new Error(`Expected exactly ${expectedCount} questions, got: ${JSON.stringify(questions)}`);
  }

  const normalized = questions.map((q) => ({
    question: String(q.question || "").trim(),
    answer: String(q.answer || "").trim(),
    wrongOptions: Array.isArray(q.wrongOptions)
      ? q.wrongOptions.map((o) => String(o || "").trim()).filter(Boolean)
      : [],
  }));

  const incomplete = normalized.find((q) => !q.question || !q.answer || q.wrongOptions.length !== 3);
  if (incomplete) {
    throw new Error(`Expected question + answer + 3 wrongOptions for every entry, got: ${JSON.stringify(incomplete)}`);
  }

  return normalized;
}

// Retries the whole batch (rather than patching individual questions) whenever
// a generated question exactly or near-exactly matches one already used, since
// that's simpler and the model reliably produces a fresh set on retry.
async function generateQuestions(theme, articles, usedQuestions = []) {
  const usedNormalized = new Set(usedQuestions.map(normalize));
  const avoidQuestions = [...usedQuestions];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let questions;
    try {
      questions = await callGroq(theme, articles, avoidQuestions);
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      console.log(`[quickie] attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.message}), retrying`);
      continue;
    }

    const batchNormalized = new Set();
    const duplicates = [];
    for (const q of questions) {
      const key = normalize(q.question);
      if (usedNormalized.has(key) || batchNormalized.has(key)) duplicates.push(q.question);
      batchNormalized.add(key);
    }

    if (duplicates.length === 0) return questions;

    console.log(
      `[quickie] attempt ${attempt}/${MAX_ATTEMPTS} produced ${duplicates.length} duplicate question(s), retrying`,
    );
    avoidQuestions.push(...duplicates);
  }

  throw new Error(`Could not generate ${articles.length} non-duplicate questions after multiple attempts`);
}

module.exports = { generateQuestions };

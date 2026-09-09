const { google } = require("googleapis");

const HEADER = ["Day", "Date", "Theme", "Question", "Answer", "Article Link"];

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  // Accept either the raw JSON or a base64-encoded copy of it (handy for
  // pasting a multi-line key into a single GitHub Actions secret).
  const jsonText = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(jsonText);
}

async function getSheetsClient() {
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function ensureHeader(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:F1`,
  });
  const firstRow = res.data.values?.[0];
  const hasHeader = firstRow && HEADER.every((h, i) => firstRow[i] === h);
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:F1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
  }
}

async function appendRows(rows) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID is not set");
  const sheetName = process.env.SHEET_NAME || "Sheet1";

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, spreadsheetId, sheetName);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1:F1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

module.exports = { appendRows, HEADER };

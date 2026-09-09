const { google } = require("googleapis");

const HEADER = ["Day", "Date", "Theme", "Question", "Correct Answer", "Option 2", "Option 3", "Option 4"];

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
    range: `${sheetName}!A1:H1`,
  });
  const firstRow = res.data.values?.[0];
  const hasHeader = firstRow && HEADER.every((h, i) => firstRow[i] === h);
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:H1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER] },
    });
  }
}

// Every question ever written to the sheet, so the generator can be told
// exactly what to avoid repeating.
async function getExistingQuestions() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID is not set");
  const sheetName = process.env.SHEET_NAME || "Sheet1";

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, spreadsheetId, sheetName);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!D2:D`,
  });

  const values = res.data.values || [];
  return [...new Set(values.map((row) => (row[0] || "").trim()).filter(Boolean))];
}

async function getSheetId(sheets, spreadsheetId, sheetName) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheet = meta.data.sheets.find((s) => s.properties.title === sheetName);
  if (!sheet) throw new Error(`Sheet tab "${sheetName}" not found`);
  return sheet.properties.sheetId;
}

// Inserts new rows directly under the header (row 1), pushing everything else
// down, so the most recent day's quiz always shows up on top.
async function prependRows(rows) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID is not set");
  const sheetName = process.env.SHEET_NAME || "Sheet1";

  const sheets = await getSheetsClient();
  await ensureHeader(sheets, spreadsheetId, sheetName);
  const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          insertDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 1 + rows.length },
            inheritFromBefore: false,
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A2:H${1 + rows.length}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

module.exports = { prependRows, getExistingQuestions, HEADER };

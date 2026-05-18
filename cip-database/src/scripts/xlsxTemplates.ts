// Generates placeholder .xlsx templates in data/ — one per source, with the
// expected header row and one sample row. Replace the sample rows with your
// real data, then run `npm run seed:xlsx`.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { SOURCES } from "./sources.js";

const DATA = resolve(process.cwd(), "data");
mkdirSync(DATA, { recursive: true });

for (const s of SOURCES) {
  const path = resolve(DATA, `${s.file}.xlsx`);
  if (existsSync(path)) {
    console.log(`skip (exists): data/${s.file}.xlsx`);
    continue;
  }
  // ensure every declared field is a column even if the sample omits it
  const rows = s.sample.map((r) => {
    const o: Record<string, unknown> = {};
    for (const f of s.fields) o[f] = r[f] ?? null;
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(rows, { header: s.fields });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "data");
  XLSX.writeFile(wb, path);
  console.log(`created: data/${s.file}.xlsx  (${s.fields.length} columns)`);
}

const readmePath = resolve(DATA, "README.md");
if (!existsSync(readmePath)) {
  writeFileSync(
    readmePath,
    `# Raw Data Drop-in (xlsx)

Put your real source exports here as **.xlsx**, one workbook per source,
named exactly as the templates:

${SOURCES.map((s) => `- \`${s.file}.xlsx\``).join("\n")}

Rules:
- Row 1 = column headers. Use the headers from the generated templates.
  Extra columns are kept (they flow into \`source_detail.raw_data\`); the
  named columns below are what entity resolution uses.
- One row per record. The **first sheet** of each workbook is read.
- Dates: any ISO string or an Excel date cell works.
- Booleans: \`TRUE\`/\`FALSE\` (or true/false) for fields like
  \`kev\`, \`mfa_enrolled\`, \`compliant\`.
- You only need to provide the files you have. Missing files fall back to
  whatever is already in \`seed/\` (generated or previous).

Pipeline:
\`\`\`
npm run xlsx:templates   # (re)create any missing templates here
# ... edit the .xlsx files with your data ...
npm run seed:xlsx        # ingest -> transform (entity resolution) -> load
\`\`\`

\`npm run ingest\` converts \`data/*.xlsx\` -> \`seed/*.json\` (the format the
transform consumes). It does not touch files you didn't provide.

Key fields per source (used for resolution / linking):

${SOURCES.map((s) => `**${s.file}**: ${s.fields.join(", ")}`).join("\n\n")}
`,
  );
  console.log("created: data/README.md");
}

console.log("\nTemplates ready in ./data — replace sample rows, then `npm run seed:xlsx`.");

// Converts data/*.xlsx -> seed/*.json (the shape src/scripts/transform.ts
// consumes). Schema-agnostic: the header row defines the fields, so each
// source can carry its own columns. Only files present in data/ are written;
// anything missing keeps its existing seed/ JSON.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import * as XLSX from "xlsx";

const DATA = resolve(process.cwd(), "data");
const SEED = resolve(process.cwd(), "seed");
mkdirSync(SEED, { recursive: true });

if (!existsSync(DATA)) {
  console.log("No data/ directory. Run `npm run xlsx:templates` first, or use `npm run seed` for synthetic data.");
  process.exit(0);
}

const files = readdirSync(DATA).filter(
  (f) => extname(f).toLowerCase() === ".xlsx" && !f.startsWith("~$"),
);

if (files.length === 0) {
  console.log("No .xlsx files in data/ — using existing seed/ JSON unchanged.");
  process.exit(0);
}

// light, predictable coercion of spreadsheet cell values
const coerce = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    return t;
  }
  return v;
};

let totalRows = 0;
for (const f of files) {
  const name = basename(f, ".xlsx"); // -> seed/<name>.json
  // XLSX.readFile is unavailable under ESM; read the buffer ourselves
  const wb = XLSX.read(readFileSync(resolve(DATA, f)), {
    type: "buffer",
    cellDates: true,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: true,
    defval: null,
  });
  const rows = raw.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(r)) o[String(k).trim()] = coerce(val);
    return o;
  });
  writeFileSync(resolve(SEED, `${name}.json`), JSON.stringify(rows, null, 2));
  console.log(`ingested: data/${f}  ->  seed/${name}.json  (${rows.length} rows)`);
  totalRows += rows.length;
}

console.log(
  `\nIngested ${files.length} workbook(s), ${totalRows} rows. ` +
  `Next: \`npm run transform && npm run load\` (or \`npm run seed:xlsx\`).`,
);

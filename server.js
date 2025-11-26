
import bodyParser from "body-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import fs from "fs";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { processPrompt } from "./boqEngine.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const MASTER_DIR = path.join(process.cwd(), "masters");
const EXTERNAL_MASTERS = process.env.MASTERS_PATH || "/mnt/data";
const MASTER_KEY = process.env.MASTER_KEY || "changeme";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";


// function loadJSON(name) {
//   const local = path.join(MASTER_DIR, name);
//   const external = path.join(EXTERNAL_MASTERS, name);
//   if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, "utf8"));
//   if (fs.existsSync(external)) return JSON.parse(fs.readFileSync(external, "utf8"));
//   return [];
// }



function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(MASTER_DIR , file), "utf8"));
}


export function loadMastersPreview() {
  return {
    basic: loadJson("Basic_Rate_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      CLASS: i.CLASS,
      SQFT: i.SQFT ?? null,
      SQMT: i.SQMT ?? null
    })),

    material: loadJson("Material_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      CLASS: i.CLASS,
      SQFT: i.SQFT ?? null,
      SQMT: i.SQMT ?? null
    })),

    labour: loadJson("Labour_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      SQFT: i.SQFT ?? null,
      SQMT: i.SQMT ?? null
    })),

    ml: loadJson("Material_Plus_Labour_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      SQFT: i.SQFT ?? null,
      SQMT: i.SQMT ?? null
    })),

    misc: loadJson("Misc_Parameter_Master.json").map(i => ({
      CODE: i.CODE,
      DESC: i.DESC,
      PERCENTAGE: i.PERCENTAGE,
      OVERALL: i.OVERALL,
      CLASS: i.CLASS
    }))
  };
}




app.post("/api/analyze", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ ok: false, error: "prompt required" });
    const result = processPrompt(prompt);
    return res.json({ ok: true, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/analyze_gpt", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt)
      return res.status(400).json({ ok: false, error: "prompt required" });

    if (!OPENAI_API_KEY)
      return res
        .status(500)
        .json({ ok: false, error: "OPENAI_API_KEY not set" });

    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // ========================================
    // JSON REPAIR FUNCTION — FIXES GPT OUTPUT
    // ========================================
    function repairJSON(text) {
      if (!text) return text;

      let cleaned = text.trim();

      // extract first JSON object
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];

      // Fix missing quotes around keys: ITEMS:FLEX → "ITEMS":FLEX
      cleaned = cleaned.replace(/(\w+):(?=\S)/g, '"$1":');

      // Fix missing quotes around string values (non-null / no numbers)
      cleaned = cleaned.replace(
        /:"([^"]*[a-zA-Z][^"]*)"/g,
        (m, val) => `:"${val}"`
      );

      // Fix trailing commas
      cleaned = cleaned.replace(/,\s*}/g, "}");
      cleaned = cleaned.replace(/,\s*]/g, "]");

      return cleaned;
    }

    // ============================
    // LOAD MASTER PREVIEW PROPERLY
    // ============================
    const masters = loadMastersPreview();
    const previewText = Object.keys(masters)
    .map(section => {
    const rows = masters[section]
      .map(i => {
        return [
          `CODE:${i.CODE ?? ""}`,
          `ITEMS:${i.ITEMS ?? ""}`,
          `CLASS:${i.CLASS ?? ""}`,
          `SQFT:${i.SQFT ?? ""}`,
          `SQMT:${i.SQMT ?? ""}`,
          `DESC:${i.DESC ?? ""}`,
          `PERCENTAGE:${i.PERCENTAGE ?? ""}`,
          `OVERALL:${i.OVERALL ?? ""}`
        ].join(" | ");
      })
      .join("\n");

    return section + ":\n" + rows;
  })
  .join("\n\n");


    // ============================
    // SYSTEM PROMPT
    // ============================
    const system = `
You are a BOQ assistant with 15 Year of Experience.

You must read the MASTERS PREVIEW exactly as truth.
Every row in preview includes: CODE, ITEMS, CLASS, SQFT, SQMT, DESC, PERCENTAGE, OVERALL.

===============================
MATERIAL RULES
===============================
1. Always check BASIC RATE MASTER first pick material from there and get there sqft and sqmt also .
2. If not found → fallback to MATERIAL MASTER and get there sqft and sqmt also.
3. Detect SECONDARY MATERIALS inside the item description and return them in MISC section.
4. Return EXACT fields:
   - CODE
   - ITEMS
   - CLASS
   - SQFT
   - SQMT
5. SQFT/SQMT conversion:
   - If SQFT exists and SQMT is null → SQMT = SQFT / 10.7639 (4 decimals)
   - If SQMT exists and SQFT is null → SQFT = SQMT * 10.7639 (4 decimals)
   - If both exist → do not modify
   - If both missing → keep both null

===============================
MISC RULES
===============================
1. Determine MATERIAL CLASS dominance by highest count.
2. Select misc ONLY for dominant class.
3. If no class detected → default = CIVIL.
4. Return EXACT:
   - CODE
   - DESC
   - PERCENTAGE
   - OVERALL

===============================
LABOUR RULES
===============================
1. Use LABOUR MASTER + MATERIAL+LABOUR MASTER.
2. Match based on work type in prompt.
3. Consider combination of words with Material and Labour and in words from Prompt For This .
4. Return EXACT:
   - CODE
   - ITEMS
   - SQFT (if exists)
   - SQMT (if exists)


===============================
OUTPUT FORMAT — STRICT JSON ONLY
===============================
{
  "material":[{"CODE":"", "ITEMS":"", "CLASS":"", "SQFT":null, "SQMT":null}],
  "work":[{"CODE":"", "ITEMS":"", "SQFT":null, "SQMT":null}],
  "misc":[{"CODE":"", "DESC":"", "PERCENTAGE":"", "OVERALL":""}],
  "explain":"short explanation"
}

NO TEXT outside JSON.
NO MARKDOWN.
NO COMMENTS.
`;

    // ============================
    // SEND TO GPT
    // ============================
    const messages = [
      {
        role: "system",
        content: system + "\n\nMASTERS PREVIEW:\n" + previewText
      },
      { role: "user", content: "Prompt: " + prompt + "\nReturn JSON only." }
    ];

    const response = await client.chat.completions.create({
      model: "gpt-5.1",
      messages,
      max_completion_tokens: 3000,
      temperature: 0.0
    });

    let text = response.choices?.[0]?.message?.content;

    // ============================
    // PARSE + AUTO-REPAIR JSON
    // ============================
    let jsonResult;

    try {
      const repaired = repairJSON(text);
      jsonResult = JSON.parse(repaired);
    } catch (err) {
      console.error("JSON parse failed:", text);
      return res.status(500).json({
        ok: false,
        error: "Invalid JSON returned by model",
        raw: text
      });
    }

    return res.json({ ok: true, result: jsonResult, raw: text });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});



app.post("/api/export-excel", async (req, res) => {
  try {
    const payload = req.body || {};
    const wb = new ExcelJS.Workbook();
    const mws = wb.addWorksheet("Materials");
    mws.addRow(["CODE", "ITEMS", "CLASS", "SQFT", "SQMT"]);
    (payload.material || []).forEach(m => mws.addRow([m.CODE || "", m.ITEMS || "", m.CLASS || "", m.SQFT || "", m.SQMT || ""]));
    const wws = wb.addWorksheet("Labour");
    wws.addRow(["CODE", "ITEMS"]);
    (payload.work || []).forEach(w => wws.addRow([w.CODE || "", w.ITEMS || ""]));
    const nws = wb.addWorksheet("Misc");
    nws.addRow(["CODE", "DESC", "PERCENTAGE", "OVERALL"]);
    (payload.misc || []).forEach(m => nws.addRow([m.CODE || "", m.DESC || "", m.PERCENTAGE || "", m.OVERALL || ""]));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="boq_result.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
});


app.post("/api/export-excel-gpt", async (req, res) => {
  try {
    const payload = req.body || {};

    const totalA = (payload.material || []).reduce((t, m) => t + (Number(m.SQMT) || 0), 0);
    const totalB = (payload.work || []).reduce((t, w) => t + (Number(w.SQMT) || 0), 0);
    const totalC = (payload.misc || []).reduce((t, m) => t + (Number(m.CALCULATED) || 0), 0);

    const totalOverall = totalA + totalB + totalC;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");

    // ------------------------------------------------------
    // MATERIAL SECTION
    // ------------------------------------------------------
    ws.addRow(["MATERIALS"]);
    ws.addRow(["CODE", "ITEMS", "CLASS", "SQFT", "SQMT"]);

    (payload.material || []).forEach(m =>
      ws.addRow([
        m.CODE || "",
        m.ITEMS || "",
        m.CLASS || "",
        m.SQFT || "",
        m.SQMT || ""
      ])
    );

    ws.addRow(["", "", "", "TOTAL A", totalA]);
    ws.addRow([]);
    ws.addRow([]);


      // ------------------------------------------------------
    // MISC SECTION
    // ------------------------------------------------------
    ws.addRow(["MISC"]);
    ws.addRow(["CODE", "DESC", "%", "CALCULATED (MISC)"]);

    (payload.misc || []).forEach(m =>
      ws.addRow([
        m.CODE || "",
        m.DESC || "",
        m.PERCENTAGE || "",
        m.CALCULATED?.toFixed(2) || ""
      ])
    );

    ws.addRow(["", "", "TOTAL C", totalC]);
    ws.addRow([]);
    ws.addRow([]);


    // ------------------------------------------------------
    // LABOUR SECTION
    // ------------------------------------------------------
    ws.addRow(["LABOUR"]);
    ws.addRow(["CODE", "ITEMS", "SQFT", "SQMT"]);

    (payload.work || []).forEach(w =>
      ws.addRow([
        w.CODE || "",
        w.ITEMS || "",
        w.SQFT || "",
        w.SQMT || ""
      ])
    );

    ws.addRow(["", "", "TOTAL B", totalB]);
    ws.addRow([]);
    ws.addRow([]);


  

    // ------------------------------------------------------
    // FINAL OVERALL TOTAL
    // ------------------------------------------------------
    ws.addRow(["OVERALL TOTAL (A + B + C)", totalOverall]);


    // ------------------------------------------------------
    // SEND FILE
    // ------------------------------------------------------
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="boq_result_one_sheet.xlsx"'
    );

    await wb.xlsx.write(res);
    res.end();

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


const upload = multer({ dest: path.join(process.cwd(), "tmp_uploads") });
app.post("/api/update-master", upload.single("file"), (req, res) => {
  try {
    const key = (req.headers["x-master-key"] || req.query.key || "").toString();
    if (!key || key !== MASTER_KEY) return res.status(401).json({ ok: false, error: "invalid master key" });
    if (!req.file) return res.status(400).json({ ok: false, error: "file required" });
    const dest = path.join(MASTER_DIR, req.file.originalname);
    fs.renameSync(req.file.path, dest);
    return res.json({ ok: true, savedTo: dest });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/masters", (req, res) => {
  const names = ["Basic_Rate_Master.json", "Material_Master_Classified_Final.json", "Material_Master.json", "Labour_Master.json", "Material_Plus_Labour_Master.json", "Misc_Parameter_Master_FINAL.json", "Misc_Parameter_Master.json"];
  const info = names.map(n => { const local = path.join(MASTER_DIR, n); const ext = path.join(EXTERNAL_MASTERS, n); return { name: n, localExists: fs.existsSync(local), externalExists: fs.existsSync(ext), used: fs.existsSync(local) ? local : (fs.existsSync(ext) ? ext : null) } });
  res.json({ ok: true, list: info });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log("BOQ GPT server running on port", PORT));

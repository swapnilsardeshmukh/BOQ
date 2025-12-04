
import bodyParser from "body-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import fs from "fs";
import multer from "multer";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
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



function deriveRate(item) {
  if (item.SQFT && item.SQMT) return item.SQFT;   // SQFT priority
  if (item.SQFT) return item.SQFT;
  if (item.SQMT) return item.SQMT;
  if (item.CUM) return item.CUM;
  if (item.KG) return item.KG;
  if (item["METRIC TON"]) return item["METRIC TON"];
  if (item.CFT) return item.CFT;
  if (item.RFT) return item.RFT;
  if (item.RMT) return item.RMT;
  if (item.NOS) return item.NOS;
  return 0;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(MASTER_DIR , file), "utf8"));
}

const allowedUOM = ["CUM","SQFT","SQMT","RFT","RMT","NOS","KG","TON","CFT"];

const uomAliases = {
  "NOS": ["NOS", "NO", "PCS", "PIECE", "PIECES", "UNIT", "UNITS"],
  "KG": ["KG", "KGS", "KILOGRAM", "KILOGRAMS"],
  "SQFT": ["SQFT","SFT","FT2","SQ. FT","SQ FEET","SQUARE FEET"],
  "SQMT": ["SQMT","SQM","M2","SQ. M","SQUARE METER"],
  "RFT": ["RFT","FT","FEET"],
  "RMT": ["RMT","MTR","METER","METRE"],
  "TON": ["TON","TONS","MT","METRIC TON"],
  "CUM": ["CUM","CBM","M3","CUBIC METER"],
  "CFT": ["CFT","CUFT","CUBIC FEET"]
};

export function normalizeUOM(item) {
  if (item.KG) return "KG";
  if (item.TON) return "TON";
  if (item.RFT) return "RFT";
  if (item.RMT) return "RMT";
  if (item.SQFT) return "SQFT";
  if (item.SQMT) return "SQMT";
  if (item.CUM) return "CUM";
  if (item.CFT) return "CFT";
  if (item.NOS) return "NOS";

  // fallback if everything is null and only then rely on raw UOM
  let raw = (item.UOM || "").toString().trim().toUpperCase();
  return raw || "NOS";
}

// function normalizeUOM(item) {
//   let uom = (item.UOM || "").toString().trim().toUpperCase();

//   // PRIORITY: SQFT over SQMT if both exist
//   if (item.SQFT && item.SQMT) return "SQFT";

//   // If only SQFT present
//   if (item.SQFT && !item.SQMT) return "SQFT";

//   // If only SQMT present
//   if (item.SQMT && !item.SQFT) return "SQMT";

//   // Validate UOM if provided
//   if (allowedUOM.includes(uom)) return uom;

//   // Default
//   return "NOS";
// }


export function loadMastersPreview() {

  const allowedUOM = ["CUM","SQFT","SQMT","RFT","RMT","NOS","KG","METRIC TON","CFT"];
  
  
  return {
    basic: loadJson("Basic_Rate_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      CLASS: i.CLASS,
      UOM: normalizeUOM(i),
      RATE: deriveRate(i)
    })),

    material: loadJson("Material_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      CLASS: i.CLASS,
      UOM: normalizeUOM(i),
      RATE: deriveRate(i)
    })),

    labour: loadJson("Labour_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      CLASS: i.CLASS ?? "",
      UOM: normalizeUOM(i),
      RATE:  deriveRate(i)
    })),

    ml: loadJson("Material_Plus_Labour_Master.json").map(i => ({
      CODE: i.CODE,
      ITEMS: i.ITEMS,
      CLASS: i.CLASS,
      UOM: normalizeUOM(i),
      RATE:  deriveRate(i)
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





// app.post("/api/analyze", async (req, res) => {
//   try {
//     const { prompt } = req.body;
//     if (!prompt) return res.status(400).json({ ok: false, error: "prompt required" });
//     const result = processPrompt(prompt);
//     return res.json({ ok: true, result });
//   } catch (e) {
//     console.error(e);
//     return res.status(500).json({ ok: false, error: e.message });
//   }
// });

app.post("/api/analyze_gpt", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt)
      return res.status(400).json({ ok: false, error: "prompt required" });

    const meaningful = prompt.replace(/\s/g, "");  // remove all spaces

   if (meaningful.length < 50)
    return res.status(400).json({
      ok: false,
      error: "Prompt must contain at least 50 meaningful characters."
    });

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
          `UOM:${i.UOM ?? ""}`,
          `RATE:${i.RATE ?? ""}`,
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
  You are a BOQ expert, Quantity Surveyor and Construction Estimator with 20+ years experience.

 You must read the MASTERS PREVIEW as absolute truth.
=================================================
GOAL
=================================================
Analyze the prompt text and return BOQ structured data using intelligent keyword matching and material/labour extraction rules, strictly mapped to Basic_Rate_Master.json 
and Material_Master.json.


  Every row in preview includes: CODE, ITEMS, CLASS, SQFT, SQMT, DESC, PERCENTAGE, OVERALL. 
  =============================== MATERIAL RULES =============================== 
  1. Always check BASIC RATE MASTER(Basic_Rate_Master.json) first pick material from there and get there sqft and sqmt also . 
  2. If not found → fallback to MATERIAL MASTER and get there sqft and sqmt also. 
  3. Detect SECONDARY MATERIALS (Material_master.json) inside the item description and return them in MISC section.
  (Dont take materials from "Material_Plus_Labour_Master.json" or "Misc_Parameter_Master.json" or "Labour_Master.json") 
  4. Return EXACT fields: - CODE - UOM - ITEMS - CLASS - Rate 
  5. SQFT/SQMT conversion: - If SQFT exists and SQMT is null → SQMT = SQFT / 10.7639 (4 decimals) - If SQMT exists and SQFT is null → SQFT = SQMT * 10.7639 (4 decimals) - If both exist → do not modify - If both missing → keep both null 
  6. UOM Rules: - Allowed UOM: CUM, SQFT, SQMT, RFT, RMT, NOS, KG, METRIC TON, CFT. - If both SQFT and SQMT exist -> UOM = SQFT - If only SQFT exists -> UOM = SQFT - 
  If only SQMT exists -> UOM = SQMT - Else if UOM not in allowed list -> UOM = NOS 
  7. Give rate according to UOM 
  8.Only include material items when explicit matching keywords from the prompt exist. - A material must have minimum keyword match: 
  at least one EXACT or strong keyword found in prompt text. - Reject items that only loosely relate by meaning 
  if the exact keywords are not found. - Example: Do NOT include items like “Aluminium Corner Guard Black 2800mm 38mm” unless prompt 
  includes keywords: "corner guard" OR "corner protection" OR "guard" OR "edge guard". - Generic words like "corner", "edge", "aluminium" WITHOUT specific qualifier 
  do NOT qualify. 
  9.Only include materials that are explicitly mentioned or logically required for execution as described in the prompt. 
  Do NOT include materials based on partial or generic keywords such as aluminium, corner, skirting, trim unless the prompt contains the 
  exact product category (e.g., “corner guard”, “skirting trim”, “aluminium profile”). Meaning should NOT be altered or assumed. If unsure whether material is needed,
   DO NOT include it.
  10 . Recheck Point No 3.(Dont take materials from "Material_Plus_Labour_Master.json" or "Misc_Parameter_Master.json" or "Labour_Master.json") 
  11. Material Validation for Material Rules : Recheck material list should be from Basic Or Material Master Only
  =============================== MISC RULES =============================== 
  1. Determine MATERIAL CLASS dominance by highest count. 
  2. Select misc ONLY for dominant class. 
  3. If no class detected → default = CIVIL. 
  4. Return EXACT: - CODE - DESC - PERCENTAGE - OVERALL 

 =============================== LABOUR RULES =============================== 
  1. Match based on the work activity described in the prompt.
   2. Use LABOUR MASTER + MATERIAL+LABOUR MASTER. 
  3. Return UOM always from allowed UOM list following priority rules. 
  4. Return EXACT: - CODE - ITEMS - UOM - RATE 
  5.Labour items must also be taken strictly from the context of the prompt only. Do NOT add labour items unless they are necessary to perform the described scope of work. 
  Do NOT infer labour items loosely using generic descriptions (e.g., carpentry labour, masonry labour, aluminium installation labour) unless these tasks are clearly described. 
  Labour tasks must match the materials retained and the actual work sequence described in the prompt. If unsure about a labour item, exclude it. 
  
  =============================== KEYWORD MATCHING RULES =============================== 
  1. The prompt must contain a clear reference to the item or KEY product feature. 
  2. Consider an item valid only if: - Exact MAIN keyword is present (e.g., "rockwool", "gypsum board", "ply backing", "ceiling channel") - or the material description contains at least one STRONG keyword. 
  3. STRONG keywords must match EXACT WORDS. Do not infer synonyms. 
  4. WEAK keywords (corner, aluminium, stud) alone should not trigger item selection.
  5. Example logic for item selection: - If material contains “Corner Guard” → prompt must contain "corner guard" OR "corner protection" - If material contains "38mm" →
   prompt must contain "38mm" - If material contains "2800mm" → prompt must contain "2800mm" 
   =============================== OUTPUT FORMAT — STRICT JSON ONLY =============================== 
   { "material":[{"CODE":"", "ITEMS":"", "CLASS":"", "UOM":"", "RATE":0}], 
    "work":[{"CODE":"", "ITEMS":"", "UOM":"", "RATE":0}], 
    "misc":[{"CODE":"", "DESC":"", "PERCENTAGE":"", "OVERALL":""}], "explain":"short explanation" 
    } 
    
    NO TEXT outside JSON. NO MARKDOWN. NO COMMENTS.
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

    const totalA = (payload.material || []).reduce((t, m) => t + (Number(m.AMOUNT) || 0), 0);
    const totalB = (payload.work || []).reduce((t, w) => t + (Number(w.AMOUNT) || 0), 0);
    const totalC = (payload.misc || []).reduce((t, m) => t + (Number(m.AMOUNT) || 0), 0);

    const totalOverall = totalA + totalB + totalC;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");

    ws.views = [{ state: "frozen", ySplit: 2 }];

    // -----------------------------------------
    // MATERIAL SECTION
    // -----------------------------------------
    ws.addRow(["MATERIALS"]).font = { bold: true, size: 14 };
    ws.addRow(["Code", "Items", "Class", "UOM", "Rate", "Qty", "Amount"]).font = { bold: true };

    (payload.material || []).forEach(m =>
      ws.addRow([
        m.CODE || "",
        m.ITEMS || "",
        m.CLASS || "",
        m.UOM || "",
        m.RATE || "",
        m.QTY || "",
        m.AMOUNT || ""
      ])
    );

    ws.addRow(["", "", "", "", "", "Total A", totalA]).font = { bold: true };
    ws.addRow([]);

    // -----------------------------------------
    // MISC SECTION
    // -----------------------------------------
    ws.addRow(["MISC"]).font = { bold: true, size: 14 };
    ws.addRow(["Code", "Description", "%", "Overall", "Calculated (C)", "Amount"]).font = { bold: true };

    (payload.misc || []).forEach(m =>
      ws.addRow([
        m.CODE || "",
        m.DESC || "",
        m.PERCENTAGE || "",
        m.OVERALL || "",
        m.CALCULATED?.toFixed(2) || "",
        m.AMOUNT?.toFixed(2) || ""
      ])
    );

    ws.addRow(["", "", "", "", "Total C", totalC]).font = { bold: true };
    ws.addRow([]);

    // -----------------------------------------
    // LABOUR SECTION
    // -----------------------------------------
    ws.addRow(["LABOUR"]).font = { bold: true, size: 14 };
    ws.addRow(["Code", "Items", "UOM", "Rate", "Qty", "Amount"]).font = { bold: true };

    (payload.work || []).forEach(w =>
      ws.addRow([
        w.CODE || "",
        w.ITEMS || "",
        w.UOM || "",
        w.RATE || "",
        w.QTY || "",
        w.AMOUNT || ""
      ])
    );

    ws.addRow(["", "", "", "", "Total B", totalB]).font = { bold: true };
    ws.addRow([]);

    // -----------------------------------------
    // SUMMARY SECTION
    // -----------------------------------------
    ws.addRow(["SUMMARY"]).font = { bold: true, size: 14 };
    ws.addRow(["Total A (Materials)", totalA]);
    ws.addRow(["Total B (Labour)", totalB]);
    ws.addRow(["Total C (Misc)", totalC]);
    ws.addRow(["OVERALL (A + B + C)", totalOverall]).font = { bold: true, size: 14 };

    // -----------------------------------------
    // AUTO COLUMN WIDTH
    // -----------------------------------------
    ws.columns.forEach(col => {
      let maxLength = 12;
      col.eachCell({ includeEmpty: true }, cell => {
        const len = cell.value ? cell.value.toString().length : 12;
        if (len > maxLength) maxLength = len;
      });
      col.width = maxLength + 4;
    });

    // -----------------------------------------
    // SEND FILE
    // -----------------------------------------
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="BOQ_Export.xlsx"'
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

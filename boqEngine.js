// boqEngine.js
// Full BOQ Engine - ES module
// Assumes master JSON files live in ./masters folder:
// Basic_Rate_Master.json, Material_Master.json, Labour_Master.json,
// Material_Plus_Labour_Master.json, Misc_Parameter_Master.json

import fs from "fs";
import path from "path";

const load = (file) =>
  JSON.parse(fs.readFileSync(path.join("masters", file), "utf8"));

const basicRate = load("Basic_Rate_Master.json");
const material = load("Material_Master.json");
const labour = load("Labour_Master.json");
const ml = load("Material_Plus_Labour_Master.json");
const misc = load("Misc_Parameter_Master.json");


function findGypsumItems() {
  return material.filter(m => {
    const cat = normalizeClass(m.CATEGORY);
    const itm = normalizeClass(m.ITEMS);
    const cls = normalizeClass(m.CLASS);

    return (
      itm.includes("gypsum") ||
      itm.includes("gyp") ||
      itm.includes("board") ||
      cat.includes("gyproc") ||
      cat.includes("gypsum") ||
      cat.includes("gyp") ||
      cat.includes("partition") ||
      cls.includes("gyproc") ||
      cls.includes("gypsum")
    );
  });
}
// ----------------------------------------------
// NORMALIZE CLASS  (spaces preserved)
// ----------------------------------------------
const normalizeClass = (s) => (s || "").toString().trim().toLowerCase();

// ----------------------------------------------
// EXTRACT SLAB SIZE
// ----------------------------------------------
function extractSlabSize(prompt) {
  const sizeRegex = /(\d+)\s*[xX]\s*(\d+)/;
  const match = (prompt || "").match(sizeRegex);
  if (!match) return null;

  let w = parseInt(match[1], 10);
  let h = parseInt(match[2], 10);

  // small numbers might be inches/feet; original logic scaled them
  if (w < 50 && h < 50) {
    w *= 300;
    h *= 300;
  }

  return { width: w, height: h, area: (w / 1000) * (h / 1000) };
}

// ----------------------------------------------
// DEDUPLICATE BY CODE
// ----------------------------------------------
const uniq = (arr) => {
  const seen = new Set();
  return (arr || []).filter((i) => {
    if (!i || !i.CODE) return false;
    if (seen.has(i.CODE)) return false;
    seen.add(i.CODE);
    return true;
  });
};

// ----------------------------------------------
// FIND BY CATEGORY (material master search)
// ----------------------------------------------
function findByCategory(keyword, category) {
  keyword = (keyword || "").toLowerCase();
  category = (category || "").toLowerCase();
  return material.filter(
    (m) =>
      (m.ITEMS || "").toString().toLowerCase().includes(keyword) &&
      (m.CATEGORY || "").toString().toLowerCase().includes(category)
  );
}

// ----------------------------------------------
// CODE -> CLASS mapping (partial-match on CODE allowed)
// order matters (more specific keys first)
// ----------------------------------------------
const codeClassMap = [
  { key: "millwork", class: "MILL WORK" },
  { key: "mill-work", class: "MILL WORK" },
  { key: "carpentry", class: "MILL WORK" },
  { key: "gypsum", class: "GYPSUM" },
  { key: "glass", class: "GLASS" },
  { key: "plywood", class: "WOOD" },
  { key: "ply", class: "WOOD" },
  { key: "wood", class: "WOOD" },
  { key: "granite", class: "CIVIL" },
  { key: "marble", class: "CIVIL" },
  { key: "stone", class: "CIVIL" },
  { key: "tile", class: "CIVIL" },
  { key: "civil", class: "CIVIL" }
];

function detectClassFromCode(item) {
  if (!item || !item.CODE) return null;
  const code = item.CODE.toString().toLowerCase();
  for (const row of codeClassMap) {
    if (code.includes(row.key)) return row.class;
  }
  return null;
}

// ----------------------------------------------
// ASSIGN CLASS (keeps existing, tries CODE detection, then fallback)
// ----------------------------------------------
function assignClass(item, fallbackClass) {
  if (!item) return null;
  // If item already has class (non-empty) -> keep it
  if (item.CLASS && String(item.CLASS).trim() !== "") return item.CLASS;

  // Detect via CODE
  const detected = detectClassFromCode(item);
  if (detected) {
    item.CLASS = detected;
    return detected;
  }

  // Use fallback if provided
  if (fallbackClass) {
    item.CLASS = fallbackClass;
    return fallbackClass;
  }

  return null;
}

// -------------------------------------------------------
// STRICT & FINAL MISC LOGIC (uses CODE detection first)
// -------------------------------------------------------
function computeMisc(finalMaterialList) {
  let classSet = new Set();

  (finalMaterialList || []).forEach((m) => {
    const fromCode = detectClassFromCode(m);

    if (fromCode) {
      classSet.add(normalizeClass(fromCode));
      return;
    }

    if (m.CLASS) {
      classSet.add(normalizeClass(m.CLASS));
      return;
    }

    if (m.CATEGORY && material.some(mt => mt.CODE === m.CODE)) {
      classSet.add(normalizeClass(m.CATEGORY));
      return;
    }
  });

  // ---------------------------------------------
  // ⭐ NEW RULE: CIVIL IS LOWEST PRIORITY
  // If any non-civil class exists → remove civil
  // ---------------------------------------------
  if (classSet.size > 1 && classSet.has("civil")) {
    classSet.delete("civil");
  }

  // If still empty → civil only
  if (classSet.size === 0) classSet.add("civil");

  const selected = [];
  const miscClasses = new Set(misc.map((r) => normalizeClass(r.CLASS)));

  let anyNonCivilAdded = false;

  classSet.forEach((cls) => {
    if (miscClasses.has(cls)) {
      misc.forEach((row) => {
        if (normalizeClass(row.CLASS) === cls) selected.push(row);
      });
      if (cls !== "civil") anyNonCivilAdded = true;
    }
  });

  // add civil ONLY IF no other class found
  if (!anyNonCivilAdded) {
    misc.forEach((row) => {
      if (normalizeClass(row.CLASS) === "civil") selected.push(row);
    });
  }

  return uniq(selected);
}

// -------------------------------------------------------
// MAIN BOQ ENGINE (processPrompt) - full integrated logic
// -------------------------------------------------------
export function processPrompt(prompt) {
  const final = { material: [], misc: [], work: [] };
  const p = (prompt || "").toString().toLowerCase();

  // -----------------------
  // TILE
  // -----------------------
  if (p.includes("tile")) {
    const item = basicRate.find((i) => i && i.CODE === "M+BR+TILE-08");
    if (item) {
      assignClass(item, "CIVIL");
      final.material.push(item);
    }
  }

  // -----------------------
  // VINYL
  // -----------------------
  if (p.includes("vinyl") || p.includes("protection")) {
    const item = material.find((i) => i && i.CODE === "M-MISC-26");
    if (item) {
      // let code detection decide class if item has code; don't force override
      assignClass(item);
      final.material.push(item);
    }
  }

  // -----------------------
  // EPOXY
  // -----------------------
  if (p.includes("epoxy")) {
    const item = ml.find((i) => i && i.CODE === "M+LC-CIVIL-EPOXY GROUT-01");
    if (item) final.work.push(item);
  }

  // -----------------------
  // MORTAR
  // -----------------------
  if (p.includes("mortar") || p.includes("cm 1:4")) {
    const item = ml.find((i) => i && i.CODE === "M+LC-CIVIL-28");
    if (item) final.work.push(item);
  }

  // -----------------------
  // MARBLE
  // -----------------------
  if (p.includes("marble")) {
    const size = extractSlabSize(prompt);
    let marbleCode = "M+BR+STONE-05";
    if (p.includes("italian") || p.includes("premium")) marbleCode = "M+BR+STONE-07";
    if (size) marbleCode = size.area > 1.5 ? "M+BR+STONE-07" : "M+BR+STONE-05";

    const mItem = basicRate.find((i) => i && i.CODE === marbleCode);
    if (mItem) {
      assignClass(mItem, "CIVIL");
      final.material.push(mItem);
    }
  }

  // -----------------------
  // LABOUR (default floor labor selection)
  // -----------------------
  if (p.includes("marble")) {
    const lab = labour.find((i) => i && i.CODE === "LC-CIVIL-FLR-12");
    if (lab) final.work.push(lab);
  } else {
    const lab = labour.find((i) => i && i.CODE === "LC-CIVIL-FLR-01");
    if (lab) final.work.push(lab);
  }

  // -----------------------
  // GYPSUM
  // -----------------------
  if (
    p.includes("gypsum") ||
    p.includes("partition") ||
    p.includes("false ceiling") ||
    p.includes("gyp")||
    p.includes("gyprock")
  ) {
      const gy = findGypsumItems();
      gy.forEach(x => {
          assignClass(x, "GYPSUM");
          final.material.push(x);
      });
  }

  // -----------------------
  // GRANITE
  // -----------------------
  if (p.includes("granite")) {
    const gr = findByCategory("granite", "stone");
    gr.forEach((x) => {
      assignClass(x, "CIVIL");
      final.material.push(x);
    });
    const lab = labour.find((i) => i && i.CODE === "LC-CIVIL-FLR-13");
    if (lab) final.work.push(lab);
  }

  // -----------------------
  // GLASS
  // -----------------------
  if (p.includes("glass")) {
    const gl = findByCategory("glass", "glass");
    gl.forEach((x) => {
      assignClass(x, "GLASS");
      final.material.push(x);
    });
  }

  // -----------------------
  // WOOD / PLY
  // -----------------------
  if (p.includes("ply") || p.includes("wood")) {
    const pw = findByCategory("", "ply");
    pw.forEach((x) => {
      assignClass(x, "WOOD");
      final.material.push(x);
    });
  }

  // -----------------------
  // MILL WORK / CARPENTRY
  // -----------------------
  if (p.includes("mill work") || p.includes("millwork") || p.includes("carpentry")) {
    const mw = findByCategory("", "mill work");
    // If findByCategory returned nothing, try a broader search in material
    if (!mw || mw.length === 0) {
      // fallback: try items whose CODE contains millwork
      const candidates = material.filter((m) => m && m.CODE && m.CODE.toLowerCase().includes("millwork"));
      candidates.forEach((x) => {
        assignClass(x, "MILL WORK");
        final.material.push(x);
      });
    } else {
      mw.forEach((x) => {
        assignClass(x, "MILL WORK");
        final.material.push(x);
      });
    }
  }

  // -----------------------
  // ADDITIONAL GENERIC RULES (examples)
  // -----------------------
  // stone/tiles mentioned as material in prompt try to find in material master too
  if (p.includes("stone")) {
    const st = findByCategory("stone", "stone");
    st.forEach((x) => {
      assignClass(x, "CIVIL");
      final.material.push(x);
    });
  }

  // -----------------------
  // REMOVE DUPES (by CODE)
  // -----------------------
  final.material = uniq(final.material);
  final.work = uniq(final.work);

  // -----------------------
  // COMPUTE MISC (strict class-based)
  // -----------------------
  final.misc = computeMisc(final.material);

  // -----------------------
  // RETURN
  // -----------------------
  return final;
}

// Default export for convenience
export default { processPrompt };

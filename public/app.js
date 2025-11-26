async function postJson(url, body){
  const r = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return r.json();
}
document.getElementById("analyze").addEventListener("click", async ()=>{
  const prompt = document.getElementById("prompt").value.trim();
  if(!prompt) return alert("Type prompt");
  document.getElementById("result").innerHTML = "<p>Working (local)...</p>";
  const r = await postJson("/api/analyze", { prompt });
  if(!r.ok) return document.getElementById("result").innerText = "Error: "+(r.error||JSON.stringify(r));
  renderResult(r.result);
});
document.getElementById("analyze_gpt").addEventListener("click", async ()=>{
  const prompt = document.getElementById("prompt").value.trim();
  if(!prompt) return alert("Type prompt");
  document.getElementById("result").innerHTML = "<p>Working (GPT)...</p>";
  const r = await postJson("/api/analyze_gpt", { prompt });
  if(!r.ok) return document.getElementById("result").innerText = "Error: "+(r.error||JSON.stringify(r));
  renderResultGPT(r.result.result || r.result);
});
function renderResult(out){
  let html = `<h3>Materials (${(out.material||[]).length})</h3><table><tr><th>Code</th><th>Items</th><th>Class</th></tr>`;
  (out.material||[]).forEach(m=> html+=`<tr><td>${m.CODE||""}</td><td>${m.ITEMS||""}</td><td>${m.CLASS||""}</td></tr>`);
  html += "</table>";
  html += `<h3>Labour (${(out.work||[]).length})</h3><table><tr><th>Code</th><th>Items</th></tr>`;
  (out.work||[]).forEach(w=> html+=`<tr><td>${w.CODE||""}</td><td>${w.ITEMS||""}</td></tr>`);
  html += "</table>";
  html += `<h3>Misc (${(out.misc||[]).length})</h3><table><tr><th>Code</th><th>Description</th><th>Percentage</th><th>Overall</th></tr>`;
  (out.misc||[]).forEach(m=> html+=`<tr><td>${m.CODE||""}</td><td>${m.DESC||m.CIVIL||""}</td><td>${m.PERCENTAGE||m["%"]||""}</td><td>${m.OVERALL||m["0.07"]||""}</td></tr>`);
  html += "</table>";
  document.getElementById("result").innerHTML = html;
  const btn = document.getElementById("download"); btn.disabled=false;
  btn.onclick = async ()=>{
    const resp = await fetch("/api/export-excel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(out)});
    const blob = await resp.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download="boq_result.xlsx"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
}

function calculateTotals(out) {

  // A = Material Total SQMT
  out.totalA = (out.material || [])
    .reduce((sum, m) => sum + (Number(m.SQMT) || 0), 0);

  // B = Labour Total SQMT
  out.totalB = (out.work || [])
    .reduce((sum, w) => sum + (Number(w.SQMT) || 0), 0);

  // C = Misc Calculations (percentage of A)
  let miscSum = 0;

  out.misc = (out.misc || []).map(x => {
    const calc = out.totalA * ((Number(x.PERCENTAGE) || 0) / 100);
    miscSum += calc;

    return {
      ...x,
      CALCULATED: calc
    };
  });

  out.totalC = miscSum;

  // OVERALL = A + B + C
  out.totalOverall = out.totalA + out.totalB + out.totalC;

  return out;
}

// -------------------------------
// TOTAL CALCULATION LOGIC
// -------------------------------
function calculateTotals(out) {

  // A = Material Total SQMT
  out.totalA = (out.material || [])
    .reduce((sum, m) => sum + (Number(m.SQMT) || 0), 0);

   // A = Material Total SQFT
   out.totalASQFT = (out.material || [])
   .reduce((sum, m) => sum + (Number(m.SQFT) || 0), 0);  

  // B = Labour Total SQMT
  out.totalB = (out.work || [])
    .reduce((sum, w) => sum + (Number(w.SQMT) || 0), 0);

  out.totalBSQFT = (out.work || [])
    .reduce((sum, w) => sum + (Number(w.SQFT) || 0), 0); 

  // C = Misc Calculations (percentage of A)
  let miscSum = 0;

  out.misc = (out.misc || []).map(x => {
    const calc = out.totalA * ((Number(x.PERCENTAGE) || 0));
    miscSum += calc;

    return {
      ...x,
      CALCULATED: calc
    };
  });

  out.totalC = miscSum;

  // OVERALL = A + B + C
  out.totalOverall = out.totalA + out.totalB + out.totalC;

  return out;
}



// -------------------------------
// MAIN RENDER FUNCTION
// -------------------------------
function renderResultGPT(out) {

  // compute totals before rendering
  out = calculateTotals(out);

  let html = "";


  // ---------------------------------------------------------------------------------------
  // MATERIAL SECTION (A)
  // ---------------------------------------------------------------------------------------
  html += `<h3>Materials (${(out.material||[]).length})</h3>
  <table>
    <tr>
      <th>Code</th>
      <th>Items</th>
      <th>Class</th>
      <th>SQFT</th>
      <th>SQMT</th>
    </tr>`;

  (out.material || []).forEach(m =>
    html += `<tr>
      <td>${m.CODE || ""}</td>
      <td>${m.ITEMS || ""}</td>
      <td>${m.CLASS || ""}</td>
      <td>${m.SQFT ?? ""}</td>
      <td>${m.SQMT ?? ""}</td>
    </tr>`
  );

  html += `<tr>Total For Materials <td></td><td></td><td></td>
          <td> ${out.totalASQFT.toFixed(2)}  </td>
          <td><b>${out.totalA.toFixed(2)}</td></b></tr></table>

  <br>`;





  // ---------------------------------------------------------------------------------------
  // MISC SECTION (C)
  // ---------------------------------------------------------------------------------------
  html += `<h3>Misc (${(out.misc||[]).length})</h3>
  <table>
    <tr>
      <th>Code</th>
      <th>Description</th>
      <th>%</th>
       <th>Overall</th>
      <th>Calculated (C)</th>
    </tr>`;

  (out.misc || []).forEach(m =>
    html += `<tr>
      <td>${m.CODE}</td>
      <td>${m.DESC || m.CIVIL || ""}</td>
      <td>${m.PERCENTAGE * 100}</td>
       <td>${m.OVERALL}</td>
      <td>${m.CALCULATED.toFixed(2)}</td>
    </tr>`
  );

  html += `<tr>
          <td>Total C (Misc Total)</td>
          <td></td><td></td><td></td>
          <td>${out.totalC.toFixed(2)}</td>
          </table>
  
  <br>`;

    // ---------------------------------------------------------------------------------------
  // LABOUR SECTION (B)
  // ---------------------------------------------------------------------------------------
  html += `<h3>Labour (${(out.work||[]).length})</h3>
  <table>
    <tr>
      <th>Code</th>
      <th>Items</th>
      <th>SQFT</th>
      <th>SQMT</th>
    </tr>`;

  (out.work || []).forEach(w =>
    html += `<tr>
      <td>${w.CODE || ""}</td>
      <td>${w.ITEMS || ""}</td>
      <td>${w.SQFT ?? ""}</td>
      <td>${w.SQMT ?? ""}</td>
    </tr>`
  );

  // html += `</table>
  // <div><b>Total B (Labour SQMT): ${out.totalB.toFixed(2)}</b></div>
  // <br>`;

  html += `<tr><td>Total For Labour </td>
  <td></td>
  <td> ${out.totalBSQFT.toFixed(2)}  </td>
  <td><b>${out.totalB.toFixed(2)}</td></b></tr></table>

<br>`;


  // ---------------------------------------------------------------------------------------
  // FINAL OVERALL TOTAL
  // ---------------------------------------------------------------------------------------
  html += `<h2>OVERALL TOTAL (A + B + C): ${out.totalOverall.toFixed(2)}</h2>`;



  // ---------------------------------------------------------------------------------------
  // FINAL HTML OUTPUT
  // ---------------------------------------------------------------------------------------
  document.getElementById("result").innerHTML = html;

  const btn = document.getElementById("download");
  btn.disabled = false;

  btn.onclick = async () => {
    const resp = await fetch("/api/export-excel-gpt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(out)
    });

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "boq_result.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
}

// function renderResultGPT(out){
//   // MATERIAL
//   let html = `<h3>Materials (${(out.material||[]).length})</h3>
//   <table>
//     <tr>
//       <th>Code</th>
//       <th>Items</th>
//       <th>Class</th>
//       <th>SQFT</th>
//       <th>SQMT</th>
//     </tr>`;

//   (out.material||[]).forEach(m=> 
//     html += `<tr>
//       <td>${m.CODE||""}</td>
//       <td>${m.ITEMS||""}</td>
//       <td>${m.CLASS||""}</td>
//       <td>${m.SQFT ?? ""}</td>
//       <td>${m.SQMT ?? ""}</td>
//     </tr>`
//   );

//   html += "</table>";

//   // LABOUR
//   html += `<h3>Labour (${(out.work||[]).length})</h3>
//   <table>
//     <tr>
//       <th>Code</th>
//       <th>Items</th>
//       <th>SQFT</th>
//       <th>SQMT</th>
//     </tr>`;

//   (out.work||[]).forEach(w=> 
//     html+= `<tr>
//       <td>${w.CODE||""}</td>
//       <td>${w.ITEMS||""}</td>
//       <td>${w.SQFT ?? ""}</td>
//       <td>${w.SQMT ?? ""}</td>
//     </tr>`
//   );

//   html += "</table>";

//   // MISC
//   html += `<h3>Misc (${(out.misc||[]).length})</h3>
//   <table>
//     <tr>
//       <th>Code</th>
//       <th>Description</th>
//       <th>Percentage</th>
//       <th>Overall</th>
//     </tr>`;

//   (out.misc||[]).forEach(m=> 
//     html+= `<tr>
//       <td>${m.CODE||""}</td>
//       <td>${m.DESC||m.CIVIL||""}</td>
//       <td>${m.PERCENTAGE||m["%"]||""}</td>
//       <td>${m.OVERALL||""}</td>
//     </tr>`
//   );

//   html += "</table>";

//   document.getElementById("result").innerHTML = html;

//   const btn = document.getElementById("download");
//   btn.disabled=false;
//   btn.onclick = async ()=>{
//     const resp = await fetch("/api/export-excel",{
//       method:"POST",
//       headers:{"Content-Type":"application/json"},
//       body:JSON.stringify(out)
//     });

//     const blob = await resp.blob();
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href=url;
//     a.download="boq_result.xlsx";
//     document.body.appendChild(a);
//     a.click();
//     a.remove();
//     URL.revokeObjectURL(url);
//   };
// }

document.getElementById("listMasters").addEventListener("click", async ()=>{
  const r = await fetch("/api/masters"); const j = await r.json(); document.getElementById("masters").innerText = JSON.stringify(j,null,2);
});
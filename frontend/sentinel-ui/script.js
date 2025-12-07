// frontend/sentinel-ui/script.js
const API = "http://127.0.0.1:8000";

// --- routing ---
document.querySelectorAll(".sidebar nav a").forEach(a=>{
  a.addEventListener("click", e=>{
    document.querySelectorAll(".sidebar nav a").forEach(x=>x.classList.remove("active"));
    a.classList.add("active");
    const page = a.dataset.page;
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    document.getElementById(page).classList.add("active");
  });
});

// elements
const scanBtn = document.getElementById("scanBtn");
const alertsList = document.getElementById("alertsList");
const metricsContainer = document.getElementById("metrics-container");
const riskCanvas = document.getElementById("riskChart").getContext("2d");
let riskChart = null;

// Initialize map (Leaflet)
let map = L.map('map', {zoomControl:false}).setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:''}).addTo(map);
let markers = [];

function addMarker(lat, lon, color="#ff6b6b") {
  const m = L.circleMarker([lat,lon], {radius:6, color:color, fillColor:color, fillOpacity:0.9}).addTo(map);
  markers.push(m);
  if (markers.length>40) {
    const old = markers.shift();
    map.removeLayer(old);
  }
}

// helper: create circular metric DOM
function createMetricElement(id, label) {
  const el = document.createElement("div");
  el.className = "metric-card";
  el.innerHTML = `
    <div id="${id}" class="progress-circle" data-value="0"><span class="metric-value">--</span></div>
    <div class="metric-label">${label}</div>
  `;
  return el;
}

// populate metrics initially
metricsContainer.appendChild(createMetricElement("metric_risk", "Latest Risk"));
metricsContainer.appendChild(createMetricElement("metric_dci", "Digital Certainty Index"));
metricsContainer.appendChild(createMetricElement("metric_aq", "Assurance Quality"));

// animate circular progress
function setCircleValue(id, value, color) {
  const wrapper = document.getElementById(id);
  const val = Math.round(value);
  const angle = (val / 100) * 360;
  wrapper.style.background = `conic-gradient(${color} ${angle}deg, #2b2f38 ${angle}deg)`;
  const span = wrapper.querySelector(".metric-value");
  span.innerText = val + "%";
}

// update risk chart with history data
function updateRiskChart(history) {
  const last = history.slice(-60);
  const labels = last.map(e => new Date(e.timestamp).toLocaleTimeString());
  const data = last.map(e => e.risk);
  if (riskChart) riskChart.destroy();
  riskChart = new Chart(riskCanvas, {
    type:'line',
    data: {
      labels,
      datasets: [{
        label: 'Risk',
        data,
        borderColor: '#ff8c6b',
        tension: 0.25,
        fill: true,
        backgroundColor: 'rgba(255,140,107,0.06)'
      }]
    },
    options: {
      scales: { y: { min:0, max:100 } },
      plugins: { legend: { display: false } }
    }
  });
}

// show alerts
function showAlerts(history) {
  alertsList.innerHTML = "";
  const recent = history.slice().reverse().slice(0,8);
  recent.forEach(e=>{
    const div = document.createElement("div");
    div.className = "alert-row";
    div.innerHTML = `<div style="max-width:80%"><strong>${e.status}</strong><div style="font-size:12px;color:#9acbff">${new Date(e.timestamp).toLocaleString()}</div><div style="font-size:12px;color:#cfe7ff">Site: ${e.site_id||"-"} Port: ${e.port||"-"}</div></div><div style="min-width:60px;text-align:right">${e.risk}</div>`;
    alertsList.appendChild(div);
  });
}

// render ports
async function renderPorts(ports) {
  const div = document.getElementById("portsTable");
  if (!ports || ports.length===0) { div.innerHTML = "<i>No ports registered</i>"; return; }
  let html = "<table><thead><tr><th>Port</th><th>Protocol</th><th>Site</th><th>Notes</th></tr></thead><tbody>";
  ports.forEach(pt=>{
    html += `<tr><td>${pt.port}</td><td>${pt.protocol||''}</td><td>${pt.site_id||''}</td><td>${pt.notes||''}</td></tr>`;
  });
  html += "</tbody></table>";
  div.innerHTML = html;
}

// refresh dashboard: stats, map marker, charts, ports
async function refresh() {
  try {
    const res = await fetch(API + "/stats");
    const j = await res.json();
    const history = j.history || [];
    // update circular metrics with last event or defaults
    if (history.length) {
      const last = history[history.length-1];
      setCircleValue("metric_risk", last.risk, last.risk > 70 ? "#ff7043" : (last.risk>40? "#ffc107" : "#00c853"));
      setCircleValue("metric_dci", last.dci, "#29b6f6");
      setCircleValue("metric_aq", last.assurance_quality, "#7c4dff");
    } else {
      setCircleValue("metric_risk", 0, "#00c853");
      setCircleValue("metric_dci", 0, "#29b6f6");
      setCircleValue("metric_aq", 0, "#7c4dff");
    }
    showAlerts(history);
    updateRiskChart(history);

    // add map marker for suspicious/high events
    if (history.length) {
      const last = history[history.length-1];
      if (last.level === "high" || last.level === "medium") {
        // simulate random geo; in production, use geoIP or site coords
        const lat = (Math.random()*140)-70;
        const lon = (Math.random()*360)-180;
        addMarker(lat, lon, last.level === "high" ? "#ff4d4f" : "#ffa726");
      }
    }

    // fetch ports
    const p = await fetch(API + "/ports");
    const ports = await p.json();
    renderPorts(ports);
  } catch (e) {
    console.error("refresh error", e);
  }
}

// run scan
scanBtn.addEventListener("click", async () => {
  const payload = {
    timestamp: document.getElementById("ts_manual").value || null,
    duration: Number(document.getElementById("duration").value||0),
    src_bytes: Number(document.getElementById("src").value||0),
    dst_bytes: Number(document.getElementById("dst").value||0),
    failed_logins: Number(document.getElementById("fails").value||0),
    port: Number(document.getElementById("port").value||0) || null,
    protocol: document.getElementById("protocol").value || null,
    site_id: document.getElementById("site_id").value || null
  };
  scanBtn.disabled = true;
  scanBtn.innerText = "Scanning...";
  try {
    const res = await fetch(API + "/predict", {
      method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)
    });
    const j = await res.json();
    alert(`${j.status}\nRisk: ${j.risk}\nDCI: ${j.dci}\nAQ: ${j.assurance_quality}`);
    await refresh();
  } catch (e) {
    alert("Backend unreachable. Start backend (run uvicorn main:app --reload)");
    console.error(e);
  } finally {
    scanBtn.disabled = false;
    scanBtn.innerText = "RUN SCAN";
  }
});

// sites handling
document.getElementById("addSiteBtn").addEventListener("click", async ()=>{
  const site = {
    site_id: document.getElementById("site_id_in").value || ("site-"+Date.now()),
    site_name: document.getElementById("site_name_in").value || "",
    domain: document.getElementById("domain_in").value || "",
    homepage: document.getElementById("homepage_in").value || ""
  };
  await fetch(API + "/sites", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(site)});
  loadSites();
});

async function loadSites(){
  const r = await fetch(API + "/sites");
  const s = await r.json();
  const el = document.getElementById("sitesList");
  el.innerHTML = s.map(x=>`<div class="card" style="margin-bottom:8px;padding:10px"><strong>${x.site_id} — ${x.site_name}</strong><div>${x.domain}</div><div style="font-size:12px;color:#9acbff">${x.homepage}</div></div>`).join("");
}

// download report
document.getElementById("downloadReport").addEventListener("click", async ()=>{
  const r = await fetch(API + "/report");
  const j = await r.json();
  document.getElementById("reportArea").innerText = JSON.stringify(j, null, 2);
});

// append logs to Live Monitor
async function loadLogs() {
  const r = await fetch(API + "/logs");
  const j = await r.json();
  const logs = j.history || [];
  const el = document.getElementById("liveLogs");
  el.innerHTML = logs.slice().reverse().slice(0,200).map(e=>`<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.03)"><strong>${e.status}</strong> — ${e.risk} — ${new Date(e.timestamp).toLocaleString()} — Site:${e.site_id||"-"} Port:${e.port||"-"}</div>`).join("");
}

// render ports table on load
async function initialLoadPorts(){
  const r = await fetch(API + "/ports");
  const p = await r.json();
  renderPorts(p);
}

// live time update
function updateNow() {
  document.getElementById("nowtime").innerText = new Date().toLocaleString();
}

// start
window.addEventListener("load", async ()=>{
  await refresh();
  await loadSites();
  await loadLogs();
  await initialLoadPorts();
  updateNow();
  setInterval(refresh, 4000);
  setInterval(loadLogs, 5000);
  setInterval(updateNow, 1000);
});

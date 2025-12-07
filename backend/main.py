# backend/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import numpy as np
from datetime import datetime
import json
from pathlib import Path

# --------- Configuration ----------
MODEL_PATH = Path("sentinel_model.pkl")
HISTORY_FILE = Path("history.json")
SITES_FILE = Path("sites.json")
PORTS_FILE = Path("ports.json")
HISTORY_MAX = 2000

# Ensure storage files exist
for p in (HISTORY_FILE, SITES_FILE, PORTS_FILE):
    if not p.exists():
        p.write_text("[]")

def read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return []

def write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2))

def append_history(event: dict):
    h = read_json(HISTORY_FILE)
    h.append(event)
    # keep latest HISTORY_MAX
    h = h[-HISTORY_MAX:]
    write_json(HISTORY_FILE, h)

# --------- Load model ----------
if not MODEL_PATH.exists():
    raise RuntimeError(f"Model file not found at {MODEL_PATH}. Train or place sentinel_model.pkl in backend folder.")
model = joblib.load(str(MODEL_PATH))

# --------- FastAPI ----------
app = FastAPI(title="Sentinel AI Backend (Demo)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo only, restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------- Data models ----------
class PredictRequest(BaseModel):
    # optional manual timestamp (ISO or datetime-local formatted)
    timestamp: str | None = None
    duration: float
    src_bytes: float
    dst_bytes: float
    failed_logins: int = 0
    port: int | None = None
    protocol: str | None = None
    site_id: str | None = None
    site_name: str | None = None
    domain: str | None = None
    homepage: str | None = None
    extra_meta: dict | None = None

@app.get("/")
def home():
    return {"message": "Sentinel AI backend running"}

@app.post("/predict")
def predict(payload: PredictRequest):
    # Prepare vector for model
    x = np.array([[payload.duration, payload.src_bytes, payload.dst_bytes, payload.failed_logins]])

    # Model outputs
    score = float(model.decision_function(x)[0])   # IsolationForest: larger -> more normal
    pred_raw = int(model.predict(x)[0])            # 1 normal, -1 anomaly

    # Map to risk (0..100) — invert score for risk
    risk = round((-(score)) * 20 + 50, 2)
    risk = float(max(0.0, min(100.0, risk)))

    # Digital Certainty Index (DCI) and Assurance Quality (AQ) — demo formulas
    dci = round(max(0.0, min(100.0, (abs(score) / 3.0) * 100.0)), 2)
    assurance_quality = round(max(0.0, min(100.0, 100.0 - (risk * 0.4))), 2)

    # Determine status
    if pred_raw == 1:
        status = "SAFE"
        level = "low"
    else:
        if risk > 75:
            status = "INTRUSION DETECTED"
            level = "high"
        elif risk > 50:
            status = "SUSPICIOUS"
            level = "medium"
        else:
            status = "SUSPICIOUS"
            level = "low"

    # event
    event = {
        "timestamp": payload.timestamp or datetime.utcnow().isoformat(),
        "duration": payload.duration,
        "src_bytes": payload.src_bytes,
        "dst_bytes": payload.dst_bytes,
        "failed_logins": payload.failed_logins,
        "port": payload.port,
        "protocol": payload.protocol,
        "site_id": payload.site_id,
        "site_name": payload.site_name,
        "domain": payload.domain,
        "homepage": payload.homepage,
        "status": status,
        "level": level,
        "risk": risk,
        "dci": dci,
        "assurance_quality": assurance_quality,
        "score": score,
        "meta": payload.extra_meta or {}
    }

    append_history(event)

    return {
        "status": status,
        "level": level,
        "risk": risk,
        "dci": dci,
        "assurance_quality": assurance_quality,
        "score": score,
        "event": event
    }

@app.get("/stats")
def stats(limit: int = 100):
    history = read_json(HISTORY_FILE)
    return {"history": history[-limit:], "total": len(history)}

# Sites & Ports endpoints
@app.get("/sites")
def get_sites():
    return read_json(SITES_FILE)

@app.post("/sites")
def add_site(site: dict):
    s = read_json(SITES_FILE)
    s.append(site)
    write_json(SITES_FILE, s)
    return {"ok": True, "site": site}

@app.get("/ports")
def get_ports():
    return read_json(PORTS_FILE)

@app.post("/ports")
def add_port(port: dict):
    p = read_json(PORTS_FILE)
    p.append(port)
    write_json(PORTS_FILE, p)
    return {"ok": True, "port": port}

@app.get("/logs")
def get_logs(limit: int = 200):
    return {"history": read_json(HISTORY_FILE)[-limit:]}

@app.get("/report")
def report():
    history = read_json(HISTORY_FILE)
    total = len(history)
    counts = {"SAFE":0, "SUSPICIOUS":0, "INTRUSION DETECTED":0}
    avg_risk = 0.0
    for e in history:
        counts[e["status"]] = counts.get(e["status"], 0) + 1
        avg_risk += e.get("risk", 0)
    avg_risk = round(avg_risk / total, 2) if total else 0.0
    return {"total_events": total, "counts": counts, "avg_risk": avg_risk}

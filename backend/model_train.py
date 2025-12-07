import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib

# Generate dummy but realistic intrusion data
rng = np.random.default_rng(42)

n_normal = 1000
n_attack = 150

normal = {
    "duration": rng.normal(10, 4, n_normal).clip(0),
    "src_bytes": rng.normal(300, 120, n_normal).clip(0),
    "dst_bytes": rng.normal(400, 150, n_normal).clip(0),
    "failed_logins": rng.poisson(0.5, n_normal)
}

attack = {
    "duration": rng.normal(60, 40, n_attack).clip(0),
    "src_bytes": rng.normal(2000, 1500, n_attack).clip(0),
    "dst_bytes": rng.normal(50, 80, n_attack).clip(0),
    "failed_logins": rng.poisson(4, n_attack)
}

df = pd.concat([
    pd.DataFrame(normal),
    pd.DataFrame(attack)
]).sample(frac=1, random_state=42)

model = IsolationForest(
    contamination=n_attack/(n_normal+n_attack),
    random_state=42
)

model.fit(df)
joblib.dump(model, "sentinel_model.pkl")

print("Model trained successfully!")

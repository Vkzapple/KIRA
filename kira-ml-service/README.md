# KIRA ML Service (Flask)

1. Taruh `kira_ml_model.joblib` di folder ini.
2. `pip install -r requirements.txt`
3. Salin `.env.example` ke `.env`, isi `ROBOFLOW_API_KEY`.
4. Lokal: `python main.py` (port 8000). Produksi/Railway: `gunicorn main:app` (lihat `Procfile`, memakai `$PORT`).

Endpoint:
- `GET /health` -> status + model Roboflow yang dipakai
- `POST /analyze` (multipart `file`) -> `{width, height, results:[{box, class, confidence, detected, recommendation}]}`

Roboflow dipanggil dengan body **base64** (bukan JPEG mentah).

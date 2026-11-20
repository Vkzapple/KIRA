# KIRA ML Service (FastAPI)

1. Taruh `kira_ml_model.joblib` di folder ini.
2. Install deps: `pip install -r requirements.txt`
3. Jalankan: `uvicorn main:app --host 0.0.0.0 --port 8000`
4. Endpoint: POST /predict (multipart file) -> {class, confidence}
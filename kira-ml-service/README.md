# KIRA ML Service (Flask)

Service klasifikasi penyakit daun **cabai** (5 kelas: healthy, leaf curl, leaf spot,
whitefly, yellowish). Dataset tomat tidak dipakai.

## Menjalankan

1. Taruh `kira_ml_model.joblib` di folder ini (sudah disertakan).
2. `pip install -r requirements.txt`
3. Salin `.env.example` ke `.env`, isi `ROBOFLOW_API_KEY` (untuk deteksi box di `/analyze`).
4. Lokal: `python main.py` (port 8000). Produksi/Railway: `gunicorn main:app`
   (lihat `Procfile`, memakai `$PORT`).

## Endpoint

- `GET /health`
  -> status, model Roboflow, daftar kelas ML, device.
- `POST /predict` (multipart)
  - `file` gambar, atau `image` (base64), atau `image_url`
  - `boxes` (JSON array `[[x1,y1,x2,y2], ...]`, opsional)
  - `labels` (JSON array label deteksi Roboflow, opsional)
  -> `{width, height, results:[{box, class, confidence, detected, recommendation}]}`
  - Tanpa `boxes`: seluruh gambar diklasifikasi.
- `POST /analyze` (multipart `file`)
  -> Roboflow deteksi box, lalu ML klasifikasi tiap crop.
  Dipakai backend robot setelah snapshot masuk.

Roboflow dipanggil dengan body **base64** (bukan JPEG mentah).
Di `/predict`, Roboflow **tidak** dipanggil sama sekali; prediksi murni dari model ML.

## Training ulang

Dataset: `dhenyd/chili-plant-disease` (folder `train/val/test` + 5 kelas).

```bash
python train_chili.py --data-dir data/chili --out kira_ml_model.joblib --aug-per-image 4
```

Atau latih di **Kaggle (GPU)** memakai notebook `train_chili.ipynb` di folder ini.
Notebook hanya memakai dataset cabai dan menyimpan bundle
`{model, xgb, le, classes}`.

Langkah Kaggle:

1. **Create → Notebook**, lalu **File → Import Notebook** → upload
   `kira-ml-service/train_chili.ipynb`.
2. Panel kanan **Add Input** → cari **`chili-plant-disease`** (oleh `dhenyd`) → Add.
3. **Session options → Accelerator → GPU T4 x2**, lalu **Run All**.
4. Download `kira_ml_model.joblib` dari tab **Output**, timpa file di folder ini,
   lalu redeploy service ML.

Notebook juga bisa dites lokal (tanpa Kaggle):

```powershell
$env:KIRA_DATA_DIR="C:\path\ke\dataset-cabai"   # folder berisi train/val/test
$env:KIRA_AUG_PER_IMAGE="4"
python -m nbconvert --to notebook --execute kira-ml-service/train_chili.ipynb --output train_out.ipynb
```

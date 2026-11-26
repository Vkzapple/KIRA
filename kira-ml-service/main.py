from flask import Flask, request, jsonify
import joblib, torch, timm, os, requests, io, re, base64, json
import numpy as np
from PIL import Image
from torchvision import transforms

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = 'mobilenetv3_large_100'


def load_env(path):
    """Baca .env format KEY=VALUE. Format PowerShell lama ($env:KEY="v") tetap diterima."""
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = re.sub(r'^\$env:', '', k.strip())
            v = v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


load_env(os.path.join(BASE_DIR, '.env'))

app = Flask(__name__)
bundle = joblib.load(os.path.join(BASE_DIR, 'kira_ml_model.joblib'))
# 'model' = model terbaik hasil training (bisa XGBoost/LogisticRegression).
# 'xgb' dipertahankan supaya bundle lama tetap bisa dipakai.
model = bundle.get('model') or bundle.get('xgb')
if model is None:
    raise RuntimeError("kira_ml_model.joblib tidak berisi 'model' atau 'xgb'")
le = bundle['le']

RF_KEY = os.environ.get('ROBOFLOW_API_KEY', '')
RF_MODEL = os.environ.get('ROBOFLOW_MODEL', 'plant-disease-detection-rhvjq').strip('/')
RF_VER = os.environ.get('ROBOFLOW_VERSION', '1')
RF_CONF = int(os.environ.get('ROBOFLOW_CONFIDENCE', '40'))

device = 'cuda' if torch.cuda.is_available() else 'cpu'
extractor = timm.create_model(MODEL_NAME, pretrained=True, num_classes=0).to(device).eval()
tf = transforms.Compose([
    transforms.Resize((192, 192)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])


def embed(img):
    t = tf(img).unsqueeze(0).to(device)
    with torch.no_grad():
        return extractor(t).cpu().numpy().flatten()


def clean_label(raw):
    s = str(raw)
    s = re.sub(r'^(tomato|chili|cabai|tomat)_', '', s, flags=re.I)
    s = s.replace('Tomato___', '').replace('___', ' ')
    s = s.replace('_', ' ').strip()
    if not s:
        return 'Objek'
    if 'healthy' in s.lower() or 'sehat' in s.lower():
        return 'Sehat'
    return s.title()


def recommend(cls):
    c = cls.lower()
    if 'healthy' in c or 'sehat' in c:
        return 'Tanaman sehat. Lanjutkan perawatan rutin dan monitoring.'
    if 'whitefly' in c or 'kutu' in c:
        return 'Ada whitefly/kutu kebul. Pasang yellow sticky trap, gunakan insektisida, dan isolasi tanaman.'
    if 'yellow' in c or 'kuning' in c:
        return 'Daun menguning. Cek nutrisi (N/Mg), pH tanah, dan pastikan drainase serta penyiraman cukup.'
    if 'blight' in c:
        return 'Pangkas daun sakit, aplikasikan fungisida, kurangi kelembapan.'
    if 'spot' in c or 'bercak' in c or 'bacterial' in c:
        return 'Buang daun terinfeksi, gunakan bakterisida/fungisida, sterilkan alat, dan hindari percikan air.'
    if 'curl' in c or 'keriting' in c:
        return 'Daun keriting. Kendalikan vektor (kutu/trips), gunakan insektisida, dan isolasi tanaman.'
    return 'Lakukan inspeksi lanjut dan treatment sesuai gejala.'


def classify(img):
    feat = embed(img).reshape(1, -1)
    if hasattr(model, 'predict_proba'):
        proba = np.asarray(model.predict_proba(feat))[0]
        pred = int(np.argmax(proba))
        conf = float(proba[pred])
    else:
        pred = int(model.predict(feat)[0])
        conf = 1.0
    raw = le.inverse_transform([pred])[0]
    cls = clean_label(raw)
    return cls, conf, recommend(cls)


def normalize_box(box, w, h):
    try:
        x1, y1, x2, y2 = [float(v) for v in box[:4]]
    except (TypeError, ValueError, IndexError):
        return None

    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1

    # Roboflow Workflows kadang mengembalikan koordinat 0..1.
    if max(abs(x1), abs(y1), abs(x2), abs(y2)) <= 1.5:
        x1 *= w
        x2 *= w
        y1 *= h
        y2 *= h

    x1 = max(0, min(w - 1, int(round(x1))))
    y1 = max(0, min(h - 1, int(round(y1))))
    x2 = max(0, min(w, int(round(x2))))
    y2 = max(0, min(h, int(round(y2))))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return [x1, y1, x2, y2]


def classify_boxes(img, boxes=None, labels=None):
    w, h = img.size
    boxes = boxes or []
    labels = labels or []
    results = []

    for i, box in enumerate(boxes):
        normalized = normalize_box(box, w, h)
        if normalized is None:
            continue
        left, top, right, bottom = normalized
        crop = img.crop((left, top, right, bottom))
        cls, conf, rec = classify(crop)
        results.append({
            'box': normalized,
            'class': cls,
            'confidence': conf,
            'detected': labels[i] if i < len(labels) else 'box',
            'recommendation': rec,
        })

    if not results:
        cls, conf, rec = classify(img)
        results.append({
            'box': [0, 0, w, h],
            'class': cls,
            'confidence': conf,
            'detected': 'image',
            'recommendation': rec,
        })

    return w, h, results


def get_field(name):
    if name in request.form:
        return request.form.get(name)
    if request.is_json:
        data = request.get_json(silent=True) or {}
        return data.get(name)
    return None


def parse_json_list(raw):
    if raw is None or raw == '':
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    return raw


def read_image():
    f = request.files.get('file')
    if f is not None:
        try:
            return Image.open(io.BytesIO(f.read())).convert('RGB')
        except Exception:
            raise ValueError('file bukan gambar valid')

    payload = get_field('image')
    if isinstance(payload, str) and payload.strip():
        raw = re.sub(r'^data:[^;]+;base64,', '', payload.strip())
        try:
            return Image.open(io.BytesIO(base64.b64decode(raw))).convert('RGB')
        except Exception:
            raise ValueError('image base64 tidak valid')

    url = get_field('image_url') or get_field('imageUrl')
    if isinstance(url, str) and url.strip():
        try:
            resp = requests.get(url.strip(), timeout=30)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert('RGB')
        except Exception as exc:
            raise ValueError(f'gagal mengambil image_url: {exc}')

    raise ValueError('kirim multipart "file", atau field "image" (base64) / "image_url"')


def roboflow_url():
    # ROBOFLOW_MODEL boleh "project" (+ ROBOFLOW_VERSION) atau sudah "project/versi".
    model_path = RF_MODEL if '/' in RF_MODEL else f"{RF_MODEL}/{RF_VER}"
    return f"https://detect.roboflow.com/{model_path}"


def roboflow_detect(img):
    """Roboflow HANYA untuk deteksi objek. Hasil box dipakai ML untuk klasifikasi."""
    if not RF_KEY:
        return [], []
    try:
        buf = io.BytesIO()
        img.save(buf, format='JPEG')
        # Hosted API Roboflow menerima body base64 (bukan JPEG mentah).
        payload = base64.b64encode(buf.getvalue()).decode('ascii')
        r = requests.post(
            roboflow_url(),
            params={'api_key': RF_KEY, 'confidence': RF_CONF, 'overlap': 30},
            data=payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=30,
        )
        if r.status_code != 200:
            print(f"[roboflow] HTTP {r.status_code}: {r.text[:200]}", flush=True)
            return [], []
        boxes, labels = [], []
        for p in r.json().get('predictions', []):
            try:
                x = float(p['x']); y = float(p['y'])
                pw = float(p['width']); ph = float(p['height'])
            except (KeyError, TypeError, ValueError):
                continue
            boxes.append([x - pw / 2, y - ph / 2, x + pw / 2, y + ph / 2])
            labels.append(str(p.get('class', 'objek')))
        return boxes, labels
    except requests.RequestException as exc:
        print(f"[roboflow] gagal: {exc}", flush=True)
        return [], []


@app.route('/health')
def health():
    return jsonify({
        'ok': True,
        'roboflow': bool(RF_KEY),
        'roboflow_model': RF_MODEL,
        'classes': list(le.classes_),
        'extractor': MODEL_NAME,
        'device': device,
    })


@app.route('/predict', methods=['POST'])
def predict():
    """Klasifikasi ML saja. Input: gambar + boxes (opsional).

    Dipakai frontend setelah Roboflow mendeteksi objek. Kalau boxes kosong,
    seluruh gambar diklasifikasi.
    """
    try:
        img = read_image()
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    boxes = parse_json_list(get_field('boxes'))
    labels = [str(x) for x in parse_json_list(get_field('labels'))]
    w, h, results = classify_boxes(img, boxes, labels)
    return jsonify({'width': w, 'height': h, 'results': results})


@app.route('/analyze', methods=['POST'])
def analyze():
    """Alur lengkap untuk backend/robot: Roboflow deteksi -> ML klasifikasi."""
    try:
        img = read_image()
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    boxes, labels = roboflow_detect(img)
    w, h, results = classify_boxes(img, boxes, labels)
    return jsonify({'width': w, 'height': h, 'results': results})


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', os.environ.get('AI_SERVICE_PORT', 8000))),
    )

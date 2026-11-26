from flask import Flask, request, jsonify
import joblib, torch, timm, os, requests, io, re, base64
from PIL import Image
import numpy as np
from torchvision import transforms

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


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
model = bundle['xgb']
le = bundle['le']

RF_KEY = os.environ.get('ROBOFLOW_API_KEY','')
RF_MODEL = os.environ.get('ROBOFLOW_MODEL','plant-disease-detection-rhvjq').strip('/')
RF_VER = os.environ.get('ROBOFLOW_VERSION','1')

device = 'cuda' if torch.cuda.is_available() else 'cpu'
extractor = timm.create_model('mobilenetv3_large_100', pretrained=True, num_classes=0).to(device).eval()
tf = transforms.Compose([
    transforms.Resize((192,192)),
    transforms.ToTensor(),
    transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])
])

def embed(img):
    t = tf(img).unsqueeze(0).to(device)
    with torch.no_grad():
        return extractor(t).cpu().numpy().flatten()

def clean_label(raw):
    # tomato_Tomato___Early_blight -> Tomato Early Blight
    s = raw.replace('tomato_','').replace('chili_','')
    s = s.replace('Tomato___','').replace('___',' ')
    s = s.replace('_',' ').strip()
    if 'healthy' in s.lower():
        return 'Healthy'
    return s.title()

def recommend(cls):
    c = cls.lower()
    if 'healthy' in c:
        return 'Tanaman sehat. Lanjutkan perawatan rutin dan monitoring.'
    if 'blight' in c:
        return 'Pangkas daun sakit, aplikasikan fungisida, kurangi kelembapan.'
    if 'spot' in c or 'bacterial' in c:
        return 'Buang daun terinfeksi, gunakan bakterisida, sterilkan alat.'
    if 'curl' in c:
        return 'Kendalikan vektor (kutu), gunakan insektisida, isolasi tanaman.'
    return 'Lakukan inspeksi lanjut dan treatment sesuai gejala.'

def classify(img):
    feat = embed(img).reshape(1,-1)
    pred = model.predict(feat)[0]
    proba = model.predict_proba(feat)[0]
    raw = le.inverse_transform([pred])[0]
    cls = clean_label(raw)
    return cls, float(proba.max()), recommend(cls)

@app.route('/health')
def health():
    return jsonify({'ok': True, 'roboflow': bool(RF_KEY), 'model': RF_MODEL})


def roboflow_url():
    # ROBOFLOW_MODEL boleh "project" (+ ROBOFLOW_VERSION) atau sudah "project/versi".
    model_path = RF_MODEL if '/' in RF_MODEL else f"{RF_MODEL}/{RF_VER}"
    return f"https://detect.roboflow.com/{model_path}"


@app.route('/analyze', methods=['POST'])
def analyze():
    f = request.files.get('file')
    if f is None:
        return jsonify({'error': 'field multipart "file" wajib ada'}), 400
    try:
        img = Image.open(io.BytesIO(f.read())).convert('RGB')
    except Exception:
        return jsonify({'error': 'file bukan gambar valid'}), 400

    w, h = img.size
    results = []
    if RF_KEY:
        try:
            buf = io.BytesIO()
            img.save(buf, format='JPEG')
            # Roboflow hosted API menerima body base64 (bukan JPEG mentah).
            payload = base64.b64encode(buf.getvalue()).decode('ascii')
            r = requests.post(
                roboflow_url(),
                params={'api_key': RF_KEY, 'confidence': 40, 'overlap': 30},
                data=payload,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=30,
            )
            if r.status_code == 200:
                for p in r.json().get('predictions', []):
                    x, y, pw, ph = p['x'], p['y'], p['width'], p['height']
                    left = max(0, int(x - pw / 2)); top = max(0, int(y - ph / 2))
                    right = min(w, int(x + pw / 2)); bottom = min(h, int(y + ph / 2))
                    if right <= left or bottom <= top:
                        continue
                    crop = img.crop((left, top, right, bottom))
                    cls, conf, rec = classify(crop)
                    results.append({'box': [left, top, right, bottom], 'class': cls,
                                    'confidence': conf, 'detected': p.get('class'),
                                    'recommendation': rec})
            else:
                print(f"[roboflow] HTTP {r.status_code}: {r.text[:200]}", flush=True)
        except requests.RequestException as e:
            print(f"[roboflow] gagal: {e}", flush=True)

    if not results:
        cls, conf, rec = classify(img)
        results.append({'box': [0, 0, w, h], 'class': cls, 'confidence': conf,
                        'detected': 'image', 'recommendation': rec})
    return jsonify({'width': w, 'height': h, 'results': results})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', os.environ.get('AI_SERVICE_PORT', 8000))))
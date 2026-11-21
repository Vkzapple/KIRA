from flask import Flask, request, jsonify
import joblib, torch, timm, os, requests, io, re
from PIL import Image
import numpy as np
from torchvision import transforms

env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line=line.strip()
            if line and not line.startswith('#') and '=' in line:
                k,v = line.split('=',1)
                os.environ.setdefault(k.strip(), v.strip())

app = Flask(__name__)
bundle = joblib.load('kira_ml_model.joblib')
model = bundle['xgb']
le = bundle['le']

RF_KEY = os.environ.get('ROBOFLOW_API_KEY','')
RF_MODEL = os.environ.get('ROBOFLOW_MODEL','plant-disease-detection-rhvjq')
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

@app.route('/analyze', methods=['POST'])
def analyze():
    f = request.files['file']
    img = Image.open(io.BytesIO(f.read())).convert('RGB')
    w,h = img.size
    results = []
    if RF_KEY:
        url = f"https://detect.roboflow.com/{RF_MODEL}/{RF_VER}?api_key={RF_KEY}&confidence=40"
        buf = io.BytesIO()
        img.save(buf, format='JPEG')
        buf.seek(0)
        r = requests.post(url, files={'file': ('img.jpg', buf, 'image/jpeg')}, timeout=30)
        if r.status_code == 200:
            for p in r.json().get('predictions', []):
                x,y,pw,ph = p['x'], p['y'], p['width'], p['height']
                left = max(0, int(x - pw/2)); top = max(0, int(y - ph/2))
                right = min(w, int(x + pw/2)); bottom = min(h, int(y + ph/2))
                crop = img.crop((left,top,right,bottom))
                cls, conf, rec = classify(crop)
                results.append({'box':[left,top,right,bottom], 'class': cls, 'confidence': conf, 'detected': p.get('class'), 'recommendation': rec})
    if not results:
        cls, conf, rec = classify(img)
        results.append({'box':[0,0,w,h], 'class': cls, 'confidence': conf, 'detected': 'image', 'recommendation': rec})
    return jsonify({'width':w,'height':h,'results':results})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
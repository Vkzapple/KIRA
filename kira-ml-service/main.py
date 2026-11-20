from fastapi import FastAPI, UploadFile, File
import joblib, torch, timm
from PIL import Image
import io, numpy as np
from torchvision import transforms

app = FastAPI()
bundle = joblib.load('kira_ml_model.joblib')
model = bundle['xgb']
le = bundle['le']

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

@app.post('/predict')
async def predict(file: UploadFile = File(...)):
    img = Image.open(io.BytesIO(await file.read())).convert('RGB')
    feat = embed(img).reshape(1,-1)
    pred = model.predict(feat)[0]
    proba = model.predict_proba(feat)[0]
    cls = le.inverse_transform([pred])[0]
    conf = float(proba.max())
    return {'class': cls, 'confidence': conf}
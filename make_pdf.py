import fitz
doc = fitz.open()
page = doc.new_page()
text = """KIRA - Goals & Schema (Lomba Robotics Nasional)

1. Tujuan (Goals)
- Deteksi tanaman sakit + tingkat kesehatan + rekomendasi treatment.
- Sortir sampah (plastik, organik, kertas, logam, dll).
- Monitoring jarak hambatan (HC-SR04) + soil moisture.
- Tanpa stream: snapshot + alert + decision di web.

2. Arsitektur
ESP32-CAM capture -> Backend Go -> ML Service (Python) -> Web
ESP32 Dev: servo + motor L298N + soil + HC-SR04 -> telemetry.

3. Dataset Kaggle (Training)
Plant Disease:
- PlantVillage (54k, 38 class)
- New Plant Diseases Dataset (87k)
- CropCheckUp (54k segmented)
- Tomato Leaf Disease Image Classification (41.8k)
- MegaPlant (60k)

Waste:
- Waste Classification data (22.5k)
- Garbage Dataset v2 (13.3k, 10 class)
- Dataset Trash Type Full Combination (balanced 8 class)
- Recyclable and Household Waste (15k)
- Custom Waste classification (11.5k)

4. Model
- Detection: YOLOv8 (Roboflow/hosted)
- Decision: MobileNetV3/EfficientNet (klasifikasi + health regression)
- Recommendation: MLP/rule-based
- Deploy: FastAPI + ONNX di backend.

5. Celah & Mitigasi (Juri)
- Tanpa stream -> snapshot + alert + HC-SR04 real-time lokal.
- Latency server -> control lokal tetap di ESP32.
- Dataset -> augmentasi + cross-val.
- Evaluasi -> mAP, acc, health MAE.

6. Metrik Target
- mAP@0.5 >= 0.8
- Acc >= 0.85
- Health MAE < 10
- End-to-end < 5s
"""
page.insert_text((50, 50), text, fontsize=10)
doc.save("C:/Users/evell/KIRA/goals_schema.pdf")
doc.close()
print("saved")
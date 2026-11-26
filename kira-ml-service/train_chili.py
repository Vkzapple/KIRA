"""Train model klasifikasi penyakit daun cabai (khusus cabai, tanpa tomat).

Dataset yang dipakai: dhenyd/chili-plant-disease (5 kelas: healthy, leaf curl,
leaf spot, whitefly, yellowish).

Contoh lokal:
    python train_chili.py --data-dir data/chili --out kira_ml_model.joblib

Di Kaggle, arahkan --data-dir ke folder dataset. Script ini juga dipakai sebagai
acuan notebook `kaggle_kernel/kira_ml.ipynb`.
"""

from __future__ import annotations

import argparse
import glob
import os
import random

import joblib
import numpy as np
import timm
import torch
import xgboost as xgb
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler
from torchvision import transforms

SEED = 42
IMG_SIZE = 192
MODEL_NAME = "mobilenetv3_large_100"

NORMALIZE_MEAN = [0.485, 0.456, 0.406]
NORMALIZE_STD = [0.229, 0.224, 0.225]

BASE_TF = transforms.Compose(
    [
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
    ]
)

AUG_TF = transforms.Compose(
    [
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(p=0.15),
        transforms.RandomRotation(15),
        transforms.ColorJitter(0.2, 0.2, 0.2, 0.05),
        transforms.ToTensor(),
        transforms.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
    ]
)

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def find_split_dir(data_dir: str, split: str) -> str | None:
    aliases = {
        "train": ["train"],
        "val": ["val", "valid", "validation"],
        "test": ["test"],
    }
    for name in aliases[split]:
        path = os.path.join(data_dir, name)
        if os.path.isdir(path):
            return path
    return None


def collect_split(data_dir: str, split: str) -> tuple[list[str], list[str]]:
    root = find_split_dir(data_dir, split)
    if root is None:
        return [], []

    paths: list[str] = []
    labels: list[str] = []

    for class_name in sorted(os.listdir(root)):
        class_dir = os.path.join(root, class_name)
        if not os.path.isdir(class_dir):
            continue
        # Lewati folder split yang tidak sengaja terbaca sebagai kelas.
        if class_name.lower() in {"train", "val", "valid", "validation", "test"}:
            continue

        images: list[str] = []
        for ext in IMAGE_EXTS:
            images.extend(glob.glob(os.path.join(class_dir, "**", f"*{ext}"), recursive=True))
            images.extend(glob.glob(os.path.join(class_dir, "**", f"*{ext.upper()}"), recursive=True))

        images = sorted(set(images))
        label = f"chili_{class_name.strip().replace(' ', '_').lower()}"
        for path in images:
            paths.append(path)
            labels.append(label)

    return paths, labels


def build_extractor(device: str):
    extractor = timm.create_model(MODEL_NAME, pretrained=True, num_classes=0)
    return extractor.to(device).eval()


def embed_paths(extractor, paths: list[str], tf, device: str, batch_size: int = 32) -> np.ndarray:
    features: list[np.ndarray] = []
    batch: list[torch.Tensor] = []

    def flush() -> None:
        if not batch:
            return
        tensor = torch.stack(batch).to(device)
        with torch.no_grad():
            features.append(extractor(tensor).cpu().numpy())
        batch.clear()

    for path in paths:
        try:
            image = Image.open(path).convert("RGB")
        except Exception as exc:  # file rusak / tidak terbaca
            print(f"[skip] {path}: {exc}")
            continue
        batch.append(tf(image))
        if len(batch) >= batch_size:
            flush()
    flush()

    if not features:
        return np.empty((0, 0), dtype=np.float32)
    return np.concatenate(features, axis=0)


def train_xgb(x_train, y_train, x_val, y_val):
    common = dict(
        n_estimators=700,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.8,
        objective="multi:softprob",
        eval_metric="mlogloss",
        tree_method="hist",
        n_jobs=-1,
        random_state=SEED,
    )
    try:
        model = xgb.XGBClassifier(**common, early_stopping_rounds=60)
        model.fit(x_train, y_train, eval_set=[(x_val, y_val)], verbose=False)
    except TypeError:
        model = xgb.XGBClassifier(**common)
        model.fit(x_train, y_train, verbose=False)
    return model


def train_logreg(x_train, y_train):
    model = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=3000, C=1.0, n_jobs=-1, random_state=SEED),
    )
    model.fit(x_train, y_train)
    return model


def evaluate(name: str, model, x, y, target_names: list[str]) -> float:
    pred = model.predict(x)
    acc = accuracy_score(y, pred)
    print(f"\n=== {name} ===")
    print(f"accuracy: {acc:.4f}")
    print(classification_report(y, pred, target_names=target_names, digits=3, zero_division=0))
    print("confusion matrix:")
    print(confusion_matrix(y, pred))
    return float(acc)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data-dir",
        default="data/chili",
        help="Folder dataset yang berisi train/val/test dan subfolder kelas.",
    )
    parser.add_argument("--out", default="kira_ml_model.joblib")
    parser.add_argument(
        "--aug-per-image",
        type=int,
        default=4,
        help="Jumlah variasi augmentasi per gambar train (0 = tanpa augmentasi).",
    )
    args = parser.parse_args()

    set_seed()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}")

    train_paths, train_labels = collect_split(args.data_dir, "train")
    val_paths, val_labels = collect_split(args.data_dir, "val")
    test_paths, test_labels = collect_split(args.data_dir, "test")

    if not train_paths:
        raise SystemExit(f"Tidak ada gambar train di {args.data_dir}")

    print(f"train: {len(train_paths)} gambar")
    print(f"val  : {len(val_paths)} gambar")
    print(f"test : {len(test_paths)} gambar")

    le = LabelEncoder()
    y_train = le.fit_transform(train_labels)
    y_val = le.transform(val_labels) if val_labels else np.array([], dtype=int)
    y_test = le.transform(test_labels) if test_labels else np.array([], dtype=int)

    print("kelas:", list(le.classes_))

    extractor = build_extractor(device)

    print("\nEkstraksi embedding train (gambar asli)...")
    x_train = embed_paths(extractor, train_paths, BASE_TF, device)

    if args.aug_per_image > 0:
        print(f"Ekstraksi embedding train ({args.aug_per_image}x augmentasi)...")
        aug_paths = train_paths * args.aug_per_image
        x_aug = embed_paths(extractor, aug_paths, AUG_TF, device)
        # y untuk augmentasi mengikuti urutan train_paths yang diulang.
        y_aug = np.tile(y_train, args.aug_per_image)
        x_train = np.concatenate([x_train, x_aug], axis=0)
        y_train_fit = np.concatenate([y_train, y_aug], axis=0)
    else:
        y_train_fit = y_train

    print("Ekstraksi embedding val...")
    x_val = embed_paths(extractor, val_paths, BASE_TF, device) if val_paths else np.empty((0, x_train.shape[1]))
    print("Ekstraksi embedding test...")
    x_test = embed_paths(extractor, test_paths, BASE_TF, device) if test_paths else np.empty((0, x_train.shape[1]))

    print(f"\nshape train: {x_train.shape}, val: {x_val.shape}, test: {x_test.shape}")

    candidates = {}
    if len(x_val):
        print("\nTraining XGBoost...")
        candidates["xgboost"] = train_xgb(x_train, y_train_fit, x_val, y_val)
        print("Training LogisticRegression...")
        candidates["logreg"] = train_logreg(x_train, y_train_fit)

        scores = {
            name: evaluate(name, model, x_val, y_val, list(le.classes_))
            for name, model in candidates.items()
        }
        best_name = max(scores, key=scores.get)
    else:
        print("\nVal tidak tersedia, fallback ke XGBoost dan evaluasi test.")
        candidates["xgboost"] = train_xgb(x_train, y_train_fit, x_train[:1], y_train_fit[:1])
        candidates["logreg"] = train_logreg(x_train, y_train_fit)
        best_name = "xgboost"

    best_model = candidates[best_name]
    print(f"\nModel terpilih: {best_name}")

    if len(x_test):
        evaluate(f"{best_name} (test)", best_model, x_test, y_test, list(le.classes_))

    bundle = {
        "model": best_model,
        "xgb": candidates.get("xgboost"),
        "le": le,
        "classes": list(le.classes_),
    }
    joblib.dump(bundle, args.out, compress=3)
    print(f"\nDisimpan: {args.out}")


if __name__ == "__main__":
    main()

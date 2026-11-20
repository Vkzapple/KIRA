import nbformat as nbf
nb = nbf.v4.new_notebook()
cells = []

cells.append(nbf.v4.new_markdown_cell("# KIRA - Training Notebook (Plant Disease + Waste)"))

cells.append(nbf.v4.new_code_cell("""!pip -q install torch torchvision timm scikit-learn matplotlib pillow"""))

cells.append(nbf.v4.new_code_cell("""import os, glob, random
import torch, torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms
import timm
print('torch', torch.__version__)"""))

cells.append(nbf.v4.new_markdown_cell("## 1. Dataset path (ganti sesuai Kaggle input)"))
cells.append(nbf.v4.new_code_cell("""DATA_DIR = '/kaggle/input/plantvillage-dataset'  # ganti
train_tf = transforms.Compose([transforms.Resize((224,224)), transforms.RandomHorizontalFlip(), transforms.ToTensor()])
val_tf = transforms.Compose([transforms.Resize((224,224)), transforms.ToTensor()])
train_ds = datasets.ImageFolder(os.path.join(DATA_DIR,'train'), transform=train_tf)
val_ds = datasets.ImageFolder(os.path.join(DATA_DIR,'val'), transform=val_tf)
train_loader = DataLoader(train_ds, batch_size=32, shuffle=True)
val_loader = DataLoader(val_ds, batch_size=32)
print('classes', len(train_ds.classes))"""))

cells.append(nbf.v4.new_markdown_cell("## 2. Model (MobileNetV3)"))
cells.append(nbf.v4.new_code_cell("""model = timm.create_model('mobilenetv3_large_100', pretrained=True, num_classes=len(train_ds.classes))
device = 'cuda' if torch.cuda.is_available() else 'cpu'
model = model.to(device)
opt = torch.optim.Adam(model.parameters(), lr=1e-3)
crit = nn.CrossEntropyLoss()"""))

cells.append(nbf.v4.new_code_cell("""for epoch in range(3):
    model.train()
    for x,y in train_loader:
        x,y = x.to(device), y.to(device)
        opt.zero_grad()
        out = model(x)
        loss = crit(out,y)
        loss.backward()
        opt.step()
    print('epoch', epoch, 'done')"""))

cells.append(nbf.v4.new_markdown_cell("## 3. Simpan model"))
cells.append(nbf.v4.new_code_cell("""torch.save(model.state_dict(), '/kaggle/working/model.pth')
print('saved')"""))

nb.cells = cells
with open('C:/Users/evell/KIRA/kira_train.ipynb','w') as f:
    nbf.write(nb, f)
print('notebook saved')
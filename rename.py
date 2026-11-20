import os
root='C:/Users/evell/KIRA'
for dirpath,_,files in os.walk(root):
    if '.git' in dirpath: continue
    for f in files:
        p=os.path.join(dirpath,f)
        try:
            with open(p,'r',encoding='utf-8') as fh:
                s=fh.read()
        except Exception:
            continue
        low=s.lower()
        if 'kira' in low:
            ns=s.replace('kira','kira').replace('KIRA','KIRA')
            if ns!=s:
                with open(p,'w',encoding='utf-8') as fh:
                    fh.write(ns)
print('text replaced')
for old,new in [('kira-server','kira-server'),('kira-web','kira-web')]:
    op=os.path.join(root,old); np=os.path.join(root,new)
    if os.path.exists(op) and not os.path.exists(np):
        os.rename(op,np)
        print('renamed',old,'->',new)
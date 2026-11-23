"""Reproducible COCO128 fine-tuning experiment; never auto-promote weights.

COCO128 comes from COCO train2017 and may have been seen during pretraining.
Its split is a regression check, not an independent benchmark. Restaurant video
frames must not be silently added to training or described as unseen if used.
"""
import argparse, hashlib, json, os, random, shutil, urllib.request, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'ml/work/scene-upgrade'
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'ml/work/ultralytics')
os.environ['YOLO_AUTOINSTALL']='false'

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--epochs',type=int,default=8);parser.add_argument('--device',default='0');args=parser.parse_args()
 import torch,yaml
 from ultralytics import YOLO
 torch.set_num_threads(4)
 OUT.mkdir(parents=True,exist_ok=True)
 archive=OUT/'coco128.zip';url='https://github.com/ultralytics/assets/releases/download/v0.0.0/coco128.zip'
 if not archive.exists():urllib.request.urlretrieve(url,archive)
 with zipfile.ZipFile(archive) as z:
  for member in z.infolist():
   target=(OUT/member.filename).resolve()
   if not target.is_relative_to(OUT.resolve()):raise ValueError('Unsafe archive path')
   z.extract(member,OUT)
 images=sorted((OUT/'coco128/images/train2017').glob('*.jpg'));random.Random(20261124).shuffle(images)
 model=YOLO(str(ROOT/'ml/work/yolo11s.pt'))
 for split,files in [('train',images[:80]),('val',images[80:104]),('test',images[104:])]:
  (OUT/f'{split}.txt').write_text('\n'.join(str(p.resolve()) for p in files)+'\n')
 config={'path':str(OUT),'train':str(OUT/'train.txt'),'val':str(OUT/'val.txt'),'test':str(OUT/'test.txt'),'names':model.names}
 (OUT/'data.yaml').write_text(yaml.safe_dump(config))
 manifest={'source':url,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'seed':20261124,'counts':{'train':80,'val':24,'test':len(images)-104},'epochs':args.epochs,'caveat':'COCO128 is part of COCO train2017; pretrained weights may already have seen these images. Restaurant frames are not used for fitting.'}
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
 model.train(data=str(OUT/'data.yaml'),epochs=args.epochs,imgsz=640,batch=4,workers=0,device=args.device,freeze=10,optimizer='AdamW',lr0=.0002,lrf=.1,warmup_epochs=1,amp=True,seed=20261124,deterministic=True,mosaic=.3,close_mosaic=2,plots=False,project=str(OUT),name='fit',exist_ok=True)
 print('CANDIDATE',OUT/'fit/weights/best.pt',flush=True)

if __name__=='__main__':main()

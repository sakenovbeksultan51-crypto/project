"""Prepare raw full-frame/tile predictions on all held-out two-person furniture scenes."""
import os
os.environ['YOLO_OFFLINE']='true';os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config'
import json,pathlib,cv2,torch
from ultralytics import YOLO
import ultralytics.utils.torch_utils as tu
tu.NUM_THREADS=1;torch.set_num_threads(1)
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR','/workspace/work/training'));out=root/'precision';model=YOLO(str(root/'yolov8n.pt'));cases=[]
for lp in sorted((out/'labels/val').glob('*.txt')):
 rows=[line.split() for line in lp.read_text().splitlines()];people=[r for r in rows if r[0]=='0'];classes={int(r[0]) for r in rows}
 if not(len(people)==2 and classes&{56,57,60}):continue
 image=cv2.imread(str(out/'images/val'/(lp.stem+'.jpg')));h,w=image.shape[:2];full=[];tiles=[]
 crops=[(0,0,w,h)]+[(int(w*x),int(h*y),int(w*.6),int(h*.6)) for y in [0,.4] for x in [0,.4]]
 for index,(x,y,cw,ch) in enumerate(crops):
  crop=image[y:y+ch,x:x+cw];r=model.predict(crop,imgsz=640,rect=False,conf=.3,iou=.45,device='cpu',verbose=False)[0]
  for box in r.boxes:
   cls=int(box.cls.item())
   if cls not in [0,60]:continue
   x1,y1,x2,y2=box.xyxy[0].tolist();d={'class':'person' if cls==0 else 'dining table','score':float(box.conf.item()),'bbox':[x+x1,y+y1,x2-x1,y2-y1]}
   if index==0:full.append(d)
   else:tiles.append({'detection':d,'crop':[x,y,cw,ch]})
 gt=[]
 for _,cx,cy,bw,bh in people:
  cx,cy,bw,bh=map(float,[cx,cy,bw,bh]);gt.append([(cx-bw/2)*w,(cy-bh/2)*h,bw*w,bh*h])
 cases.append({'file':lp.stem+'.jpg','width':w,'height':h,'full':full,'tiles':tiles,'ground_truth':gt})
(out/'tile-cases.json').write_text(json.dumps(cases));print('Prepared held-out scenes:',len(cases),flush=True)

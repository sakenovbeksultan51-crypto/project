"""Evaluate full-frame and tiled table proposals on 32 untouched COCO images."""
import os
os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config';os.environ['YOLO_OFFLINE']='true'
import pathlib,json,torch,cv2,random
from ultralytics import YOLO
import ultralytics.utils.torch_utils as tu
from torchvision.ops import box_iou, nms
tu.NUM_THREADS=1;torch.set_num_threads(1)
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR','/workspace/work/training'));out=root/'table-experiment';split=os.environ.get('TABLE_SPLIT','test');number=int(os.environ.get('TABLE_COUNT','16'));tag=os.environ.get('TABLE_TAG','baseline');paths=(out/(split+'.txt')).read_text().splitlines();rng=random.Random(89);pos=paths[:64];neg=paths[64:];rng.shuffle(pos);rng.shuffle(neg);paths=pos[:number]+neg[:number]
model=YOLO(os.environ.get('TABLE_WEIGHTS',str(root/'yolov8n.pt')));metrics={k:{'tp':0,'fp':0,'fn':0,'small_tp':0,'small_fn':0} for k in ['full_045','tiles_045','tiles_040']};details=[]
for path in paths:
 img=cv2.imread(path);height,width=img.shape[:2];proposals=[]
 crops=[(0,0,width,height)]+[(int(width*x),int(height*y),int(width*.6),int(height*.6)) for y in [0,.4] for x in [0,.4]]
 for idx,(x,y,cw,ch) in enumerate(crops):
  pred=model.predict(img[y:y+ch,x:x+cw],imgsz=640,rect=False,conf=.3,iou=.45,classes=[60],verbose=False,device='cpu')[0]
  for b in pred.boxes:
   x1,y1,x2,y2=map(float,b.xyxy[0]);score=float(b.conf.item());x1+=x;x2+=x;y1+=y;y2+=y
   if idx and (x>0 and x1<=x+4 or y>0 and y1<=y+4 or x+cw<width-1 and x2>=x+cw-4 or y+ch<height-1 and y2>=y+ch-4):continue
   proposals.append((idx,[x1,y1,x2,y2],score))
 gt=[];small=[]
 for row in (out/'labels'/split/(pathlib.Path(path).stem+'.txt')).read_text().splitlines():
  c,x,y,w,h=map(float,row.split())
  if int(c)==60:gt.append([(x-w/2)*width,(y-h/2)*height,(x+w/2)*width,(y+h/2)*height]);small.append(w*h<.02)
 item={'file':pathlib.Path(path).name,'ground_truth_tables':len(gt)}
 for name in metrics:
  p=[z for z in proposals if (name!='full_045' or z[0]==0) and z[2]>=(.4 if name=='tiles_040' else .45)];boxes=torch.tensor([v[1] for v in p],dtype=torch.float32).reshape(-1,4);scores=torch.tensor([v[2] for v in p]);boxes=boxes[nms(boxes,scores,.45)] if len(boxes) else boxes
  overlap=box_iou(boxes,torch.tensor(gt,dtype=torch.float32).reshape(-1,4));matched=set();tp=fp=0;stp=0
  for i in range(len(boxes)):
   matches=[j for j in range(len(gt)) if j not in matched and overlap[i,j]>=.5]
   if matches:j=max(matches,key=lambda a:overlap[i,a].item());matched.add(j);tp+=1;stp+=int(small[j])
   else:fp+=1
  fn=len(gt)-len(matched);sfn=sum(1 for j in range(len(gt)) if small[j] and j not in matched);s=metrics[name];s['tp']+=tp;s['fp']+=fp;s['fn']+=fn;s['small_tp']+=stp;s['small_fn']+=sfn;item[name]={'tp':tp,'fp':fp,'fn':fn}
 details.append(item)
for s in metrics.values():s['precision']=s['tp']/max(1,s['tp']+s['fp']);s['recall']=s['tp']/max(1,s['tp']+s['fn']);s['small_recall']=s['small_tp']/max(1,s['small_tp']+s['small_fn'])
report={'dataset':f'{len(paths)} images from COCO {split} subset ({number} with tables, {number} without)' ,'note':'Pretrained weights fixed, PyTorch approximates browser crop processing; evaluates one frame, before cross-frame stability and zone expansion. User video not evaluated.','metrics':metrics,'images':details}
(out/f'tile-{split}-{tag}.json').write_text(json.dumps(report,indent=2));print('TILE_REPORT',json.dumps(metrics),flush=True)

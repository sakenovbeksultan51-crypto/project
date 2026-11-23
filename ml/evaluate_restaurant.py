"""Evaluate and export the camera-specific table model; never replace people weights."""
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'ml/work/ultralytics');os.environ['YOLO_AUTOINSTALL']='false'
import json,cv2,torch,hashlib,shutil
from ultralytics import YOLO

def iou(a,b):
 x=max(0,min(a[2],b[2])-max(a[0],b[0]));y=max(0,min(a[3],b[3])-max(a[1],b[1]));inter=x*y
 return inter/max(1,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter)
def evaluate(model,annotations,times,baseline=False,preview=False,threshold=.4):
 tp=fp=fn=0;frames=[]
 for t in times:
  path=ROOT/f'ml/work/restaurant/frame_{t:03}.jpg';pred=model.predict(str(path),imgsz=640,conf=threshold,iou=.4,device='cpu',verbose=False,rect=False,classes=[60])[0]
  boxes=pred.boxes.xyxy.cpu().tolist()[:4];gt=annotations['boxes'][str(t)];used=set();hits=0
  for box in boxes:
   available=[i for i,g in enumerate(gt) if i not in used and iou(box,g)>=.5]
   if available:used.add(max(available,key=lambda i:iou(box,gt[i])));hits+=1
  tp+=hits;fp+=len(boxes)-hits;fn+=len(gt)-hits;frames.append({'second':t,'detected':len(boxes),'matched':hits,'boxes':boxes})
  if preview:
   image=cv2.imread(str(path))
   for i,box in enumerate(boxes):
    x1,y1,x2,y2=map(int,box);cv2.rectangle(image,(x1,y1),(x2,y2),(80,220,100),2);cv2.putText(image,f'Table {i+1}',(x1,y1-8),0,.6,(20,100,20),2)
   cv2.imwrite(str(ROOT/f'ml/work/restaurant/result_{t:03}.jpg'),image)
 return {'tp':tp,'fp':fp,'fn':fn,'precision':tp/max(1,tp+fp),'recall':tp/max(1,tp+fn),'frames':frames}

def main():
 torch.set_num_threads(6);a=json.loads((ROOT/'ml/restaurant-annotations.json').read_text());times=a['test_seconds'];base=YOLO(str(ROOT/'ml/work/yolov8n.pt'));trained=YOLO(str(ROOT/'ml/checkpoints/restaurant-tables.pt'))
 calibration=[{'threshold':threshold,**evaluate(trained,a,a['validation_seconds'],threshold=threshold)} for threshold in [.15,.2,.25,.3,.35,.4]]
 best=max(calibration,key=lambda c:(c['tp']-c['fp'],-c['threshold']));threshold=best['threshold']
 baseline=evaluate(base,a,times,True,threshold=threshold);candidate=evaluate(trained,a,times,preview=True,threshold=threshold)
 report={'task':'Four focus tabletops in the supplied restaurant video','annotations':'ml/restaurant-annotations.json','train_seconds':a['train_seconds'],'validation_seconds':a['validation_seconds'],'test_seconds':times,'threshold':threshold,'threshold_selection_rule':'Maximize TP minus FP on the validation frame; choose the lowest equally scoring threshold for recall under occlusion','threshold_calibration_validation':calibration,'matching_iou':.5,'baseline':baseline,'trained':candidate,'limitation':'Only one camera/video, 8 training frames, 1 selection frame and 3 held-out frames. Test frames are from a separate later time segment of the same recording, not an independent video. No claim of generalization to other halls.','selected':candidate['tp']>baseline['tp'] and candidate['fp']<=baseline['fp']}
 (ROOT/'ml/restaurant-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
 if not report['selected']:raise RuntimeError('Candidate did not pass the comparison; not deployed')
 exported=trained.export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False,nms=False,batch=1)
 dest=ROOT/'public/models/yolo/restaurant-tables.onnx';shutil.copyfile(exported,dest)
 report['epochs_completed']=sum(1 for _ in (ROOT/'ml/work/restaurant/fit-preserved/results.csv').open())-1
 report['architecture']='YOLOv8n, original 80-class head preserved, layers 0-21 and their BatchNorm statistics frozen'
 report['onnx_sha256']=hashlib.sha256(dest.read_bytes()).hexdigest();report['onnx_bytes']=dest.stat().st_size
 (ROOT/'ml/restaurant-report.json').write_text(json.dumps(report,indent=2));(ROOT/'public/models/yolo/restaurant-report.json').write_text(json.dumps(report,indent=2));print('EXPORTED',dest,flush=True)

if __name__=='__main__':main()

"""Fine-tune a separate lightweight detector on all eight annotated tabletops.
Very small, scene-specific experiment; no claim of general restaurant accuracy.
"""
import os,json,argparse,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'ml/work/all-tables'
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'ml/work/ultralytics');os.environ['YOLO_AUTOINSTALL']='false'
from ultralytics.models.yolo.detect import DetectionTrainer
class FrozenFeatureTrainer(DetectionTrainer):
 def get_model(self,cfg=None,weights=None,verbose=True):
  from copy import deepcopy
  return deepcopy(weights).float()
 def preprocess_batch(self,batch):
  import torch
  for layer in self.model.model[:22]:
   for module in layer.modules():
    if isinstance(module,torch.nn.modules.batchnorm._BatchNorm):module.eval()
  return super().preprocess_batch(batch)
def main():
 import cv2,torch,yaml,numpy as np
 from ultralytics import YOLO
 parser=argparse.ArgumentParser();parser.add_argument('--video',required=True);parser.add_argument('--evaluate-only',action='store_true');args=parser.parse_args();torch.set_num_threads(4)
 annotation=json.loads((ROOT/'ml/all-table-annotations.json').read_text());OUT.mkdir(parents=True,exist_ok=True)
 video=cv2.VideoCapture(args.video)
 for split,seconds in [('train',annotation['train_seconds']),('val',annotation['validation_seconds']),('test',annotation['test_seconds'])]:
  for second in seconds:
   video.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,image=video.read()
   if not ok:raise RuntimeError(f'Could not read frame {second}')
   image=cv2.resize(image,tuple(annotation['size']));im=OUT/'images'/split/f'{second}.jpg';label=OUT/'labels'/split/f'{second}.txt';im.parent.mkdir(parents=True,exist_ok=True);label.parent.mkdir(parents=True,exist_ok=True);cv2.imwrite(str(im),image)
   label.write_text('\n'.join(f'60 {(x1+x2)/1920:.8f} {(y1+y2)/1080:.8f} {(x2-x1)/960:.8f} {(y2-y1)/540:.8f}' for x1,y1,x2,y2 in annotation['boxes'][str(second)])+'\n')
 video.release();model=YOLO(str(ROOT/'ml/checkpoints/restaurant-tables.pt'))
 (OUT/'data.yaml').write_text(yaml.safe_dump({'path':str(OUT),'train':'images/train','val':'images/val','test':'images/test','names':model.names}))
 if not args.evaluate_only:model.train(trainer=FrozenFeatureTrainer,data=str(OUT/'data.yaml'),epochs=100,imgsz=640,batch=3,workers=0,device=0,freeze=22,optimizer='AdamW',lr0=.0008,lrf=.1,warmup_epochs=0,warmup_bias_lr=0,seed=20261124,deterministic=True,amp=False,mosaic=.1,close_mosaic=10,fliplr=0,degrees=1,translate=.04,scale=.1,plots=False,project=str(OUT),name='fit-frozen',exist_ok=True,patience=40)
 best=YOLO(str(OUT/'fit-frozen/weights/best.pt'))
 # Threshold is selected on validation only, before the final frame is examined.
 def check(second,threshold):
  split='val' if second==70 else 'test';image=cv2.imread(str(OUT/'images'/split/f'{second}.jpg'))
  result=best.predict(image,classes=[60],conf=threshold,iou=.4,max_det=12,imgsz=640,rect=False,verbose=False,device=0)[0]
  gt=annotation['boxes'][str(second)];used=set();tp=0
  for box in result.boxes.xyxy.cpu().numpy():
   scores=[]
   for index,g in enumerate(gt):
    inter=max(0,min(box[2],g[2])-max(box[0],g[0]))*max(0,min(box[3],g[3])-max(box[1],g[1]));union=(box[2]-box[0])*(box[3]-box[1])+(g[2]-g[0])*(g[3]-g[1])-inter
    scores.append(float(inter/max(union,1e-9)) if index not in used else 0)
   index=int(np.argmax(scores))
   if scores[index]>=.5:used.add(index);tp+=1
  return {'tp':tp,'fp':len(result.boxes)-tp,'fn':len(gt)-tp,'predictions':len(result.boxes)}
 grid=[{'threshold':t,**check(70,t)} for t in [.2,.3,.4,.5,.6,.7,.8,.9]]
 selected=max(grid,key=lambda x:(2*x['tp']/max(1,2*x['tp']+x['fp']+x['fn']),-x['fp'],x['threshold']));test=check(99,selected['threshold'])
 export=best.export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False,device='cpu');dest=OUT/'candidate.onnx';shutil.copyfile(export,dest)
 report={'model':'YOLOv8n','scope':'All eight visible tabletops in the supplied camera scene','annotations':'ml/all-table-annotations.json','train_frames':3,'train_boxes':24,'validation_frames':1,'test_frames':1,'iou':.5,'threshold_grid':grid,'selected':selected,'test':test,'onnx_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'limitations':['Only five annotated frames from the same video; not independent cross-camera validation.','Test frame was not used for fitting or threshold selection.','Tabletop annotations do not measure seating-zone accuracy.','People use a separate detector; this fine-tuning does not train people.','No universal or 100 percent accuracy claim.']}
 report['deployed']=False;report['deployment_note']='Candidate export stays in ignored ml/work. Manual review and regression comparison required before promotion; this run produced false positives on the final frame.'
 (ROOT/'public/models/yolo/all-tables-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if __name__=='__main__':main()

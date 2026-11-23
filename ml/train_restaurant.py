"""Fine-tune a separate tabletop detector on manually annotated user video frames.
Requires a compatible Python, ultralytics, OpenCV and ONNX. The people model is unchanged.
"""
import os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'ml/work/ultralytics')
os.environ['YOLO_AUTOINSTALL']='false'
import cv2,json,shutil,torch,yaml,argparse
from ultralytics import YOLO
from ultralytics.models.yolo.detect import DetectionTrainer

class PortableTrainer(DetectionTrainer):
 def get_model(self,cfg=None,weights=None,verbose=True):
  from copy import deepcopy
  return deepcopy(weights).float()
 def preprocess_batch(self,batch):
  for layer in self.model.model[:22]:
   for module in layer.modules():
    if isinstance(module,torch.nn.modules.batchnorm._BatchNorm):module.eval()
  return super().preprocess_batch(batch)

 def read_results_csv(self):
  # Standard-library CSV avoids loading the optional native Polars runtime on Windows.
  import csv
  if not self.csv.exists():return {}
  with self.csv.open(newline='') as f:
   rows=list(csv.DictReader(f))
  return {key:[float(row[key]) for row in rows] for key in rows[0]} if rows else {}


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--video',required=True);parser.add_argument('--epochs',type=int,default=100);parser.add_argument('--device',default='cpu');args=parser.parse_args()
 torch.set_num_threads(6)
 annotations=json.loads((ROOT/'ml/restaurant-annotations.json').read_text(encoding='utf-8'));out=ROOT/'ml/work/restaurant';out.mkdir(exist_ok=True,parents=True)
 cap=cv2.VideoCapture(args.video)
 for split,seconds in [('train',annotations['train_seconds']),('val',annotations['validation_seconds']),('test',annotations['test_seconds'])]:
  for t in seconds:
   cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,img=cap.read()
   if not ok:raise RuntimeError(f'Cannot read {t}s')
   img=cv2.resize(img,tuple(annotations['size']));image=out/'images'/split/f'{t:03}.jpg';label=out/'labels'/split/f'{t:03}.txt';image.parent.mkdir(parents=True,exist_ok=True);label.parent.mkdir(parents=True,exist_ok=True);cv2.imwrite(str(image),img);cv2.imwrite(str(out/f'frame_{t:03}.jpg'),img)
   boxes=annotations['boxes'][str(t)];label.write_text('\n'.join(f'60 {(x1+x2)/1920:.7f} {(y1+y2)/1080:.7f} {(x2-x1)/960:.7f} {(y2-y1)/540:.7f}' for x1,y1,x2,y2 in boxes)+'\n')
 cap.release();config={'path':str(out),'train':'images/train','val':'images/val','test':'images/test','names':YOLO(str(ROOT/'ml/work/yolov8n.pt')).names};(out/'data.yaml').write_text(yaml.safe_dump(config))
 model=YOLO(str(ROOT/'ml/work/yolov8n.pt'))
 model.train(trainer=PortableTrainer,data=str(out/'data.yaml'),epochs=args.epochs,imgsz=640,batch=4,workers=0,device=args.device,freeze=22,optimizer='AdamW',lr0=.0005,lrf=.05,warmup_epochs=3,warmup_bias_lr=0.,seed=20261111,deterministic=True,amp=False,mosaic=.5,close_mosaic=10,scale=.25,translate=.12,degrees=3,fliplr=0.,plots=False,save=True,project=str(out),name='fit-preserved',exist_ok=True,patience=0)
 best=out/'fit-preserved/weights/best.pt';shutil.copyfile(best,ROOT/'ml/checkpoints/restaurant-tables.pt')
 print('TRAINING_COMPLETE',best,flush=True)

if __name__=='__main__':main()

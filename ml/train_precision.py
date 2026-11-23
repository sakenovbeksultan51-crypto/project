"""Precision-oriented experiment on a disjoint subset of COCO2017 val.
Not the official COCO benchmark: some of val2017 is deliberately used for fitting.
"""
import os
os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config'
os.environ['YOLO_OFFLINE']='true'
import json,random,pathlib,yaml,torch,hashlib,shutil
from zipfile import ZipFile
from copy import deepcopy
from ultralytics import YOLO
from ultralytics.models.yolo.detect import DetectionTrainer
from torchvision.ops import box_iou
class PreserveTrainer(DetectionTrainer):
 def get_model(self,cfg=None,weights=None,verbose=True):
  if weights is None:raise ValueError('Complete pretrained weights required')
  return deepcopy(weights).float()
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR','/workspace/work/training')).resolve()
repo=pathlib.Path(__file__).resolve().parents[1];out=root/'precision';out.mkdir(exist_ok=True);torch.set_num_threads(3)
rng=random.Random(20261107);archive=root/'coco2017val.zip';z=ZipFile(archive)
files=sorted(n for n in z.namelist() if n.endswith('.jpg') and '/images/' in n)
groups={k:[] for k in ['person_furniture','person_other','negative_furniture','negative_other']}
for n in files:
 label=n.replace('/images/','/labels/').replace('.jpg','.txt')
 text=z.read(label).decode() if label in z.namelist() else ''
 classes={int(line.split()[0]) for line in text.splitlines() if line.strip()};person=0 in classes;furniture=bool(classes&{56,57,60})
 groups[('person_' if person else 'negative_')+('furniture' if furniture else 'other')].append((n,text))
print('POOLS', {k:len(v) for k,v in groups.items()},flush=True)
for g in groups.values():rng.shuffle(g)
# Split every stratum before selecting samples; no image occurs in both parts.
train=[];val=[]
for prefix,tcount,vcount in [('person',512,96),('negative',256,96)]:
 furniture=groups[prefix+'_furniture'];other=groups[prefix+'_other']
 vf=min(vcount//2,len(furniture)//4);tf=min(tcount//2,len(furniture)-vf)
 val+=furniture[:vf]+other[:vcount-vf];train+=furniture[vf:vf+tf]+other[vcount-vf:vcount-vf+tcount-tf]
for name,items in [('train',train),('val',val)]:
 paths=[]
 for member,label in items:
  image=out/'images'/name/pathlib.Path(member).name;image.parent.mkdir(parents=True,exist_ok=True);image.write_bytes(z.read(member))
  lp=out/'labels'/name/(image.stem+'.txt');lp.parent.mkdir(parents=True,exist_ok=True);lp.write_text(label);paths.append(str(image))
 (out/f'{name}.txt').write_text('\n'.join(paths)+'\n')
config=pathlib.Path(__import__('ultralytics').__file__).parent/'cfg/datasets/coco128.yaml'
data=yaml.safe_load(config.read_text());data.update(path=str(out),train=str(out/'train.txt'),val=str(out/'val.txt'));data.pop('download',None);(out/'data.yaml').write_text(yaml.safe_dump(data))
manifest={'seed':20261107,'source':'https://github.com/ultralytics/assets/releases/download/v0.0.0/coco2017val.zip','archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'train_images':len(train),'validation_images':len(val),'train_person_images':512,'train_negative_images':256,'validation_person_images':96,'validation_negative_images':96,'pools':{k:len(v) for k,v in groups.items()},'train_files':[pathlib.Path(n).name for n,_ in train],'validation_files':[pathlib.Path(n).name for n,_ in val]}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('DATASET_READY',len(train),len(val),flush=True)
from precision_metrics import evaluate as evaluate_checkpoint
def evaluate(weights,name):return evaluate_checkpoint(weights,name,out)
base=root/'yolov8n.pt';baseline=evaluate(base,'baseline')
YOLO(str(base)).train(trainer=PreserveTrainer,data=str(out/'data.yaml'),epochs=6,imgsz=640,batch=4,workers=0,device='cpu',freeze=22,optimizer='AdamW',lr0=0.00005,lrf=.2,warmup_epochs=.5,warmup_bias_lr=0.0,weight_decay=.0005,seed=20261107,deterministic=True,plots=False,save=True,project=str(out),name='fit',exist_ok=True,amp=False,mosaic=.25,close_mosaic=2,degrees=2,translate=.05,scale=.25,fliplr=.5,hsv_v=.3)
fineweights=out/'fit/weights/best.pt';fine=evaluate(fineweights,'finetuned')
use_fine=fine['false_positives']<baseline['false_positives'] and fine['precision']>=baseline['precision'] and fine['recall']>=baseline['recall']-.02
selected=fineweights if use_fine else base
report={'dataset':'COCO2017 val subset with people and negative images','epochs':6,'freeze_layers':22,'learning_rate':.00005,'manifest':manifest,'baseline':baseline,'finetuned':fine,'selected':'finetuned' if use_fine else 'pretrained','selection_rule':'Fewer false positives at confidence .45, precision no worse, recall decreases at most .02 on held-out subset.','limitation':'This is a small experiment, not independent restaurant evaluation or an official COCO val benchmark. The source val2017 is split into disjoint fit and validation subsets, used for experiment/model selection. No user camera frames were used. Furniture context does not certify seated-person coverage.'}
(out/'report.json').write_text(json.dumps(report,indent=2));shutil.copyfile(out/'report.json',repo/'ml/precision-report.json');shutil.copyfile(out/'report.json',repo/'public/models/yolo/precision-report.json');shutil.copyfile(out/'manifest.json',repo/'ml/precision-manifest.json');shutil.copyfile(fineweights,repo/'ml/checkpoints/precision-finetuned.pt')
if use_fine:
 exported=YOLO(str(selected)).export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False)
 shutil.copyfile(exported,repo/'public/models/yolo/person.onnx')
 provenance=json.loads((repo/'public/models/yolo/provenance.json').read_text());provenance.update(weights='precision-finetuned',onnx_sha256=hashlib.sha256((repo/'public/models/yolo/person.onnx').read_bytes()).hexdigest(),training_report='precision-report.json');(repo/'public/models/yolo/provenance.json').write_text(json.dumps(provenance,indent=2))
print('FINAL_REPORT',json.dumps(report),flush=True)

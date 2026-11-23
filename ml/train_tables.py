"""Train an 80-class YOLOv8n candidate for table detection and compare on held-out images."""
import os
os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config';os.environ['YOLO_OFFLINE']='true'
import json,pathlib,random,shutil,torch,yaml
from copy import deepcopy
from zipfile import ZipFile
from torchvision.ops import box_iou
from ultralytics import YOLO
from ultralytics.models.yolo.detect import DetectionTrainer
class PreserveTrainer(DetectionTrainer):
 def get_model(self,cfg=None,weights=None,verbose=True):
  if weights is None:raise ValueError('Full pretrained checkpoint required')
  return deepcopy(weights).float()
 def preprocess_batch(self,batch):
  # A frozen backbone must keep its running statistics fixed as well.
  for layer in self.model.model[:22]:
   for module in layer.modules():
    if isinstance(module,torch.nn.modules.batchnorm._BatchNorm):module.eval()
  return super().preprocess_batch(batch)
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR','/workspace/work/training'));out=root/'table-experiment';out.mkdir(exist_ok=True);torch.set_num_threads(3)
z=ZipFile(root/'coco2017val.zip');names=set(z.namelist());images=sorted(n for n in names if '/images/' in n and n.endswith('.jpg'))
exclude=set(json.loads((root/'precision/manifest.json').read_text())['validation_files']);positive=[];negative=[]
for member in images:
 if pathlib.Path(member).name in exclude:continue
 key=member.replace('/images/','/labels/').replace('.jpg','.txt');label=z.read(key).decode() if key in names else '';classes={int(x.split()[0]) for x in label.splitlines() if x.strip()}
 (positive if 60 in classes else negative).append((member,label))
rng=random.Random(20261109);rng.shuffle(positive);rng.shuffle(negative)
sets={'train':positive[:288]+negative[:224], 'val':positive[288:352]+negative[224:288], 'test':positive[352:416]+negative[288:352]}
assert len(positive)>=416 and len(negative)>=352
for subset,items in sets.items():
 paths=[]
 for member,label in items:
  img=out/'images'/subset/pathlib.Path(member).name;txt=out/'labels'/subset/(img.stem+'.txt');img.parent.mkdir(parents=True,exist_ok=True);txt.parent.mkdir(parents=True,exist_ok=True);img.write_bytes(z.read(member));txt.write_text(label);paths.append(str(img))
 (out/(subset+'.txt')).write_text('\n'.join(paths)+'\n')
config=pathlib.Path(__import__('ultralytics').__file__).parent/'cfg/datasets/coco128.yaml';data=yaml.safe_load(config.read_text());data.update(path=str(out),train=str(out/'train.txt'),val=str(out/'val.txt'));data.pop('download',None);(out/'data.yaml').write_text(yaml.safe_dump(data))
manifest={'seed':20261109,'source':'COCO 2017 val subset (Ultralytics mirror)','train_images':512,'val_images':128,'test_images':128,'train_files':[pathlib.Path(n).name for n,_ in sets['train']],'val_files':[pathlib.Path(n).name for n,_ in sets['val']],'test_files':[pathlib.Path(n).name for n,_ in sets['test']],'note':'disjoint images; selected from COCO val, not an official COCO benchmark; user restaurant video was not included'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));print('DATA_READY', {k:len(v) for k,v in sets.items()},flush=True)
def evaluate(weights,split):
 results={c:{'tp':0,'fp':0,'fn':0,'small_tp':0,'small_fn':0} for c in [0,60]};paths=(out/(split+'.txt')).read_text().splitlines();model=YOLO(str(weights))
 for start in range(0,len(paths),8):
  for pred in model.predict(paths[start:start+8],imgsz=640,conf=.3,iou=.45,classes=[0,60],device='cpu',verbose=False):
   rows=(out/'labels'/split/(pathlib.Path(pred.path).stem+'.txt')).read_text().splitlines();h,w=pred.orig_shape
   for cls in [0,60]:
    gt=[];small=[]
    for line in rows:
     c,x,y,bw,bh=map(float,line.split())
     if int(c)==cls:gt.append([(x-bw/2)*w,(y-bh/2)*h,(x+bw/2)*w,(y+bh/2)*h]);small.append(bw*bh<.02)
    mask=(pred.boxes.cls==cls)&(pred.boxes.conf>=(.45 if cls==0 else .4));boxes=pred.boxes.xyxy[mask].cpu();matches=set();over=box_iou(boxes,torch.tensor(gt,dtype=torch.float32).reshape(-1,4));stats=results[cls]
    for i in range(len(boxes)):
     choices=[j for j in range(len(gt)) if j not in matches and over[i,j]>=.5]
     if choices:
      j=max(choices,key=lambda k:over[i,k].item());matches.add(j);stats['tp']+=1;stats['small_tp']+=int(small[j])
     else:stats['fp']+=1
    for j in range(len(gt)):
     if j not in matches:stats['fn']+=1;stats['small_fn']+=int(small[j])
 for stats in results.values():
  stats['precision']=stats['tp']/max(1,stats['tp']+stats['fp']);stats['recall']=stats['tp']/max(1,stats['tp']+stats['fn']);stats['small_recall']=stats['small_tp']/max(1,stats['small_tp']+stats['small_fn'])
 return {'person':results[0],'table':results[60]}
def acceptable(candidate,base):
 t,b=candidate['table'],base['table'];p,q=candidate['person'],base['person']
 return t['recall']>=b['recall']+.02 and t['precision']>=b['precision']-.04 and t['small_recall']>=b['small_recall']+.05 and p['recall']>=q['recall']-.03 and p['precision']>=q['precision']-.03
base=root/'yolov8n.pt';baseline=evaluate(base,'val');print('BASELINE_VAL',json.dumps(baseline),flush=True)
YOLO(str(base)).train(trainer=PreserveTrainer,data=str(out/'data.yaml'),epochs=4,imgsz=640,batch=4,workers=0,device='cpu',freeze=22,optimizer='AdamW',lr0=.00005,lrf=.2,warmup_epochs=.5,warmup_bias_lr=0.,seed=20261109,deterministic=True,amp=False,mosaic=.35,close_mosaic=1,scale=.5,translate=.08,plots=False,save=True,project=str(out),name='fit',exist_ok=True)
candidates=[]
for name in ['best','last']:
 weight=out/'fit/weights'/f'{name}.pt';m=evaluate(weight,'val');candidates.append((name,weight,m));print('CANDIDATE_VAL',name,json.dumps(m),flush=True)
eligible=[c for c in candidates if acceptable(c[2],baseline)];chosen=max(eligible,key=lambda c:(c[2]['table']['small_recall'],c[2]['table']['recall'])) if eligible else None
base_test=evaluate(base,'test');candidate_test=evaluate(chosen[1],'test') if chosen else None;best_test=candidate_test if chosen and chosen[0]=='best' else evaluate(out/'fit/weights/best.pt','test')
use=bool(chosen and acceptable(candidate_test,base_test));selected=chosen[0] if use else 'pretrained'
report={'dataset':'COCO2017 val subset: images with and without dining tables','manifest':manifest,'epochs':4,'frozen_backbone_layers':22,'thresholds':{'person':.45,'table':.4,'matching_iou':.5},'selection_rule':'table recall increases at least .02, precision decreases at most .04, small-table recall increases at least .05, person recall and precision decrease at most .03; must pass validation and untouched test','baseline_validation':baseline,'candidates_validation':{n:m for n,_,m in candidates},'baseline_test':base_test,'selected_candidate_test':candidate_test,'best_candidate_test':best_test,'selected':selected,'limitation':'Dataset is a sampled subset of COCO validation, selected for this experiment. It does not measure performance on the user video. Some COCO annotations can miss or merge tables.'}
(out/'report.json').write_text(json.dumps(report,indent=2));repo=pathlib.Path(__file__).resolve().parents[1];shutil.copyfile(out/'report.json',repo/'ml/table-report.json');shutil.copyfile(out/'report.json',repo/'public/models/yolo/table-training-report.json');shutil.copyfile(out/'fit/weights/best.pt',repo/'ml/checkpoints/table-finetuned.pt')
if use:
 import hashlib
 exported=YOLO(str(chosen[1])).export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False);shutil.copyfile(exported,repo/'public/models/yolo/person.onnx')
 p=repo/'public/models/yolo/provenance.json';v=json.loads(p.read_text());v.update(weights='table-finetuned',onnx_sha256=hashlib.sha256((repo/'public/models/yolo/person.onnx').read_bytes()).hexdigest(),training_report='table-training-report.json',checkpoint=chosen[0]);p.write_text(json.dumps(v,indent=2))
print('FINAL',json.dumps({k:v for k,v in report.items() if k!='manifest'}),flush=True)

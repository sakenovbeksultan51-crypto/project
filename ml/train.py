"""Small, reproducible fine-tuning experiment; not restaurant accuracy certification."""
import os
os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config'
os.environ['YOLO_OFFLINE']='true'
import json,random,pathlib,yaml,torch,shutil
from ultralytics import YOLO
from ultralytics.models.yolo.detect import DetectionTrainer
from copy import deepcopy
class PreserveTrainer(DetectionTrainer):
 def get_model(self,cfg=None,weights=None,verbose=True):
  if weights is None: raise ValueError("A complete pretrained model is required")
  return deepcopy(weights).float()
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR',str(pathlib.Path(__file__).resolve().parent/'work'))).resolve();torch.set_num_threads(3)
images=sorted((root/'coco128/images/train2017').glob('*.jpg'));random.Random(42).shuffle(images)
train=images[:96];val=images[96:]
for name,items in [('train',train),('val',val)]: (root/f'{name}.txt').write_text('\n'.join(str(p) for p in items)+'\n')
# Preserve original 80-class head; all labels remain usable.
config=pathlib.Path(__import__('ultralytics').__file__).parent/'cfg/datasets/coco128.yaml'
data=yaml.safe_load(config.read_text());data.update(path=str(root),train=str(root/'train.txt'),val=str(root/'val.txt'));data.pop('download',None)
(root/'data.yaml').write_text(yaml.safe_dump(data))
def evaluate(model,name):
 r=model.val(data=str(root/'data.yaml'),imgsz=640,batch=4,workers=0,device='cpu',plots=False,project=str(root/'runs'),name=name,verbose=False)
 ids=list(r.box.ap_class_index);i=ids.index(0)
 return {'person_precision':float(r.box.p[i]),'person_recall':float(r.box.r[i]),'person_mAP50':float(r.box.ap50[i]),'person_mAP50_95':float(r.box.maps[0])}
base=YOLO(str(root/'yolov8n.pt'));baseline=evaluate(base,'baseline')
(root/'baseline.json').write_text(json.dumps(baseline,indent=2))
YOLO(str(root/'yolov8n.pt')).train(trainer=PreserveTrainer,data=str(root/'data.yaml'),epochs=4,imgsz=640,batch=4,workers=0,device='cpu',freeze=10,optimizer='AdamW',lr0=0.0002,warmup_epochs=0.5,weight_decay=0.0005,seed=42,deterministic=True,plots=False,save=True,project=str(root/'runs'),name='finetune_preserved',exist_ok=True,amp=False,mosaic=0.5,close_mosaic=1,degrees=3,translate=0.1,scale=0.4,fliplr=0.5)
checkpoint=root/'runs/finetune_preserved/weights/best.pt';fine=evaluate(YOLO(str(checkpoint)),'finetuned_eval')
use_fine=fine['person_mAP50_95']>baseline['person_mAP50_95'] and fine['person_recall']>=baseline['person_recall']
selected=checkpoint if use_fine else root/'yolov8n.pt'
report={'dataset':'COCO128','seed':42,'train_images':96,'validation_images':32,'epochs':4,'baseline':baseline,'finetuned':fine,'selected':'finetuned' if use_fine else 'pretrained','limitation':'COCO128 is a small pipeline dataset drawn from COCO training data. Pretrained models may have seen these images. This is not independent restaurant/seated-person evaluation.','train_files':[p.name for p in train],'validation_files':[p.name for p in val]}
(root/'report.json').write_text(json.dumps(report,indent=2))
exported=YOLO(str(selected)).export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False)
shutil.copyfile(exported,str(pathlib.Path(__file__).resolve().parents[1]/'public/models/yolo/person.onnx'))
shutil.copyfile(root/'report.json',str(pathlib.Path(__file__).resolve().parent/'report.json'))
print('FINAL_REPORT',json.dumps(report))

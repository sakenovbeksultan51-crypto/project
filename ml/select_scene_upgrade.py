"""Select by validation only, export ONNX, report held-out regression results.
No accuracy guarantee is inferred from detection counts on the supplied video.
"""
import os,json,hashlib,shutil,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'ml/work/scene-upgrade'
os.environ['YOLO_CONFIG_DIR']=str(ROOT/'ml/work/ultralytics');os.environ['YOLO_AUTOINSTALL']='false'
import torch,cv2
from ultralytics import YOLO
torch.set_num_threads(4)
def evaluate(model,split):
 result=model.val(data=str(OUT/'data.yaml'),split=split,imgsz=640,batch=4,workers=0,device=0,plots=False,verbose=False,project=str(OUT),name=f'{split}-comparison',exist_ok=True)
 classes={}
 for index,cls in enumerate(result.box.ap_class_index):
  if int(cls) in [0,60]:
   p,r,ap50,ap=result.box.class_result(index);classes[model.names[int(cls)]]={'precision':float(p),'recall':float(r),'ap50':float(ap50),'ap50_95':float(ap)}
 return {'map50':float(result.box.map50),'map50_95':float(result.box.map),'classes':classes}
base=YOLO(str(ROOT/'ml/work/yolo11s.pt'));candidate=YOLO(str(OUT/'fit/weights/best.pt'))
a=evaluate(base,'val');b=evaluate(candidate,'val')
accept=b['map50_95']>=a['map50_95'] and all(b['classes'].get(cls,{}).get('ap50',0)>=a['classes'].get(cls,{}).get('ap50',0)-.02 for cls in ['person','dining table'])
selected=candidate if accept else base
report={'model':'YOLO11s','selected':'coco128-finetuned' if accept else 'pretrained','selection_rule':'Validation mAP50-95 must not decrease and person/table AP50 may decrease at most 0.02. Video counts do not select the model.','dataset':json.loads((OUT/'manifest.json').read_text()),'pretrained_validation':a,'candidate_validation':b,'selected_test':evaluate(selected,'test'),'limitations':['COCO128 may overlap model pretraining; these metrics are regression checks, not independent benchmark scores.','User restaurant video is not used for this fine-tuning. Existing separate tabletop model was previously trained on this video.','Frame detection counts are not measured precision/recall; restaurant annotations and more independent videos are needed.','No 100 percent detection claim.']}
export=selected.export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False,device='cpu')
dest=ROOT/'public/models/yolo/people-upgraded.onnx';shutil.copyfile(export,dest);report['onnx_sha256']=hashlib.sha256(dest.read_bytes()).hexdigest();report['onnx_bytes']=dest.stat().st_size
report['video_predictions']={}
for second in [0,25,70,99]:
 image=cv2.imread(str(ROOT/f'ml/work/current-video/frame-{second}.jpg'))
 result=selected.predict(image,conf=.3,imgsz=640,rect=False,device='cpu',verbose=False)[0]
 report['video_predictions'][str(second)]={'people':int((result.boxes.cls==0).sum()),'tables':int((result.boxes.cls==60).sum())}
 result.save(filename=str(ROOT/f'ml/work/current-video/selected-{second}.jpg'))
(ROOT/'public/models/yolo/scene-upgrade-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'selected':report['selected'],'validation':a['map50_95'],'candidate':b['map50_95'],'onnx_bytes':report['onnx_bytes'],'video':report['video_predictions']}),flush=True)

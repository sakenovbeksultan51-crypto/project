"""Compare frozen-backbone BN restoration without any further weight updates.
Freezing parameters alone does not freeze BatchNorm running statistics in train mode.
"""
import os
os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config';os.environ['YOLO_OFFLINE']='true'
import pathlib,json,torch,shutil,hashlib
from ultralytics import YOLO
from precision_metrics import evaluate
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR','/workspace/work/training'));out=root/'precision';repo=pathlib.Path(__file__).resolve().parents[1]
torch.set_num_threads(3);report=json.loads((out/'report.json').read_text());base=YOLO(str(root/'yolov8n.pt')).model.state_dict();candidates=[]
for name in ['best','last']:
 model=YOLO(str(out/f'fit/weights/{name}.pt'));restored=0
 for key,buffer in model.model.named_buffers():
  layer=int(key.split('.')[1])
  if layer<22 and key in base:
   buffer.copy_(base[key]);restored+=1
 weights=out/f'{name}-frozen-stats.pt';model.save(str(weights));metrics=evaluate(weights,f'{name}_restored',out);candidates.append({'name':name+'-frozen-stats','restored_buffers':restored,'metrics':metrics,'weights':weights})
b=report['baseline'];eligible=[c for c in candidates if c['metrics']['false_positives']<b['false_positives'] and c['metrics']['precision']>=b['precision'] and c['metrics']['recall']>=b['recall']-.02]
report['frozen_stats_candidates']=[{k:v for k,v in c.items() if k!='weights'} for c in candidates]
report['frozen_stats_note']='Parameters in backbone layers 0-21 were frozen during training; their BatchNorm running buffers still updated in train mode. These candidates restore only those frozen-layer buffers from the original pretrained model, without any additional gradient updates. Best and last candidates were compared on the same model-selection subset, not an independent test.'
if eligible:
 chosen=max(eligible,key=lambda c:(c['metrics']['recall'],c['metrics']['precision']));report['selected']='finetuned_frozen_stats';report['selected_checkpoint']=chosen['name'];report['selected_metrics']=chosen['metrics'];shutil.copyfile(chosen['weights'],repo/'ml/checkpoints/precision-selected.pt')
 exported=YOLO(str(chosen['weights'])).export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False);shutil.copyfile(exported,repo/'public/models/yolo/person.onnx')
 p=repo/'public/models/yolo/provenance.json';provenance=json.loads(p.read_text());provenance.update(weights=report['selected'],onnx_sha256=hashlib.sha256((repo/'public/models/yolo/person.onnx').read_bytes()).hexdigest(),training_report='precision-report.json',checkpoint=chosen['name']);p.write_text(json.dumps(provenance,indent=2))
for path in [out/'report.json',repo/'ml/precision-report.json',repo/'public/models/yolo/precision-report.json']:path.write_text(json.dumps(report,indent=2))
print('FINAL_SELECTION',report['selected'],report.get('selected_metrics',b),flush=True)

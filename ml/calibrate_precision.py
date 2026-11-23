"""Select model/threshold pair on validation, not on an independent test set."""
import os
os.environ['YOLO_CONFIG_DIR']='/workspace/work/training/config';os.environ['YOLO_OFFLINE']='true'
import pathlib,json,torch,shutil,hashlib
from ultralytics import YOLO
from precision_metrics import evaluate
root=pathlib.Path(os.environ.get('TABLEFLOW_TRAIN_DIR','/workspace/work/training'));out=root/'precision';repo=pathlib.Path(__file__).resolve().parents[1];torch.set_num_threads(3)
report=json.loads((out/'report.json').read_text());weights=out/'best-frozen-stats.pt';b=report['baseline'];candidates=[]
for threshold in [.4,.35]:candidates.append(evaluate(weights,f'calibrated_{threshold}',out,threshold))
report['threshold_calibration']={'candidates':candidates,'note':'Additional validation-stage calibration of best frozen-stats model at confidence .40 and .35. Compared to baseline at .45. Same precision/recall acceptance bounds. These are model-selection measurements, not an independent test.'}
eligible=[m for m in candidates if m['false_positives']<b['false_positives'] and m['precision']>=b['precision'] and m['recall']>=b['recall']-.02]
if eligible:
 chosen=max(eligible,key=lambda m:(m['recall'],m['precision']));report.update(selected='finetuned_frozen_stats_calibrated',selected_checkpoint='best-frozen-stats',selected_metrics=chosen,selected_threshold=chosen['threshold']);shutil.copyfile(weights,repo/'ml/checkpoints/precision-selected.pt')
 exported=YOLO(str(weights)).export(format='onnx',imgsz=640,opset=17,simplify=False,dynamic=False);shutil.copyfile(exported,repo/'public/models/yolo/person.onnx')
 p=repo/'public/models/yolo/provenance.json';provenance=json.loads(p.read_text());provenance.update(weights=report['selected'],onnx_sha256=hashlib.sha256((repo/'public/models/yolo/person.onnx').read_bytes()).hexdigest(),training_report='precision-report.json',checkpoint='best-frozen-stats',default_confidence=chosen['threshold']);p.write_text(json.dumps(provenance,indent=2))
for path in [out/'report.json',repo/'ml/precision-report.json',repo/'public/models/yolo/precision-report.json']:path.write_text(json.dumps(report,indent=2))
print('CALIBRATION_RESULT',report['selected'],report.get('selected_metrics',b),flush=True)

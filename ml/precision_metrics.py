import json,pathlib,torch
from ultralytics import YOLO
from torchvision.ops import box_iou
def evaluate(weights,name,out,threshold=.45):
 model=YOLO(str(weights));tp=fp=fn=negframes=negfp=0;predictions=[]
 paths=(out/'val.txt').read_text().splitlines()
 for start in range(0,len(paths),8):
  results=model.predict(paths[start:start+8],imgsz=640,conf=threshold,iou=.45,classes=[0],device='cpu',verbose=False)
  for r in results:
   labels=(out/'labels/val'/(pathlib.Path(r.path).stem+'.txt')).read_text().splitlines();gt=[];h,w=r.orig_shape
   for line in labels:
    c,cx,cy,bw,bh=map(float,line.split())
    if int(c)==0:gt.append([(cx-bw/2)*w,(cy-bh/2)*h,(cx+bw/2)*w,(cy+bh/2)*h])
   boxes=r.boxes.xyxy.cpu();matched=set();localfp=0
   overlaps=box_iou(boxes,torch.tensor(gt,dtype=torch.float32).reshape(-1,4))
   for i in range(len(boxes)):
    choices=[j for j in range(len(gt)) if j not in matched and overlaps[i,j]>=.5]
    if choices:matched.add(max(choices,key=lambda j:overlaps[i,j].item()));tp+=1
    else:fp+=1;localfp+=1
   fn+=len(gt)-len(matched)
   if not gt:negframes+=1;negfp+=int(localfp>0)
   predictions.append({'file':pathlib.Path(r.path).name,'ground_truth_people':len(gt),'detections':len(boxes),'false_positives':localfp})
 metrics={'threshold':threshold,'matching_iou':.5,'true_positives':tp,'false_positives':fp,'false_negatives':fn,'precision':tp/max(1,tp+fp),'recall':tp/max(1,tp+fn),'negative_images':negframes,'negative_images_with_false_person':negfp}
 (out/f'{name}.json').write_text(json.dumps({'metrics':metrics,'predictions':predictions},indent=2));print(name,metrics,flush=True);return metrics

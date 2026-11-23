"""Compare actual exported ONNX pipelines on supplied video, without accuracy claims."""
import argparse,json,time,cv2,numpy as np,onnxruntime as ort
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def detections(session,image,threshold):
 h,w=image.shape[:2];scale=min(640/w,640/h);dw,dh=round(w*scale),round(h*scale);px,py=(640-dw)//2,(640-dh)//2
 canvas=np.full((640,640,3),114,np.uint8);canvas[py:py+dh,px:px+dw]=cv2.resize(image,(dw,dh))
 tensor=canvas[:,:,::-1].transpose(2,0,1).astype(np.float32)[None]/255
 output=session.run(None,{session.get_inputs()[0].name:tensor})[0][0];found=[]
 for i in range(output.shape[1]):
  cls=int(np.argmax(output[4:,i]));score=float(output[4+cls,i])
  if cls not in [0,60] or score<threshold:continue
  cx,cy,bw,bh=output[:4,i];left=max(0,float(cx-bw/2-px)/scale);top=max(0,float(cy-bh/2-py)/scale);right=min(w,float(cx+bw/2-px)/scale);bottom=min(h,float(cy+bh/2-py)/scale)
  if right>left and bottom>top:found.append({'class':cls,'score':score,'box':[left,top,right-left,bottom-top]})
 return suppress(found,.45)
def suppress(found,iou):
 out=[]
 for cls in [0,60]:
  candidates=[d for d in found if d['class']==cls]
  indexes=cv2.dnn.NMSBoxes([d['box'] for d in candidates],[d['score'] for d in candidates],.01,iou)
  out.extend(candidates[int(i)] for i in np.asarray(indexes).reshape(-1))
 return out
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--video',required=True);args=parser.parse_args()
 sessions={name:ort.InferenceSession(str(ROOT/'public/models/yolo'/file),providers=['CPUExecutionProvider']) for name,file in [('old','person.onnx'),('new','people-upgraded.onnx'),('tables','restaurant-tables.onnx')]}
 video=cv2.VideoCapture(args.video);report={'threshold':.3,'table_threshold':.2,'frames':[],'caveat':'Counts are predictions, not precision or recall. Separate tabletop weights were previously fitted to this same video. CPU timings are native ONNX, not browser WASM.'}
 for second in [0,25,70,99]:
  video.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,image=video.read()
  if not ok:raise RuntimeError(f'Could not read {second}s')
  image=cv2.resize(image,(960,540));row={'second':second}
  table=[d for d in detections(sessions['tables'],image,.2) if d['class']==60]
  for name in ['old','new']:
   start=time.perf_counter();found=detections(sessions[name],image,.3)
   tiled=[];height,width=image.shape[:2]
   for cy in [0,int(height*.4)]:
    for cx in [0,int(width*.4)]:
     cw,ch=int(width*.6),int(height*.6)
     for detection in detections(sessions[name],image[cy:cy+ch,cx:cx+cw],.3):
      if detection['class']!=60:continue
      x,y,w,h=detection['box']
      if cx>0 and x<=4 or cy>0 and y<=4 or cx+cw<width-1 and x+w>=cw-4 or cy+ch<height-1 and y+h>=ch-4:continue
      tiled.append({**detection,'box':[x+cx,y+cy,w,h]})
   generic=suppress([d for d in found if d['class']==60]+tiled,.45)
   tables=suppress(table+generic,.4)
   row[name]={'people':sum(d['class']==0 for d in found),'general_tables':sum(d['class']==60 for d in found),'tiled_general_tables':len(generic),'combined_tables':len(tables),'inference_and_decode_ms':round((time.perf_counter()-start)*1000)}
  report['frames'].append(row)
 video.release();(ROOT/'public/models/yolo/scene-video-comparison.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if __name__=='__main__':main()

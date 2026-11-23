"""Run the exported detector on IMG_8081.MOV, preserving full source resolution.
The target frame contains eight visible people; manually inspect boxes
instead of treating a count of eight as evidence of correct matching.
"""
import argparse,json,time,cv2,numpy as np,onnxruntime as ort
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def infer(session,image,size,threshold=.3,person_iou=.6):
 height,width=image.shape[:2];scale=min(size/width,size/height);dw,dh=round(width*scale),round(height*scale);px,py=(size-dw)//2,(size-dh)//2
 canvas=np.full((size,size,3),114,np.uint8);canvas[py:py+dh,px:px+dw]=cv2.resize(image,(dw,dh))
 tensor=canvas[:,:,::-1].transpose(2,0,1).astype(np.float32)[None]/255
 start=time.perf_counter();data=session.run(None,{session.get_inputs()[0].name:tensor})[0][0];duration=round((time.perf_counter()-start)*1000);found=[]
 for i in range(data.shape[1]):
  cls=int(np.argmax(data[4:,i]));score=float(data[4+cls,i])
  if cls!=0 or score<threshold:continue
  cx,cy,w,h=data[:4,i];x1=max(0,float(cx-w/2-px)/scale);y1=max(0,float(cy-h/2-py)/scale);x2=min(width,float(cx+w/2-px)/scale);y2=min(height,float(cy+h/2-py)/scale)
  if x2>x1 and y2>y1:found.append({'bbox':[x1,y1,x2-x1,y2-y1],'score':score})
 def fragment(d):
  x,y,w,h=d['bbox'];area=w*h
  for a in found:
   if a is d:continue
   ax,ay,aw,ah=a['bbox']
   if aw*ah<area*1.25:continue
   intersection=max(0,min(x+w,ax+aw)-max(x,ax))*max(0,min(y+h,ay+ah)-max(y,ay))
   if intersection/area>.85 and abs(x+w/2-ax-aw/2)<aw*.25 and abs(y-ay)<min(h,ah)*.15:return True
  return False
 filtered=[d for d in found if not fragment(d)]
 indexes=cv2.dnn.NMSBoxes([d['bbox'] for d in filtered],[d['score'] for d in filtered],threshold,person_iou)
 return [filtered[int(i)] for i in np.asarray(indexes).reshape(-1)],duration,tensor
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--video',required=True);args=parser.parse_args()
 out=ROOT/'ml/work/eight-people';out.mkdir(parents=True,exist_ok=True)
 session=ort.InferenceSession(str(ROOT/'public/models/yolo/people-upgraded.onnx'),providers=['CPUExecutionProvider'])
 video=cv2.VideoCapture(args.video);report={'video':'IMG_8081.MOV','fit_on_this_video':False,'threshold':.3,'frames':[]}
 for second in [3,4,5,8,12]:
  video.set(cv2.CAP_PROP_POS_MSEC,second*1000);ok,image=video.read()
  if not ok:raise RuntimeError(f'Frame {second}s not available')
  row={'second':second}
  for size,iou in [(640,.6),(960,.6)]:
   detections,ms,tensor=infer(session,image,size,person_iou=iou);row[str(size)]={'count':len(detections),'native_inference_ms':ms,'detections':detections}
   shown=image.copy()
   for index,detection in enumerate(detections):
    x,y,w,h=map(round,detection['bbox']);cv2.rectangle(shown,(x,y),(x+w,y+h),(0,190,0),3);cv2.putText(shown,f"{index+1}: {detection['score']:.2f}",(x,max(20,y-7)),cv2.FONT_HERSHEY_SIMPLEX,.65,(0,190,0),2)
   cv2.imwrite(str(out/f'probe-{second}-{size}.jpg'),shown)
   if second in [3,4,5]:tensor.tofile(out/f'input-{second}-{size}.bin')
  report['frames'].append(row)
 video.release();(out/'probe-report.json').write_text(json.dumps(report,indent=2));print(json.dumps([{'second':x['second'],'640':x['640']['count'],'960':x['960']['count']} for x in report['frames']]),flush=True)
if __name__=='__main__':main()

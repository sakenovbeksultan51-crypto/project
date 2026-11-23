import cv2,json,numpy as np,argparse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--video');args=parser.parse_args()
root=Path('ml/work/restaurant');refs=[]
cap=cv2.VideoCapture(args.video) if args.video else None
for t in [80,90,99]:
 if cap is not None:
  cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,image=cap.read();assert ok
 else:image=cv2.imread(str(root/f'frame_{t:03}.jpg'))
 h,w=image.shape[:2];scale=min(640/w,640/h);dw=round(w*scale);dh=round(h*scale);px=(640-dw)//2;py=(640-dh)//2;canvas=np.full((640,640,3),114,dtype=np.uint8);canvas[py:py+dh,px:px+dw]=cv2.resize(image,(dw,dh));tensor=np.transpose(canvas[:,:,::-1],(2,0,1)).astype(np.float32)/255;tensor.tofile(root/f'ref_{t}.f32');refs.append({'second':t,'width':w,'height':h,'scale':scale,'px':px,'py':py})
(root/'references.json').write_text(json.dumps(refs))

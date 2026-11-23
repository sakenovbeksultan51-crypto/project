import cv2,numpy as np,json,argparse
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--video',required=True);args=parser.parse_args()
out=Path('ml/work/service-probes');out.mkdir(exist_ok=True);cap=cv2.VideoCapture(args.video);refs=[]
for t in [0,2,4,60,62,64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,98]:
 cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,im=cap.read();assert ok
 h,w=im.shape[:2];scale=min(640/w,640/h);dw=round(w*scale);dh=round(h*scale);px=(640-dw)//2;py=(640-dh)//2;canvas=np.full((640,640,3),114,dtype=np.uint8);canvas[py:py+dh,px:px+dw]=cv2.resize(im,(dw,dh));np.transpose(canvas[:,:,::-1],(2,0,1)).astype(np.float32).__truediv__(255).tofile(out/f'{t}.f32');refs.append({'second':t,'width':w,'height':h,'scale':scale,'px':px,'py':py})
(out/'references.json').write_text(json.dumps(refs));cap.release();print('Prepared',len(refs),'original-video probes')

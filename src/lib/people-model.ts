/** Selected by the COCO128 regression validation; see the linked report. */
export const PEOPLE_MODEL={url:'/models/yolo/people-upgraded.onnx?v=20261124-detail',name:'YOLO11s',confidence:0.3,detailSize:960,compactDetailSize:800} as const;
/** Smaller source frames benefit from a faster model input; larger frames keep detail. */
export function peopleDetailSize(width:number){return width<=1280?PEOPLE_MODEL.compactDetailSize:PEOPLE_MODEL.detailSize;}

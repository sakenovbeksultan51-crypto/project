import type {Detection} from './vision';

export type VisionOptions={detail:boolean;tableDetail:boolean;frontTables:boolean;max:number;threshold:number};
export type VisionRequest=
 |{id:number;type:'init';origin:string}
 |{id:number;type:'detect';bitmap:ImageBitmap;options:VisionOptions};
export type VisionResponse={id:number;detections?:Detection[];error?:string};

export function cameraInviteURL(origin:string,code:string,invite:string){
 return `${origin}/watch#${new URLSearchParams({room:code,invite})}`;
}
export function parseCameraInvite(value:string):{code:string;invite:string}|null{
 try{const fragment=value.startsWith('#')?value:new URL(value).hash;const p=new URLSearchParams(fragment.slice(1));const code=p.get('room')||'',invite=p.get('invite')||'';return /^[A-F0-9]{12}$/.test(code)&&/^[a-f0-9]{64}$/.test(invite)?{code,invite}:null;}catch{return null;}
}

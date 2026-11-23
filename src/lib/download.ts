export function download(name:string,content:string,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function csvCell(value:unknown){const text=String(value);return '"'+(/^[=+@\-]/.test(text)?"'":"")+text.replaceAll('"','""')+'"';}

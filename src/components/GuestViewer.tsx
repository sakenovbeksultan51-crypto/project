'use client';
import {useState} from 'react';
import {Eye,UtensilsCrossed} from 'lucide-react';
import {initialState} from '../lib/engine';
import VideoPanel from './VideoPanel';
export default function GuestViewer(){
 const [state,setState]=useState(()=>initialState('live')),[notice,setNotice]=useState('');
 return <main className="guest-page"><header><a className="guest-brand" href="/"><UtensilsCrossed size={23}/>TableFlow</a><span className="pill neutral"><Eye size={14}/>Гостевой просмотр</span></header><div className="page-heading"><div><span className="eyebrow">ПРИГЛАШЕНИЕ В ЗАЛ</span><h1>Зал рядом. Где бы вы ни были.</h1><p>Смотрите камеру без регистрации. Распознавание выполняется здесь. Наблюдения и зоны передаются устройству камеры; карта синхронизируется между устройствами. Лист ожидания и личные данные владельца гостю не передаются.</p></div></div>{notice&&<div className="notice" role="status">{notice}</div>}<VideoPanel guest state={state} update={setState} notify={setNotice} goLive={()=>{}} onSession={()=>{}}/><footer className="page-footer">Гостевой доступ к одной камере · без аудио и записи</footer></main>;
}

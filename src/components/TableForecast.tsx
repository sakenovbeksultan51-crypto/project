import {Clock3,Info,Users} from 'lucide-react';
import type {AppState,Table} from '../lib/engine';
import {elapsed} from '../lib/engine';
import {forecastTable,bayesianForecast,formatForecastTime,formatForecastDuration} from '../lib/table-forecast';
const sampleLabel=(n:number)=>`${n} ${n%10===1&&n%100!==11?'завершённому посещению':'завершённым посещениям'}`;

export function ForecastMethod(){
 return <section className="panel forecast-method"><div className="panel-head"><div><h2>Прогноз ухода гостей</h2><p>Среднее время завершённых посещений</p></div><Clock3 size={20}/></div><div className="forecast-method-body"><p>Система вычисляет среднюю длительность посещения и прибавляет её ко времени посадки. При трёх и более посещениях этого стола берётся его история; иначе — история всего зала. Для первого прогноза нужно хотя бы одно завершённое посещение; с одним или двумя прогноз предварительный.</p><p>Если гости уже сидят дольше среднего, точный срок не предполагается. Это оценка времени ухода гостей, а подготовка и уборка стола могут занять дополнительное время. Данные относятся к текущей смене и режиму.</p><div className="forecast-formula">Ожидаемый уход ≈ время посадки + средняя длительность посещения</div></div></section>;
}

export function BayesianProbabilities({table,state,now}:{table:Table;state:AppState;now:number}){
 const prediction=bayesianForecast(table,state.visits,now);
 if(!prediction)return null;
 return <div className="bayes-probabilities"><span>Вероятность ухода гостей</span><div className="bayes-windows">{prediction.windows.map(w=><div key={w.minutes}><small>За {w.minutes} мин</small><strong>{Math.round(w.probability*100)}%</strong><i><b style={{width:`${w.probability*100}%`}}/></i></div>)}</div><small>{prediction.basis==='table'?'История этого стола':'История зала'} · {prediction.sampleCount} посещений · {prediction.comparableCount} длиннее текущего</small>{prediction.preliminary&&<small className="forecast-low">Предварительная оценка: мало сопоставимых данных</small>}{prediction.comparableCount===0&&<small>Более длинных посещений ещё нет — оценка опирается на начальную модель.</small>}</div>;
}

export function BayesianMethod(){
 return <section className="panel forecast-method"><div className="panel-head"><div><h2>Как применяется байесовский вывод</h2><p>Неделя 06 · Probability; Bayesian Networks</p></div><Info size={20}/></div><div className="forecast-method-body"><p>Теория: правило Байеса обновляет начальное предположение после получения данных. Здесь неизвестная величина — длительность посещения T, а наблюдение — гости всё ещё сидят спустя e минут. Мы оцениваем вероятность их ухода в течение следующих h минут.</p><div className="forecast-formula">P(T ≤ e+h | T &gt; e) = 1 − S(e+h) / S(e)</div><p>Практика: S(t) — вероятность посещения дольше t. Начальная модель — экспоненциальное распределение со средним по залу и весом двух условных посещений. Завершённые посещения обновляют распределение длительности по модели Дирихле. При трёх посещениях стола используется его история, иначе — история зала. Это эмпирический Байес: начальное среднее также оценивается из данных.</p><p>Результат: вероятности ухода за 5, 10 и 15 минут пересчитываются по мере изменения времени и истории. При менее 10 посещениях или менее трёх сопоставимых более длинных посещениях оценка помечается предварительной. Без истории проценты не показываются. Это байесовский вывод; отдельная байесовская сеть в проекте не строится. Готовность после уборки оценивается отдельно.</p></div></section>;
}

export function ForecastDetails({table,state,now}:{table:Table;state:AppState;now:number}){
 const forecast=forecastTable(table,state.visits,now);
 if(!forecast)return null;
 if(forecast.kind==='insufficient')return <div className="forecast-detail"><span>Прогноз ухода</span><strong>Пока недостаточно данных</strong><small>Нужно хотя бы одно завершённое посещение</small></div>;
 return <div className="forecast-detail"><span>Примерный уход гостей</span><strong>{forecast.kind==='overdue'?'Дольше среднего':`Около ${formatForecastTime(forecast.expectedAt,now)}`}</strong><small>{forecast.kind==='estimate'?`Осталось примерно ${formatForecastDuration(forecast.remainingMs)} · `:''}Среднее {formatForecastDuration(forecast.averageMs)} · по {sampleLabel(forecast.sampleCount)} {forecast.basis==='table'?'этого стола':'по залу'}</small>{forecast.sampleCount<3&&<small className="forecast-low">Мало данных — прогноз предварительный</small>}<BayesianProbabilities table={table} state={state} now={now}/></div>;
}

export default function TableForecastPage({state,tables,now}:{state:AppState;tables:Table[];now:number}){
 const occupied=tables.filter(t=>t.status==='occupied').map(table=>({table,forecast:forecastTable(table,state.visits,now)}));
 occupied.sort((a,b)=>{
  const rank=(item:typeof a)=>item.forecast?.kind==='estimate'?0:item.forecast?.kind==='overdue'?1:2;
  return rank(a)-rank(b)||(a.forecast?.kind==='estimate'&&b.forecast?.kind==='estimate'?a.forecast.expectedAt-b.forecast.expectedAt:0)||a.table.id-b.table.id;
 });
 return <section className="panel forecast-panel" aria-label="Прогноз ухода гостей">
  <div className="panel-head"><div><h2>Когда гости могут уйти</h2><p>Оценка по завершённым посещениям текущей смены</p></div><span className="pill neutral">{occupied.length} занято</span></div>
  {occupied.length?<div className="forecast-list">{occupied.map(({table,forecast})=><article className="forecast-row" key={table.id}>
   <div className="forecast-table"><span className="table-mini">{String(table.id).padStart(2,'0')}</span><div><strong>Стол {String(table.id).padStart(2,'0')}</strong><small><Users size={13}/> {table.guests} · За столом {elapsed(table.since,now)}</small></div></div>
   <div className="forecast-result">{!forecast?<><strong>Нет прогноза</strong><small>Проверьте время посадки</small></>:forecast.kind==='insufficient'?<><strong>Недостаточно данных</strong><small>Нужно хотя бы одно завершённое посещение</small></>:<><strong>{forecast.kind==='overdue'?'Дольше среднего':`Около ${formatForecastTime(forecast.expectedAt,now)}`}</strong><small>{forecast.kind==='estimate'?`Примерно через ${formatForecastDuration(forecast.remainingMs)} · `:''}среднее {formatForecastDuration(forecast.averageMs)}</small><small>По {sampleLabel(forecast.sampleCount)} {forecast.basis==='table'?'этого стола':'всего зала'}</small>{forecast.sampleCount<3&&<small className="forecast-low">Мало данных — прогноз предварительный</small>}</>}</div>
   <Clock3 size={19} className="forecast-icon"/>
   <BayesianProbabilities table={table} state={state} now={now}/>
  </article>)}</div>:<div className="forecast-empty"><Clock3 size={24}/><strong>Сейчас нет занятых столов</strong><p>Прогноз появится, когда за стол сядут гости.</p></div>}
  <div className="forecast-explainer"><Info size={17}/><span>Это приблизительное время ухода гостей по среднему, а не гарантия. После ухода столу может понадобиться уборка. Демо-режим использует учебные посещения; новая смена начинает историю заново.</span></div>
 </section>;
}

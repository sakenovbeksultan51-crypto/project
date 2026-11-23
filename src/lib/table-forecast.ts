import type {Table,Visit} from './engine';

export const MIN_FORECAST_VISITS=1;
export const PREFERRED_TABLE_VISITS=3;
export const BAYES_PRIOR_WEIGHT=2;
export type BayesianForecast={sampleCount:number;basis:'table'|'hall';comparableCount:number;elapsedMs:number;preliminary:boolean;windows:{minutes:number;probability:number}[]};

/** Empirical Bayes: a Dirichlet-process duration distribution with an exponential
 * base measure (two prior observations). Condition on the guests still being
 * present: P(T <= e+h | T > e) = 1 - S(e+h)/S(e).
 * The base mean is estimated from the hall; observed durations update its mass.
 * This models departure, not completion of cleaning. */
export function bayesianForecast(table:Table,visits:Visit[],now:number):BayesianForecast|null{
 if(table.status!=='occupied'||!Number.isFinite(now)||!Number.isFinite(table.since)||table.since>now)return null;
 const completed=visits.filter(v=>Number.isFinite(v.start)&&Number.isFinite(v.end)&&v.end>v.start&&v.end<=now&&Number.isFinite(v.end-v.start));
 if(!completed.length)return null;
 const own=completed.filter(v=>v.tableId===table.id),basis=own.length>=PREFERRED_TABLE_VISITS?'table':'hall';
 const durations=(basis==='table'?own:completed).map(v=>v.end-v.start);
 const mean=completed.reduce((sum,v)=>sum+(v.end-v.start)/completed.length,0);
 if(!Number.isFinite(mean)||mean<=0)return null;
 const elapsedMs=now-table.since;
 const comparable=durations.filter(d=>d>elapsedMs),comparableCount=comparable.length;
 // Scale the survival ratio relative to e to avoid exponential underflow for long stays.
 const priorSurvival=BAYES_PRIOR_WEIGHT*Math.exp(-elapsedMs/mean);
 const windows=[5,10,15].map(minutes=>{
  const horizon=minutes*60000;
  const departing=comparable.filter(d=>d<=elapsedMs+horizon).length;
  const baseProbability=-Math.expm1(-horizon/mean);
  const probability=comparableCount?(departing+priorSurvival*baseProbability)/(comparableCount+priorSurvival):baseProbability;
  return {minutes,probability:Math.max(0,Math.min(1,probability))};
 });
 return {sampleCount:durations.length,basis,comparableCount,elapsedMs,preliminary:durations.length<10||comparableCount<3,windows};
}
export type TableForecast=
 |{kind:'insufficient';sampleCount:number;required:number}
 |{kind:'estimate';averageMs:number;sampleCount:number;basis:'table'|'hall';expectedAt:number;remainingMs:number}
 |{kind:'overdue';averageMs:number;sampleCount:number;basis:'table'|'hall';expectedAt:number};

/** Estimate guest departure from completed visits in the current mode and shift.
 * Cleaning happens afterwards and is intentionally excluded from the estimate. */
export function forecastTable(table:Table,visits:Visit[],now:number):TableForecast|null{
 if(table.status!=='occupied'||!Number.isFinite(now)||!Number.isFinite(table.since)||table.since>now)return null;
 const completed=visits.filter(v=>Number.isFinite(v.start)&&Number.isFinite(v.end)&&v.end>v.start&&v.end<=now);
 const tableVisits=completed.filter(v=>v.tableId===table.id);
 const basis=tableVisits.length>=PREFERRED_TABLE_VISITS?'table':'hall';
 const sample=basis==='table'?tableVisits:completed;
 if(sample.length<MIN_FORECAST_VISITS)return {kind:'insufficient',sampleCount:sample.length,required:MIN_FORECAST_VISITS-sample.length};
 const averageMs=sample.reduce((sum,v)=>sum+v.end-v.start,0)/sample.length;
 const expectedAt=table.since+averageMs;
 if(!Number.isFinite(averageMs)||!Number.isFinite(expectedAt)||Math.abs(expectedAt)>8640000000000000)return null;
 if(expectedAt<=now)return {kind:'overdue',averageMs,sampleCount:sample.length,basis,expectedAt};
 return {kind:'estimate',averageMs,sampleCount:sample.length,basis,expectedAt,remainingMs:expectedAt-now};
}

export function formatForecastDuration(ms:number):string{
 const seconds=Math.max(1,Math.ceil(ms/1000));
 if(seconds<60)return `${seconds} сек`;
 if(seconds<300){const minutes=Math.floor(seconds/60),rest=seconds%60;return rest?`${minutes} мин ${rest} сек`:`${minutes} мин`;}
 const minutes=Math.round(seconds/60);
 if(minutes<60)return `${minutes} мин`;
 const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`${hours} ч ${rest} мин`:`${hours} ч`;
}

/** Include the date when the estimate falls on a different local day. */
export function formatForecastTime(timestamp:number,now:number):string{
 const zone='Asia/Qyzylorda';
 const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
 const sameDay=dateFormatter.format(timestamp)===dateFormatter.format(now);
 return new Intl.DateTimeFormat('ru-RU',{timeZone:zone,...(sameDay?{}:{day:'numeric',month:'short'}),hour:'2-digit',minute:'2-digit'}).format(timestamp);
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {changeStatus,initialState,resetShift} from '../src/lib/engine';
import type {Visit} from '../src/lib/engine';
import {forecastTable,formatForecastDuration,formatForecastTime} from '../src/lib/table-forecast';
import TableForecastPage,{ForecastDetails} from '../src/components/TableForecast';

const minute=60000,now=Date.UTC(2026,10,11,12);
const visit=(tableId:number,duration:number,offset=minute):Visit=>({tableId,start:now-offset-duration,end:now-offset,guests:2,source:'manual'});
function occupied(since=now-15*minute){return {...initialState('live',now).tables[0],status:'occupied' as const,since,guests:2};}

test('uses the same table average when at least three valid visits exist',()=>{
 const table=occupied();const records=[visit(1,20*minute),visit(1,40*minute),visit(1,60*minute),visit(2,180*minute)];
 const prediction=forecastTable(table,records,now);assert.equal(prediction?.kind,'estimate');
 if(prediction?.kind==='estimate'){
  assert.equal(prediction.basis,'table');assert.equal(prediction.sampleCount,3);assert.equal(prediction.averageMs,40*minute);
  assert.equal(prediction.expectedAt,now+25*minute);assert.equal(prediction.remainingMs,25*minute);
 }
});

test('uses the hall average when the table has too few visits and starts with one completed visit',()=>{
 const table=occupied(now-5*minute),records=[visit(1,10*minute),visit(1,20*minute),visit(2,60*minute)];
 const prediction=forecastTable(table,records,now);assert.equal(prediction?.kind,'estimate');
 if(prediction?.kind==='estimate'){assert.equal(prediction.basis,'hall');assert.equal(prediction.sampleCount,3);assert.equal(prediction.averageMs,30*minute);assert.equal(prediction.remainingMs,25*minute);}
 const preliminary=forecastTable(table,records.slice(0,2),now);assert.equal(preliminary?.kind,'estimate');
 if(preliminary?.kind==='estimate'){assert.equal(preliminary.sampleCount,2);assert.equal(preliminary.remainingMs,10*minute);}
 assert.deepEqual(forecastTable(table,[],now),{kind:'insufficient',sampleCount:0,required:1});
});

test('ignores future, zero-length and invalid visits; never predicts free or future-start tables',()=>{
 const table=occupied(),bad=[visit(1,0),visit(2,-minute),{...visit(1,minute),end:now+1},{...visit(1,minute),start:NaN}];
 assert.deepEqual(forecastTable(table,bad,now),{kind:'insufficient',sampleCount:0,required:1});
 assert.equal(forecastTable({...table,status:'dirty'},[visit(1,minute),visit(1,minute),visit(1,minute)],now),null);
 assert.equal(forecastTable({...table,since:now+1},[],now),null);
});

test('shows overdue rather than suggesting a table is free; handles short visits and midnight',()=>{
 const records=[visit(1,30*minute),visit(1,30*minute),visit(1,30*minute)];
 assert.equal(forecastTable(occupied(now-30*minute),records,now)?.kind,'overdue');
 assert.equal(forecastTable(occupied(now-60*minute),records,now)?.kind,'overdue');
 assert.equal(formatForecastDuration(32000),'32 сек');assert.equal(formatForecastDuration(125000),'2 мин 5 сек');assert.equal(formatForecastDuration(90*minute),'1 ч 30 мин');
 const late=Date.UTC(2026,10,11,18,59),next=late+2*minute;assert.match(formatForecastTime(next,late),/12/);assert.match(formatForecastTime(next,late),/00:01/);
});

test('forecast display uses recorded visits, marks insufficient data and resets with a new shift',()=>{
 let state=initialState('live',now-100*minute);state=changeStatus(state,1,'occupied',now-15*minute,'manual',2);
 let html=renderToStaticMarkup(<TableForecastPage state={state} tables={state.tables} now={now}/>);
 assert.match(html,/Недостаточно данных/);assert.match(html,/хотя бы одно завершённое посещение/);
 state.visits=[visit(1,20*minute)];html=renderToStaticMarkup(<TableForecastPage state={state} tables={state.tables} now={now}/>);
 assert.match(html,/Мало данных — прогноз предварительный/);assert.match(html,/Примерно через 5 мин/);
 state.visits=[visit(1,20*minute),visit(1,40*minute),visit(1,60*minute)];
 html=renderToStaticMarkup(<TableForecastPage state={state} tables={state.tables} now={now}/>);
 assert.match(html,/Примерно через 25 мин/);assert.match(html,/этого стола/);assert.match(html,/уборка/);
 assert.match(renderToStaticMarkup(<ForecastDetails table={state.tables[0]} state={state} now={now}/>),/40 мин/);
 const reset=resetShift(state,now);assert.equal(reset.visits.length,0);
 assert.match(renderToStaticMarkup(<TableForecastPage state={reset} tables={reset.tables} now={now}/>),/Сейчас нет занятых столов/);
});

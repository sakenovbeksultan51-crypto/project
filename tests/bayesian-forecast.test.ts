import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,type Visit} from '../src/lib/engine';
import {BAYES_PRIOR_WEIGHT,bayesianForecast} from '../src/lib/table-forecast';
const now=Date.UTC(2026,10,11,12),minute=60000;
const table={...initialState('live',now).tables[0],status:'occupied' as const,since:now-10*minute};
const visit=(tableId:number,duration:number):Visit=>({tableId,start:now-(duration+5)*minute,end:now-5*minute,guests:2,source:'manual'});

test('Bayesian departure probability conditions on elapsed time and matches posterior survival',()=>{
 const visits=[visit(1,12),visit(1,20),visit(1,40)],forecast=bayesianForecast(table,visits,now)!;
 const mean=24*minute,e=10*minute,h=5*minute;
 const expected=(1+BAYES_PRIOR_WEIGHT*Math.exp(-e/mean)*(1-Math.exp(-h/mean)))/(3+BAYES_PRIOR_WEIGHT*Math.exp(-e/mean));
 assert.equal(forecast.basis,'table');assert.equal(forecast.sampleCount,3);assert.equal(forecast.comparableCount,3);
 assert.ok(Math.abs(forecast.windows[0].probability-expected)<1e-12);
 const later=bayesianForecast({...table,since:now-16*minute},visits,now)!;
 assert.equal(later.comparableCount,2);assert.notEqual(later.windows[0].probability,forecast.windows[0].probability);
});

test('probabilities increase with horizon, fall within bounds, and remain finite after all observed durations',()=>{
 for(const elapsed of [0,10,20,40,4000000]){
  const forecast=bayesianForecast({...table,since:now-elapsed*minute},[visit(1,12),visit(1,20),visit(1,40)],now)!;
  let previous=0;for(const w of forecast.windows){assert.ok(Number.isFinite(w.probability));assert.ok(w.probability>=previous&&w.probability<=1);previous=w.probability;}
  if(elapsed>=40){assert.equal(forecast.comparableCount,0);assert.equal(forecast.preliminary,true);}
 }
});

test('uses hall history until three own visits, rejects missing and invalid data',()=>{
 assert.equal(bayesianForecast(table,[],now),null);
 assert.equal(bayesianForecast({...table,status:'free'},[visit(1,20)],now),null);
 assert.equal(bayesianForecast({...table,since:now+1},[visit(1,20)],now),null);
 assert.equal(bayesianForecast(table,[{...visit(1,20),end:now+1},visit(1,0),{...visit(1,20),start:NaN}],now),null);
 const forecast=bayesianForecast(table,[visit(1,12),visit(2,20)],now)!;
 assert.equal(forecast.basis,'hall');assert.equal(forecast.sampleCount,2);assert.equal(forecast.preliminary,true);
 const own=Array.from({length:10},(_,i)=>visit(1,25+i));
 assert.equal(bayesianForecast(table,own,now)!.preliminary,false);
});

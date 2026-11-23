import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const schema=`CREATE TABLE IF NOT EXISTS workspaces (
 key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL,
 revision INTEGER DEFAULT 1 NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS desktop_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

export function openLocalStorage(root:string,databaseFile=resolve(root,'.data/tableflow-local.sqlite')){
 mkdirSync(dirname(databaseFile),{recursive:true});
 const sqlite=new DatabaseSync(databaseFile);
 try{
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  sqlite.exec(schema);
  if(!sqlite.prepare("SELECT value FROM desktop_meta WHERE key='legacy_import'").get()){
   const legacyDir=resolve(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
   const records:{key:string;payload:string;revision:number;updated_at:number}[]=[];
   if(existsSync(legacyDir))for(const name of readdirSync(legacyDir).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite')){
    const previous=new DatabaseSync(resolve(legacyDir,name),{readOnly:true});
    try{if(previous.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'").get())records.push(...previous.prepare('SELECT key,payload,revision,updated_at FROM workspaces').all() as typeof records);}
    finally{previous.close();}
   }
   sqlite.exec('BEGIN IMMEDIATE');
   try{
    const insert=sqlite.prepare('INSERT INTO workspaces (key,payload,revision,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO NOTHING');
    for(const row of records)insert.run(row.key,row.payload,row.revision,row.updated_at);
    sqlite.prepare("INSERT INTO desktop_meta (key,value) VALUES ('legacy_import',?)").run(String(Date.now()));
    sqlite.exec('COMMIT');
   }catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 }catch(error){sqlite.close();throw error;}
 // Existing API handlers use this small D1 interface. SQL and conflict checks
 // stay the same; the desktop runtime executes them directly in local SQLite.
 const binding={prepare(query:string){
  const statement=sqlite.prepare(query);let args:SQLInputValue[]=[];
  const prepared={bind(...values:SQLInputValue[]){args=values;return prepared;},async first(){return statement.get(...args)||null;},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};
  return prepared;
 }} as unknown as Pick<D1Database,'prepare'>;
 return {binding,path:databaseFile,healthy:()=>{sqlite.prepare('SELECT key FROM workspaces LIMIT 1').get();return true;},close:()=>sqlite.close()};
}

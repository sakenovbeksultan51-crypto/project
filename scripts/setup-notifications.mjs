// Run after `vercel env pull .env.production.local --environment production`.
// Secrets stay in ignored files/environment and are never printed.
import {Client} from '@upstash/qstash';
import {readFileSync} from 'node:fs';
process.loadEnvFile('.env.production.local');
const local=JSON.parse(readFileSync('.vercel/notification-secrets.json','utf8'));
const base='https://app-delta-nine-69.vercel.app';
if(!process.env.QSTASH_TOKEN)throw new Error('QStash is not connected to this project.');
const client=new Client({token:process.env.QSTASH_TOKEN,baseUrl:process.env.QSTASH_URL});
const schedule=await client.schedules.create({destination:`${base}/api/notifications/dispatch`,scheduleId:'tableflow-service-alerts',cron:'*/2 * * * *',retries:1,headers:{Authorization:`Bearer ${local.cron}`}});
console.log(JSON.stringify({scheduleId:schedule.scheduleId,intervalMinutes:2,freePlan:true}));

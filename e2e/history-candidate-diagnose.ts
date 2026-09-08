import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const state='/home/neal/code/jarvis-command-candidate-state';
const auth=JSON.parse(await readFile(state+'/bff/browser-auth.json','utf8'));
const probe=JSON.parse(await readFile(state+'/probe.json','utf8'));
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({extraHTTPHeaders:{'cf-access-jwt-assertion':auth.assertion}});
 const page=await context.newPage();
 const events:unknown[]=[];
 page.on('request',r=>{if(r.url().includes('/api/')&&!r.url().includes('/assets/'))events.push({request:r.url(),method:r.method()});});
 page.on('requestfailed',r=>events.push({failed:r.url(),error:r.failure()}));
 page.on('response',async r=>{if(r.url().includes('/messages'))events.push({response:r.url(),status:r.status(),body:await r.text().catch(String)});});
 page.on('pageerror',e=>events.push({error:e.message}));
 await page.goto(auth.origin+'/api/preview/chat-first/');
 await page.getByRole('navigation',{name:'Recent chats',exact:true}).getByRole('button',{name:probe.session.title,exact:true}).click();
 await page.waitForTimeout(5000);
 console.log(JSON.stringify({events,body:await page.locator('body').innerText()},null,2));
 await writeFile(state+'/history-http-diagnostic.json',JSON.stringify(events,null,2));
} finally {await browser.close();}

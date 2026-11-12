import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { answer, createAction, AI_DATE } from '../ai-fixtures';
const OPENAI_KEY='sk-proj-test-only-not-a-real-openai-key';
const GEMINI_KEY='AIza-test-only-not-a-real-google-api-key';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
async function switchProvider(page:Page,provider:'openai'|'gemini'|'openrouter'){
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('combobox',{name:'AI provider',exact:true}).selectOption(provider);
 await expect(page.getByLabel(`${provider==='openai'?'OpenAI':provider==='gemini'?'Gemini':'OpenRouter'} API key`,{exact:true})).toBeVisible();
}
async function saveProvider(page:Page,provider:'openai'|'gemini',key:string,model:string){
 await switchProvider(page,provider);await page.getByLabel(`${provider==='openai'?'OpenAI':'Gemini'} API key`,{exact:true}).fill(key);
 await page.getByRole('button',{name:'Refresh models',exact:true}).click();await page.getByRole('combobox',{name:'Discovered model',exact:true}).selectOption(model);
 await page.getByLabel(`Allow sending my chat requests and selected workday context to ${provider==='openai'?'OpenAI':'Gemini'}.`,{exact:true}).check();await page.getByRole('button',{name:'Save AI settings',exact:true}).click();
 await expect(page.getByLabel(`${provider==='openai'?'OpenAI':'Gemini'} API key`,{exact:true})).toHaveValue('');await expect(page.getByText('A key is saved on this device.',{exact:true})).toBeVisible();
}
async function send(page:Page,text:string){await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.getByLabel('Message to AI',{exact:true}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();}
async function routes(page:Page){
 const requests:{openai:number;gemini:number;googleContexts:string[]}={openai:0,gemini:0,googleContexts:[]};
 const handler=async(route:Route)=>{
  const request=route.request();if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const openai=request.url().startsWith('https://api.openai.com/');
  expect(request.headers()[openai?'authorization':'x-goog-api-key']).toBe(openai?`Bearer ${OPENAI_KEY}`:GEMINI_KEY);expect(request.url()).not.toContain(GEMINI_KEY);
  if(request.method()==='GET'){
   await route.fulfill({headers,json:openai?{data:[{id:'gpt-test'},{id:'text-embedding-test'}]}:{models:[{name:'models/gemini-test',displayName:'Gemini Test',supportedGenerationMethods:['generateContent']}]}});return;
  }
  const body=request.postDataJSON();for(const key of [OPENAI_KEY,GEMINI_KEY])expect(JSON.stringify(body)).not.toContain(key);
  const response=answer(createAction({clientId:openai?'openai_task':'gemini_task',title:openai?'OpenAI proposed task':'Gemini proposed task',scheduledDate:AI_DATE}));
  if(openai){requests.openai++;expect(body.store).toBe(false);expect(body.text.format.type).toBe('json_schema');await route.fulfill({headers,json:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(response)}]}]}});}
  else{requests.gemini++;requests.googleContexts.push(JSON.stringify(body));expect(body.generationConfig.responseMimeType).toBe('application/json');expect(request.url()).toContain('/models/gemini-test:generateContent');await route.fulfill({headers,json:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]}});}
 };
 await page.route('https://api.openai.com/v1/**',handler);await page.route('https://generativelanguage.googleapis.com/v1beta/**',handler);return requests;
}
test('OpenAI and Gemini retain independent credentials/history and approve through the same scheduler',async({page})=>{
 await page.clock.install({time:new Date(`${AI_DATE}T08:00:00Z`)});const requests=await routes(page);await page.goto('/');
 await saveProvider(page,'openai',OPENAI_KEY,'gpt-test');await expect(page.getByLabel('Show free models only',{exact:true})).toHaveCount(0);
 await send(page,'OPENAI ONLY CHAT: add my first task.');await expect(page.getByRole('heading',{name:'Review proposed changes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.locator('.task')).toHaveCount(0);await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();
 await saveProvider(page,'gemini',GEMINI_KEY,'gemini-test');await page.getByRole('button',{name:'AI Chat',exact:true}).click();await expect(page.getByText('OPENAI ONLY CHAT: add my first task.',{exact:true})).toHaveCount(0);
 await send(page,'Add another task with Gemini.');await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();expect(requests.googleContexts[0]).not.toContain('OPENAI ONLY CHAT');
 await page.reload();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();await expect(page.getByText(/Gemini · Model: gemini-test/)).toBeVisible();
 await page.setViewportSize({width:320,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await switchProvider(page,'openai');await expect(page.getByLabel('OpenAI API key',{exact:true})).toHaveValue('');await expect(page.getByLabel('Model ID',{exact:true})).toHaveValue('gpt-test');await expect(page.getByText('A key is saved on this device.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'AI Chat',exact:true}).click();await expect(page.getByText('OPENAI ONLY CHAT: add my first task.',{exact:true})).toBeVisible();await expect(page.getByText('Add another task with Gemini.',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.locator('.task')).toHaveCount(2);
 await switchProvider(page,'gemini');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export local data',exact:true}).click();const download=await downloadPromise,path=await download.path(),exported=await readFile(path!,'utf8');for(const key of [OPENAI_KEY,GEMINI_KEY])expect(exported).not.toContain(key);expect(JSON.parse(exported).tasks).toHaveLength(2);
 await page.screenshot({path:'test-results/gemini-settings.png',fullPage:true});await page.getByRole('button',{name:'Forget key',exact:true}).click();await expect(page.getByText('No API key saved.',{exact:true})).toBeVisible();await switchProvider(page,'openai');await expect(page.getByText('A key is saved on this device.',{exact:true})).toBeVisible();expect(requests.openai).toBe(1);expect(requests.gemini).toBe(1);
});
test('switching providers cancels a pending request and preserves the dashboard AI draft shortcut',async({page})=>{
 await routes(page);await page.goto('/');await saveProvider(page,'openai',OPENAI_KEY,'gpt-test');
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await page.getByRole('button',{name:'Ask AI to adjust my day',exact:true}).click();await expect(page.getByLabel('Message to AI',{exact:true})).toHaveValue('Help me adjust my remaining schedule for today.');
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('https://api.openai.com/v1/responses',async route=>{if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}await held;try{await route.fulfill({headers,json:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(answer(createAction({title:'Must not be applied'})))}]}]}});}catch{ /* Aborted request no longer has a receiver. */ }});
 await page.getByLabel('Message to AI',{exact:true}).fill('Hold this request.');const sent=page.waitForRequest(request=>request.url()==='https://api.openai.com/v1/responses'&&request.method()==='POST');await page.getByRole('button',{name:'Send',exact:true}).click();await sent;await expect(page.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();
 await switchProvider(page,'gemini');release();await page.getByRole('button',{name:'AI Chat',exact:true}).click();await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await expect(page.getByText('Hold this request.',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.locator('.task')).toHaveCount(0);
 await switchProvider(page,'openai');await page.getByRole('button',{name:'AI Chat',exact:true}).click();await expect(page.getByRole('button',{name:'Retry request',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Approve changes',exact:true})).toHaveCount(0);
});

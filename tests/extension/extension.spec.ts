import { test,expect,chromium } from '@playwright/test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
test('built extension starts its worker, restores alarms and retains focus after reopening the panel',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'workday-extension-'));
 const extensionPath=resolve('dist');
 let context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
 try{
  let worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await expect.poll(()=>worker.evaluate(async()=>!!(await chrome.alarms.get('workday-maintenance')))).toBe(true);
  expect(await worker.evaluate(async()=>await chrome.permissions.contains({permissions:['sidePanel','alarms','notifications']}))).toBe(true);
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task title').fill('Real extension focus');await page.getByRole('button',{name:'Save task',exact:true}).click();
  await page.getByRole('button',{name:'Start focus: Real extension focus',exact:true}).click();
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.alarms.getAll()).filter(a=>a.name.startsWith('wd:focus:')).length)).toBeGreaterThan(0);
  await page.close();
  const reopened=await context.newPage();await reopened.goto(`chrome-extension://${id}/index.html`);
  await expect(reopened.getByRole('region',{name:'Focus timer'})).toContainText('Real extension focus');
  await expect(reopened.getByRole('region',{name:'Focus timer'})).toContainText('Focusing now');
  // Simulate browser-cleared alarms, then exercise the worker's persisted-data reconstruction.
  await worker.evaluate(async()=>{for(const a of await chrome.alarms.getAll())if(a.name.startsWith('wd:'))await chrome.alarms.clear(a.name);});
  await reopened.evaluate(async()=>await chrome.runtime.sendMessage({type:'WORKDAY_CHANGED'}));
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.alarms.getAll()).filter(a=>a.name.startsWith('wd:focus:')).length)).toBeGreaterThan(0);
  await context.close();
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const restored=await context.newPage();await restored.goto(`chrome-extension://${id}/index.html`);
  await expect(restored.getByRole('region',{name:'Focus timer'})).toContainText('Focusing now');
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.alarms.getAll()).filter(a=>a.name.startsWith('wd:focus:')).length)).toBeGreaterThan(0);
  await restored.getByRole('region',{name:'Focus timer'}).getByRole('button',{name:'Pause',exact:true}).click();
  await expect.poll(()=>worker.evaluate(async()=>(await chrome.alarms.getAll()).filter(a=>a.name.startsWith('wd:focus:')).length)).toBe(0);
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});
test('packaged side panel can reach only the configured AI host and applies validated proposals',async()=>{
 const profile=await mkdtemp(join(tmpdir(),'workday-ai-extension-')),extensionPath=resolve('dist');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
 const key='sk-or-v1-test-extension-only-not-a-real-credential';
 try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  expect(await worker.evaluate(async()=>await chrome.permissions.contains({origins:['https://openrouter.ai/*']}))).toBe(true);
  const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());expect(typeof manifest.content_security_policy==='object'?manifest.content_security_policy.extension_pages:manifest.content_security_policy).toContain("connect-src 'self' https://openrouter.ai");
  await context.route('https://openrouter.ai/api/v1/**',async route=>{
   if(route.request().url().endsWith('/models'))await route.fulfill({json:{data:[{id:'test/extension',name:'Extension test model',pricing:{prompt:'0',completion:'0'},supported_parameters:[]}]}});
   else{const body=route.request().postDataJSON();expect(body.response_format).toBeUndefined();expect(JSON.stringify(body.messages)).not.toContain(key);await route.fulfill({json:{choices:[{message:{content:JSON.stringify({reply:'Review this proposed task before applying it.',actions:[{type:'create_task',clientId:'review',title:'Packaged AI task',description:'',category:'review',priority:'high',estimatedMinutes:30,scheduledDate:null,deadline:null,dependencyIds:[]}]})},finish_reason:'stop'}]}});}
  });
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('OpenRouter API key',{exact:true}).fill(key);await page.getByRole('button',{name:'Refresh models',exact:true}).click();await page.getByRole('combobox',{name:'Discovered model',exact:true}).selectOption('test/extension');await page.getByLabel('Allow sending my chat requests and selected workday context to OpenRouter and the selected model provider.').check();await page.getByRole('button',{name:'Save AI settings',exact:true}).click();await expect(page.getByLabel('OpenRouter API key',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.getByLabel('Message to AI',{exact:true}).fill('Add a task to review the API.');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.getByRole('heading',{name:'Packaged AI task',exact:true})).toBeVisible();expect(await page.locator('body').innerText()).not.toContain(key);
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});
for(const provider of [
 {id:'openai',label:'OpenAI',key:'sk-proj-extension-test-only-not-a-real-key',model:'gpt-test',origin:'https://api.openai.com'},
 {id:'gemini',label:'Gemini',key:'AIza-extension-test-only-not-a-real-key',model:'gemini-test',origin:'https://generativelanguage.googleapis.com'},
] as const){
 test(`packaged ${provider.label} discovery and task approval use the provider's own host and key`,async()=>{
  const profile=await mkdtemp(join(tmpdir(),`workday-${provider.id}-`)),extensionPath=resolve('dist');
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  try{
   const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
   expect(await worker.evaluate(async origin=>await chrome.permissions.contains({origins:[`${origin}/*`]}),provider.origin)).toBe(true);
   let completions=0;
   await context.route(`${provider.origin}/**`,async route=>{
    const request=route.request();expect(request.headers()[provider.id==='openai'?'authorization':'x-goog-api-key']).toBe(provider.id==='openai'?`Bearer ${provider.key}`:provider.key);expect(request.url()).not.toContain(provider.key);
    if(request.method()==='GET'){await route.fulfill({json:provider.id==='openai'?{data:[{id:provider.model}]}:{models:[{name:`models/${provider.model}`,supportedGenerationMethods:['generateContent']}]}});return;}
    completions++;const body=request.postDataJSON();expect(JSON.stringify(body)).not.toContain(provider.key);
    const response=JSON.stringify({reply:'Review the task before applying it.',actions:[{type:'create_task',clientId:'task',title:`${provider.label} extension task`,description:'',category:'review',priority:'high',estimatedMinutes:30,scheduledDate:null,deadline:null,dependencyIds:[]}]});
    if(provider.id==='openai'){expect(request.url()).toBe(`${provider.origin}/v1/responses`);expect(body.store).toBe(false);await route.fulfill({json:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:response}]}]}});}
    else{expect(body.generationConfig.responseMimeType).toBe('application/json');await route.fulfill({json:{candidates:[{finishReason:'STOP',content:{parts:[{text:response}]}}]}});}
   });
   const page=await context.newPage();await page.goto(`chrome-extension://${id}/index.html`);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('combobox',{name:'AI provider',exact:true}).selectOption(provider.id);await page.getByLabel(`${provider.label} API key`,{exact:true}).fill(provider.key);await page.getByRole('button',{name:'Refresh models',exact:true}).click();await page.getByRole('combobox',{name:'Discovered model',exact:true}).selectOption(provider.model);await page.getByLabel(`Allow sending my chat requests and selected workday context to ${provider.label}.`,{exact:true}).check();await page.getByRole('button',{name:'Save AI settings',exact:true}).click();await expect(page.getByLabel(`${provider.label} API key`,{exact:true})).toHaveValue('');
   await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.getByLabel('Message to AI',{exact:true}).fill('Add a review task.');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.getByRole('heading',{name:`${provider.label} extension task`,exact:true})).toBeVisible();expect(completions).toBe(1);
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
 });
}

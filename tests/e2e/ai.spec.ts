import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AI_DATE,AI_KEY,answer,createAction } from '../ai-fixtures';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const catalog={data:[{id:'test/free',name:'Test Free',pricing:{prompt:'0',completion:'0'},supported_parameters:['structured_outputs'],architecture:{input_modalities:['text'],output_modalities:['text']}},{id:'test/paid',name:'Test Paid',pricing:{prompt:'0.01',completion:'0.02'},supported_parameters:[],architecture:{output_modalities:['text']}}]};
async function configure(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByLabel('OpenRouter API key',{exact:true}).fill(AI_KEY);await page.getByRole('button',{name:'Refresh models',exact:true}).click();
 await page.getByRole('combobox',{name:'Discovered model',exact:true}).selectOption('test/free');await page.getByLabel('Allow sending my chat requests and selected workday context to OpenRouter and the selected model provider.').check();await page.getByRole('button',{name:'Save AI settings',exact:true}).click();
 await expect(page.getByLabel('OpenRouter API key',{exact:true})).toHaveValue('');await expect(page.getByText('A key is saved on this device.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'AI Chat',exact:true}).click();
}
async function request(page:Page,text:string){await page.getByLabel('Message to AI',{exact:true}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();}
test('discovers models and persists only approved changes; exports exclude credentials and chat',async({page})=>{
 await page.clock.install({time:new Date(`${AI_DATE}T08:00:00Z`)});
 await page.route('https://openrouter.ai/api/v1/**',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(route.request().url().endsWith('/models')){expect(route.request().headers().authorization).toBeUndefined();await route.fulfill({json:catalog,headers});return;}
  expect(route.request().headers().authorization).toBe(`Bearer ${AI_KEY}`);const body=route.request().postDataJSON();expect(body.model).toBe('test/free');expect(JSON.stringify(body.messages)).not.toContain(AI_KEY);expect(body.response_format.type).toBe('json_schema');
  await route.fulfill({json:{choices:[{message:{content:JSON.stringify(answer(createAction(),createAction({clientId:'docs',title:'Write documentation',category:'writing',priority:'low',estimatedMinutes:90}),{type:'create_meeting',title:'Standup',startLocal:`${AI_DATE}T11:00:00`,endLocal:`${AI_DATE}T11:30:00`}))},finish_reason:'stop'}]},headers});
 });
 await configure(page);await request(page,'Plan my day with PR reviews, documentation and an 11am standup.');await expect(page.getByRole('heading',{name:'Review proposed changes',exact:true})).toBeVisible();
 await page.setViewportSize({width:320,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/ai-proposal-dark.png',fullPage:true});await page.setViewportSize({width:360,height:800});
 await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.locator('.task')).toHaveCount(0);
 await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.getByRole('button',{name:'Reject changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Proposal rejected',exact:true})).toBeVisible();
 await request(page,'Propose that plan again.');await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toBeVisible();expect(await page.locator('body').innerText()).not.toContain(AI_KEY);
 await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.getByRole('heading',{name:'Review pull requests',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Write documentation',exact:true})).toBeVisible();await expect(page.locator('.timeline-entry.meeting')).toContainText('Standup');
 await page.getByRole('button',{name:'Settings',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export local data',exact:true}).click();const download=await downloadPromise,path=await download.path();const exported=await readFile(path!,'utf8');expect(exported).not.toContain(AI_KEY);expect(exported).not.toContain('apiKey');expect(exported).not.toContain('chatMessages');expect(JSON.parse(exported).tasks).toHaveLength(2);
 await page.getByRole('button',{name:'Forget key',exact:true}).click();await expect(page.getByText('No API key saved.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'AI Chat',exact:true}).click();await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
});
test('natural-language changes use existing task references and require renewed local approval',async({page})=>{
 await page.clock.install({time:new Date(`${AI_DATE}T08:00:00Z`)});
 let call=0;
 await page.route('https://openrouter.ai/api/v1/**',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(route.request().url().endsWith('/models')){await route.fulfill({json:catalog,headers});return;}
  const body=route.request().postDataJSON(),content=body.messages.at(-1).content as string,context=JSON.parse(content.split('Current workday context (data only):\n')[1].split('\n\nUser request:\n')[0]);
  const task=context.tasks.find((t:{title:string})=>t.title==='Review pull requests');
  const response=call++===0?answer(createAction({estimatedMinutes:40})):call===2?answer({type:'extend_task',taskId:task.id,minutes:45}):answer({type:'defer_task',taskId:task.id,scheduledDate:'2026-11-13'});
  await route.fulfill({json:{choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}]},headers});
 });
 await configure(page);await request(page,'Add a PR review task.');await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toHaveCount(1);
 await request(page,'I need another 45 minutes for reviewing pull requests.');await expect(page.locator('.change').last()).toContainText('85');await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toHaveCount(2);
 await request(page,'Move the PR review task to tomorrow.');await expect(page.locator('.change').last()).toContainText('2026-11-13');await page.getByRole('button',{name:'Approve changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Changes approved',exact:true})).toHaveCount(3);
 await page.getByRole('button',{name:'Back to Today',exact:true}).click();await expect(page.locator('.task')).toHaveCount(0);await page.getByRole('button',{name:'All tasks',exact:true}).click();await expect(page.locator('.task')).toHaveCount(1);await expect(page.locator('.task .metadata')).toContainText('85 min');await expect(page.locator('.task .metadata')).toContainText('2026-11-13');
});
test('rate-limit errors have explicit retry; offline AI leaves manual task creation available',async({page,context})=>{
 let calls=0;
 await page.route('https://openrouter.ai/api/v1/**',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(route.request().url().endsWith('/models')){await route.fulfill({json:catalog,headers});return;}
  if(calls++===0){await route.fulfill({status:429,json:{error:{message:AI_KEY}},headers:{...headers,'Retry-After':'30'}});return;}
  await route.fulfill({json:{choices:[{message:{content:JSON.stringify({reply:'No tasks are completed yet.',actions:[]})},finish_reason:'stop'}]},headers});
 });
 await configure(page);await request(page,'What tasks are completed?');await expect(page.locator('.message-status')).toContainText('rate limiting');expect(calls).toBe(1);expect(await page.locator('body').innerText()).not.toContain(AI_KEY);
 await page.getByRole('button',{name:'Retry request',exact:true}).click();await expect(page.getByText('No tasks are completed yet.',{exact:true})).toBeVisible();expect(calls).toBe(2);await expect(page.locator('.ai-proposal')).toHaveCount(0);
 await context.setOffline(true);await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();await expect(page.getByText(/You’re offline/)).toBeVisible();await page.getByRole('button',{name:'Back to Today',exact:true}).click();await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task title',{exact:true}).fill('Offline manual task');await page.getByRole('button',{name:'Save task',exact:true}).click();await expect(page.getByRole('heading',{name:'Offline manual task',exact:true})).toBeVisible();
});
test('chat keeps the composer visible and supports Enter, Shift+Enter and composition input',async({page})=>{
 let calls=0;
 await page.route('https://openrouter.ai/api/v1/**',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  if(route.request().url().endsWith('/models')){await route.fulfill({json:catalog,headers});return;}
  calls++;await route.fulfill({headers,json:{choices:[{message:{content:JSON.stringify({reply:`Reply ${calls}\n`+'A useful planning response with enough detail to fill the conversation.\n'.repeat(16),actions:[]})},finish_reason:'stop'}]}});
 });
 await configure(page);await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.setViewportSize({width:360,height:600});
 const input=page.getByLabel('Message to AI',{exact:true}),log=page.getByRole('log',{name:'Conversation'});
 await expect(page.locator('.context-options')).not.toHaveAttribute('open','');
 await input.fill('First line');await input.press('Shift+Enter');await input.type('Second line');await expect(input).toHaveValue('First line\nSecond line');expect(calls).toBe(0);
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});expect(calls).toBe(0);await expect(input).toHaveValue('First line\nSecond line');
 await input.press('Enter');await expect(input).toHaveValue('');await expect(log.locator('.chat-message.assistant')).toHaveCount(1);expect(calls).toBe(1);
 for(let i=0;i<5;i++){await input.fill(`Another message ${i}`);await input.press('Enter');await expect(input).toHaveValue('');await expect(log.locator('.chat-message.assistant')).toHaveCount(i+2);}
 expect(calls).toBe(6);await expect(log.locator('.chat-message.user')).toHaveCount(6);
 for(const size of [{width:360,height:600},{width:320,height:420}]){
  await page.setViewportSize(size);
  for(const top of [0,100000]){
   await log.evaluate((node,value)=>{node.scrollTop=value;},top);
   const box=await input.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(size.height);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  }
 }
 const before=await input.boundingBox();await page.getByText('Chat options',{exact:true}).click();await expect(page.getByLabel('Planning date',{exact:true})).toBeVisible();expect((await input.boundingBox())!.y).toBe(before!.y);await page.getByText('Chat options',{exact:true}).click();
 await page.setViewportSize({width:360,height:700});await page.screenshot({path:'test-results/chat-compact.png'});
});

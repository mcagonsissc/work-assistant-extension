import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider, parseOpenAIModels } from '../src/services/ai/openai';
import { GeminiProvider, geminiMessages, geminiModelId, parseGeminiModelPage } from '../src/services/ai/gemini';
import type { CompletionOptions } from '../src/services/ai/provider';
import { answer, createAction, model } from './ai-fixtures';
const OPENAI_KEY='sk-proj-test-only-not-a-real-openai-key';
const GEMINI_KEY='AIza-test-only-not-a-real-google-api-key';
const options:CompletionOptions={apiKey:OPENAI_KEY,model:{...model,id:'gpt-test'},messages:[{role:'system',content:'Return task JSON.'},{role:'user',content:'Add a task.'}]};
const openAIResponse=(text=JSON.stringify(answer(createAction())),status='completed')=>new Response(JSON.stringify({status,error:null,output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text}]}]}));
const geminiResponse=(text=JSON.stringify(answer(createAction())),finishReason='STOP')=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text:'Internal reasoning should not be exposed.',thought:true},{text}]}}]}));
const geminiOptions={...options,apiKey:GEMINI_KEY,model:{...model,id:'models/gemini-test'}};

describe('OpenAI Responses adapter',()=>{
 it('discovers likely text models without claiming free pricing or fixing a model ID',async()=>{
  const data={data:[{id:'gpt-test'},{id:'o9-test'},{id:'ft:gpt-test:org:custom:id'},{id:'text-embedding-test'},{id:'gpt-audio-test'},{id:'gpt-image-test'}]};
  expect(parseOpenAIModels(data).map(m=>m.id)).toEqual(['ft:gpt-test:org:custom:id','gpt-test','o9-test']);
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(data)));const adapter=new OpenAIProvider(fetcher);
  const models=await adapter.listModels(undefined,OPENAI_KEY);expect(models.every(m=>!m.free&&m.promptPrice===null)).toBe(true);
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.openai.com/v1/models');expect(init.headers).toEqual({Authorization:`Bearer ${OPENAI_KEY}`});
  await expect(adapter.listModels()).rejects.toMatchObject({code:'configuration'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('uses Responses input/text.format, disables stored responses, and parses nested text',async()=>{
  const fetcher=vi.fn(async()=>openAIResponse());const result=await new OpenAIProvider(fetcher).complete(options);expect(result.response.actions).toHaveLength(1);
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit],body=JSON.parse(String(init.body));
  expect(url).toBe('https://api.openai.com/v1/responses');expect(body.store).toBe(false);expect(body.input).toEqual(options.messages);expect(body.text.format).toMatchObject({type:'json_schema',strict:true,name:'workday_actions'});expect(body.text.format.schema.$schema).toBeUndefined();expect(body.response_format).toBeUndefined();expect(init.redirect).toBe('error');expect(init.credentials).toBe('omit');expect(body.tools).toBeUndefined();
 });
 it('retries rejected schemas in text mode with the same model and key',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:400})).mockResolvedValueOnce(openAIResponse());
  const result=await new OpenAIProvider(fetcher).complete(options);expect(result.attempts).toBe(2);const retry=JSON.parse(fetcher.mock.calls[1][1].body);expect(retry.model).toBe('gpt-test');expect(retry.text).toBeUndefined();expect(retry.store).toBe(false);
 });
 it('bounds malformed output, incomplete responses and refusals to two attempts',async()=>{
  for(const response of [()=>openAIResponse('{bad'),()=>openAIResponse('{}','incomplete'),()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:OPENAI_KEY}]}]}))]){
   const fetcher=vi.fn(async()=>response());await expect(new OpenAIProvider(fetcher).complete(options)).rejects.toMatchObject({code:'invalid_response'});expect(fetcher).toHaveBeenCalledTimes(2);
  }
 });
 it('redacts echoed OpenAI credentials before returning any structured text fields',async()=>{
  const fetcher=vi.fn(async()=>openAIResponse(JSON.stringify({reply:OPENAI_KEY,actions:[createAction({title:OPENAI_KEY})]})));
  expect(JSON.stringify(await new OpenAIProvider(fetcher).complete(options))).not.toContain(OPENAI_KEY);
 });
});
describe('Gemini generateContent adapter',()=>{
 it('normalizes resource IDs, filters non-text methods and rejects path injection',()=>{
  const page=parseGeminiModelPage({models:[{name:'models/gemini-test',displayName:'Gemini test',supportedGenerationMethods:['generateContent'],inputTokenLimit:16000},{name:'models/embed-test',supportedGenerationMethods:['embedContent']},{name:'models/gemini-image-test',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'});
  expect(page.models.map(m=>m.id)).toEqual(['gemini-test']);expect(page.models[0].free).toBe(false);expect(page.nextPageToken).toBe('next');
  expect(geminiModelId('models/gemini-test')).toBe('gemini-test');expect(()=>geminiModelId('models/../../secrets')).toThrow();
 });
 it('authenticates model discovery in a header and follows bounded pagination',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({models:[{name:'models/gemini-a',supportedGenerationMethods:['generateContent']}],nextPageToken:'page/two?x=1'}))).mockResolvedValueOnce(new Response(JSON.stringify({models:[{name:'models/gemini-b',supportedGenerationMethods:['generateContent']}]})));
  const adapter=new GeminiProvider(fetcher);expect(await adapter.listModels(undefined,GEMINI_KEY)).toHaveLength(2);
  expect(fetcher.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100');expect(fetcher.mock.calls[1][0]).toContain('pageToken=page%2Ftwo%3Fx%3D1');
  expect(fetcher.mock.calls[0][1].headers).toEqual({'x-goog-api-key':GEMINI_KEY});expect(String(fetcher.mock.calls[0][0])).not.toContain(GEMINI_KEY);await expect(adapter.listModels()).rejects.toMatchObject({code:'configuration'});
 });
 it('detects repeating page tokens instead of looping forever',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({models:[],nextPageToken:'repeat'})));
  await expect(new GeminiProvider(fetcher).listModels(undefined,GEMINI_KEY)).rejects.toThrow('pagination');expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('maps system/history roles and merges consecutive turns without leaking thought parts',async()=>{
  const messages:CompletionOptions['messages']=[{role:'system',content:'System'},{role:'user',content:'One'},{role:'assistant',content:'Answer'},{role:'user',content:'Two'},{role:'user',content:'Correction'}];
  expect(geminiMessages(messages)).toEqual({systemInstruction:{parts:[{text:'System'}]},contents:[{role:'user',parts:[{text:'One'}]},{role:'model',parts:[{text:'Answer'}]},{role:'user',parts:[{text:'Two'},{text:'Correction'}]}]});
  const fetcher=vi.fn(async()=>geminiResponse());const result=await new GeminiProvider(fetcher).complete({...geminiOptions,messages});expect(result.response.actions).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('Internal reasoning');
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit],body=JSON.parse(String(init.body));expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');expect(url).not.toContain(GEMINI_KEY);expect(init.headers).toMatchObject({'x-goog-api-key':GEMINI_KEY});expect(body.systemInstruction.parts[0].text).toBe('System');expect(body.generationConfig.responseJsonSchema.type).toBe('object');expect(body.generationConfig.responseMimeType).toBe('application/json');
 });
 it('falls back to text once for unsupported JSON schema and rejects blocked/truncated results',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:400})).mockResolvedValueOnce(geminiResponse());expect((await new GeminiProvider(fetcher).complete(geminiOptions)).attempts).toBe(2);expect(JSON.parse(fetcher.mock.calls[1][1].body).generationConfig.responseJsonSchema).toBeUndefined();
  for(const make of [()=>geminiResponse('{bad'),()=>geminiResponse('{}','MAX_TOKENS'),()=>new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}})),()=>geminiResponse('{}','SAFETY')]){const mock=vi.fn(async()=>make());await expect(new GeminiProvider(mock).complete(geminiOptions)).rejects.toMatchObject({code:'invalid_response'});expect(mock).toHaveBeenCalledTimes(2);}
 });
 it('redacts echoed Gemini credentials',async()=>{
  const fetcher=vi.fn(async()=>geminiResponse(JSON.stringify({reply:GEMINI_KEY,actions:[]})));expect(JSON.stringify(await new GeminiProvider(fetcher).complete(geminiOptions))).not.toContain(GEMINI_KEY);
 });
});
describe.each(['openai','gemini'] as const)('%s provider failures',id=>{
 const adapter=(fetcher:typeof fetch,timeout=30000)=>id==='openai'?new OpenAIProvider(fetcher,timeout):new GeminiProvider(fetcher,timeout);
 const request=id==='openai'?options:geminiOptions;
 it.each([401,403,404,429,500,503])('sanitizes HTTP %i without automatic model/provider fallback',async status=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:`${OPENAI_KEY} ${GEMINI_KEY}`}}),{status,headers:{'Retry-After':'12'}}));
  let message='';try{await adapter(fetcher).complete(request);}catch(e){message=(e as Error).message;}expect(message).toBeTruthy();expect(message).not.toContain(OPENAI_KEY);expect(message).not.toContain(GEMINI_KEY);if(status===429)expect(message).toContain('12 seconds');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('handles timeout, explicit cancellation, network failure and oversized responses',async()=>{
  const hung:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('Aborted')));});
  await expect(adapter(hung,5).complete(request)).rejects.toMatchObject({code:'timeout'});
  const controller=new AbortController(),pending=adapter(hung).complete({...request,signal:controller.signal});controller.abort();await expect(pending).rejects.toMatchObject({code:'cancelled'});
  await expect(adapter(async()=>{throw new Error(OPENAI_KEY);}).complete(request)).rejects.toMatchObject({code:'network'});
  await expect(adapter(async()=>new Response('x'.repeat(300000))).complete(request)).rejects.toMatchObject({code:'invalid_response'});
 });
});
it.each(['openai','gemini'] as const)('%s does not retry quota errors embedded in successful HTTP responses',async id=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:id==='openai'?'insufficient_quota':429,message:OPENAI_KEY}})));
 const adapter=id==='openai'?new OpenAIProvider(fetcher):new GeminiProvider(fetcher);
 await expect(adapter.complete(id==='openai'?options:geminiOptions)).rejects.toMatchObject({code:'rate_limit'});expect(fetcher).toHaveBeenCalledTimes(1);
});

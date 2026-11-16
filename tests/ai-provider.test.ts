import { describe,it,expect,vi } from 'vitest';
import { OpenRouterProvider,parseModels } from '../src/services/ai/openrouter';
import { parseAssistantResponse,redactSecrets } from '../src/services/ai/schema';
import { AI_KEY,answer,createAction,model } from './ai-fixtures';
const options={apiKey:AI_KEY,model,messages:[{role:'user' as const,content:'Plan my day.'}]};
function completion(content:string,finish_reason='stop'){return new Response(JSON.stringify({choices:[{message:{content},finish_reason}]}),{status:200});}
const entry={id:'provider/free',name:'Free text model',pricing:{prompt:'0',completion:'0'},architecture:{input_modalities:['text'],output_modalities:['text']},supported_parameters:['structured_outputs'],context_length:16000};
describe('OpenRouter models and bounded provider responses',()=>{
 it('discovers free text models and skips incompatible/invalid entries',()=>{
  const models=parseModels({data:[entry,{...entry,id:'provider/paid',pricing:{prompt:'0.001',completion:'0.002'}},{...entry,id:'provider/image',architecture:{output_modalities:['image']}},{...entry,id:'provider/request-fee',pricing:{prompt:'0',completion:'0',request:'1'}},{id:'bad'}]});
  expect(models).toHaveLength(3);expect(models[0]).toMatchObject({free:true,structured:true});expect(models.find(m=>m.id==='provider/request-fee')?.free).toBe(false);
  expect(()=>parseModels({data:[]})).toThrow('No text chat');
 });
 it('fetches the public model catalog without forwarding credentials',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:[entry]})));const provider=new OpenRouterProvider(fetcher);
  expect(await provider.listModels()).toHaveLength(1);expect(fetcher.mock.calls[0]).toHaveLength(2);
  const init=(fetcher.mock.calls[0] as unknown as [string,RequestInit])[1];expect(init.headers).toBeUndefined();expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');
 });
 it('sends schema-guided requests and validates structured output',async()=>{
  const fetcher=vi.fn(async()=>completion(JSON.stringify(answer(createAction()))));const provider=new OpenRouterProvider(fetcher);
  expect((await provider.complete(options)).response.actions).toHaveLength(1);
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];const body=JSON.parse(String(init.body));
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');expect(body.response_format.type).toBe('json_schema');expect(body.provider.require_parameters).toBe(true);expect(body.model).toBe(model.id);expect(body.models).toBeUndefined();
 });
 it('works without structured-output support and retries malformed output once',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(completion('not json')).mockResolvedValueOnce(completion('```json\n'+JSON.stringify(answer())+'\n```'));
  const result=await new OpenRouterProvider(fetcher).complete({...options,model:{...model,structured:false}});
  expect(result.attempts).toBe(2);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).response_format).toBeUndefined();
 });
 it('falls back to text on a rejected structured format using the same selected model',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:400})).mockResolvedValueOnce(completion(JSON.stringify(answer())));
  await new OpenRouterProvider(fetcher).complete(options);const retry=JSON.parse(fetcher.mock.calls[1][1].body);expect(retry.model).toBe(model.id);expect(retry.response_format).toBeUndefined();
 });
 it.each([401,402,403,404,429,500,503])('sanitizes HTTP %i and never automatically retries it',async(status)=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:AI_KEY}}),{status,headers:{'Retry-After':'30'}}));
  let message='';try{await new OpenRouterProvider(fetcher).complete(options);}catch(e){message=(e as Error).message;}
  expect(message).toBeTruthy();expect(message).not.toContain(AI_KEY);expect(fetcher).toHaveBeenCalledTimes(1);if(status===429)expect(message).toContain('30 seconds');
 });
 it('recognizes an error embedded in a 200 response',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:429,message:AI_KEY}}),{status:200}));
  await expect(new OpenRouterProvider(fetcher).complete(options)).rejects.toMatchObject({code:'rate_limit'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('stops after two invalid, refused or truncated responses',async()=>{
  for(const response of [()=>completion('{bad'),()=>completion(JSON.stringify(answer()),'length'),()=>new Response(JSON.stringify({choices:[{message:{refusal:AI_KEY},finish_reason:'stop'}]}))]){
   const fetcher=vi.fn(async()=>response());await expect(new OpenRouterProvider(fetcher).complete(options)).rejects.toMatchObject({code:'invalid_response'});expect(fetcher).toHaveBeenCalledTimes(2);
  }
 });
 it('handles network failures, timeout and explicit cancellation without leaking errors',async()=>{
  await expect(new OpenRouterProvider(async()=>{throw new Error(AI_KEY);}).complete(options)).rejects.toMatchObject({code:'network'});
  const hung:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error(AI_KEY)));});
  await expect(new OpenRouterProvider(hung,5).complete(options)).rejects.toMatchObject({code:'timeout'});
  const controller=new AbortController(),request=new OpenRouterProvider(hung).complete({...options,signal:controller.signal});controller.abort();await expect(request).rejects.toMatchObject({code:'cancelled'});
 });
 it('rejects oversized responses before parsing',async()=>{
  const fetcher=vi.fn(async()=>new Response('x'.repeat(300000)));await expect(new OpenRouterProvider(fetcher).complete(options)).rejects.toMatchObject({code:'invalid_response'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('discards unknown fields, rejects unknown actions and redacts echoed credentials in all fields',()=>{
  expect(parseAssistantResponse(JSON.stringify({...answer(),sql:'DELETE FROM tasks'}))).toEqual(answer()); // Unknown fields are discarded, never acted on.
  expect(JSON.stringify(parseAssistantResponse(JSON.stringify({reply:'ok',actions:[{type:'complete_task',taskId:'t1',sql:'DROP'}]})))).not.toContain('DROP');
  expect(()=>parseAssistantResponse(JSON.stringify({reply:'ok',actions:[{type:'delete_database'}]}))).toThrow();
  const response=parseAssistantResponse(JSON.stringify(answer(createAction({title:AI_KEY}))),[AI_KEY]);expect(JSON.stringify(response)).not.toContain(AI_KEY);
  expect(redactSecrets(`key ${AI_KEY}`)).toBe('key [redacted key]');
 });
});

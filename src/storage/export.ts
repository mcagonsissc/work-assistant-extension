import { db, getSettings, type WorkdayDB } from './db';
import { redactSecrets } from '../services/ai/schema';
export async function exportWorkData(database:WorkdayDB=db) {
  return database.transaction('r',database.tables,async()=>{
    const secrets=(await database.aiConfig.toArray()).map(c=>c.apiKey).filter(Boolean);
    // Explicit allowlist: credentials, model cache, chat and AI proposals are never exported.
    const data={version:4,exportedAt:new Date().toISOString(),tasks:await database.tasks.toArray(),blocks:await database.blocks.toArray(),sessions:await database.sessions.toArray(),events:await database.events.toArray(),settings:await getSettings(database),plans:(await database.plans.toArray()).map(({signature,...plan})=>plan)};
    return JSON.stringify(data,(_key,value)=>typeof value==='string'?redactSecrets(value,secrets):value,2);
  });
}

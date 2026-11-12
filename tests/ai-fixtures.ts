import type { AIAction, AssistantResponse } from '../src/services/ai/schema';
export const AI_KEY='sk-or-v1-test-only-not-a-real-credential-1234567890';
export const AI_DATE='2026-11-12';
export const AI_NOW=Date.parse(`${AI_DATE}T08:00:00Z`);
export function createAction(patch:Partial<Extract<AIAction,{type:'create_task'}>>={}):Extract<AIAction,{type:'create_task'}> {return {type:'create_task',clientId:'review',title:'Review pull requests',description:'',estimatedMinutes:60,priority:'high',category:'review',scheduledDate:AI_DATE,deadline:null,dependencyIds:[],...patch};}
export function answer(...actions:AIAction[]):AssistantResponse{return {reply:'Here are proposed changes for you to review.',actions};}
export const blankPatch={title:null,description:null,estimatedMinutes:null,priority:null,category:null,scheduledDate:null,clearScheduledDate:false,deadline:null,clearDeadline:false};
export const model={id:'test/provider-free',name:'Test model',free:true,promptPrice:'0',completionPrice:'0',structured:true,contextLength:16000};

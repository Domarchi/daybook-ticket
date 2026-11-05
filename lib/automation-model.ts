import { z } from 'zod';
import type { TicketPriority, TicketStatus } from './types';
import { selectAutomaticAssignee, type AssignmentCandidate } from './automatic-assignment';

const name=z.string().trim().min(1).max(120),ids=z.array(z.string().uuid()).max(20).refine(v=>new Set(v).size===v.length,'Hay opciones repetidas.');
export const automationEventKinds=['ticket_created','ticket_updated','client_replied','agent_replied'] as const;
export type AutomationEventKind=typeof automationEventKinds[number];
/** A new activation is distinct even when two toggles share the same millisecond. */
export function automationActivationMatches(settings:{enabled:boolean;version:number;activatedAt:string|null},event:{activationVersion:number;createdAt:string}):boolean{return settings.enabled&&settings.version===event.activationVersion&&settings.activatedAt!==null&&event.createdAt>=settings.activatedAt;}
export const taskTemplateSchema=z.object({name,items:z.array(z.object({title:z.string().trim().min(1).max(200),assigneeMemberId:z.string().uuid().nullable().default(null),dueAfterHours:z.number().int().min(1).max(8760).nullable().default(null)}).strict()).min(1).max(10)}).strict();
export interface TaskTemplate extends z.output<typeof taskTemplateSchema>{id:string;version:number;archived:boolean;createdAt:string;updatedAt:string}
export const automationRuleSchema=z.object({
  name,enabled:z.boolean().default(false),position:z.number().int().min(0).max(999).default(0),
  conditions:z.object({events:z.array(z.enum(automationEventKinds)).min(1).max(4).default(['ticket_created']),customerCompanyId:z.string().uuid().nullable().default(null),departments:z.array(z.string().trim().min(1).max(160)).max(20).default([]),priorities:z.array(z.enum(['low','normal','high','urgent'])).max(4).default([]),statuses:z.array(z.enum(['open','pending','resolved'])).max(3).default(['open','pending']),requestTypeIds:ids.default([]),allTagIds:ids.default([])}).strict().default({events:['ticket_created'],customerCompanyId:null,departments:[],priorities:[],statuses:['open','pending'],requestTypeIds:[],allTagIds:[]}),
  actions:z.object({addTagIds:ids.default([]),department:z.string().trim().min(1).max(160).nullable().default(null),assignMemberIds:ids.default([]),taskTemplateIds:z.array(z.string().uuid()).max(3).refine(v=>new Set(v).size===v.length,'Hay plantillas repetidas.').default([])}).strict(),
}).strict().refine(v=>v.actions.addTagIds.length||v.actions.department||v.actions.assignMemberIds.length||v.actions.taskTemplateIds.length,'Agrega al menos una acción interna.');
export type AutomationRuleDefinition=z.output<typeof automationRuleSchema>;
export interface AutomationRule extends AutomationRuleDefinition{id:string;version:number;archived:boolean;enabledAt:string|null;updatedByMemberId:string;referencesHash:string;createdAt:string;updatedAt:string}
export const ruleCreateSchema=z.object({rule:automationRuleSchema,simulationProof:z.string().max(2048).optional()}).strict();
export const rulePatchSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),rule:automationRuleSchema.optional(),archived:z.boolean().optional(),simulationProof:z.string().max(2048).optional()}).strict().refine(v=>v.rule!==undefined||v.archived!==undefined,'No hay cambios.');
export const templatePatchSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),template:taskTemplateSchema.optional(),archived:z.boolean().optional()}).strict().refine(v=>v.template!==undefined||v.archived!==undefined,'No hay cambios.');
export const automationSettingsSchema=z.object({enabled:z.boolean(),expectedVersion:z.number().int().nonnegative()}).strict();
export interface AutomationTicket {id:number;ownerId:string;customerCompanyId:string|null;requesterMemberId:string|null;department:string;priority:TicketPriority;status:TicketStatus;assigneeMemberId:string|null;assignee?:string;requestTypeId:string|null;tagIds:string[];taskCount:number;version:number}
export interface AutomationPlan {matches:boolean;addTagIds:string[];department:string|null;assignee:{id:string;name:string}|null;assignmentReason:string|null;tasks:{templateId:string;templateVersion:number;title:string;assigneeMemberId:string|null;dueAfterHours:number|null}[]}
export function ruleMatches(rule:AutomationRuleDefinition,ticket:AutomationTicket,event:AutomationEventKind):boolean{
  const c=rule.conditions;
  return c.events.includes(event)&&(c.customerCompanyId===null||c.customerCompanyId===ticket.customerCompanyId)&&(!c.departments.length||c.departments.includes(ticket.department))&&(!c.priorities.length||c.priorities.includes(ticket.priority))&&(!c.statuses.length||c.statuses.includes(ticket.status))&&(!c.requestTypeIds.length||c.requestTypeIds.includes(ticket.requestTypeId??''))&&c.allTagIds.every(id=>ticket.tagIds.includes(id));
}
export function firstAutomationRule(rules:AutomationRule[],ticket:AutomationTicket,event:AutomationEventKind,eventAt:string):AutomationRule|null{
  return rules.filter(rule=>rule.enabled&&!rule.archived&&rule.enabledAt!==null&&rule.enabledAt<=eventAt&&ruleMatches(rule,ticket,event)).sort((a,b)=>a.position-b.position||(a.id<b.id?-1:a.id>b.id?1:0))[0]??null;
}
export function planAutomation(rule:AutomationRuleDefinition,ticket:AutomationTicket,event:AutomationEventKind,candidates:AssignmentCandidate[],templates:TaskTemplate[]):AutomationPlan{
  const empty:AutomationPlan={matches:false,addTagIds:[],department:null,assignee:null,assignmentReason:null,tasks:[]};
  if(!ruleMatches(rule,ticket,event))return empty;
  const actions=rule.actions,selectedTemplates=actions.taskTemplateIds.map(id=>templates.find(template=>template.id===id&&!template.archived));
  if(selectedTemplates.some(template=>!template))throw new Error('Una plantilla ya no está disponible.');
  const tasks=selectedTemplates.flatMap(template=>template!.items.map(task=>({templateId:template!.id,templateVersion:template!.version,...task})));
  if(ticket.taskCount+tasks.length>1000)throw new Error('El ticket alcanzó su límite de tareas.');
  let assignee:AutomationPlan['assignee']=null,assignmentReason:string|null=null;
  if(actions.assignMemberIds.length){
    if(ticket.assigneeMemberId||ticket.assignee?.trim())assignmentReason='El ticket ya tiene responsable; se conserva.';
    else if(ticket.status==='resolved')assignmentReason='El ticket está resuelto; no se asignará.';
    else{
      const chosen=selectAutomaticAssignee([{id:'automation',name:rule.name,customerCompanyId:null,department:null,enabled:true,position:0,agentMemberIds:actions.assignMemberIds,version:0,createdAt:'',updatedAt:''}],candidates,{customerCompanyId:ticket.customerCompanyId,department:ticket.department});
      assignee=chosen?{id:chosen.id,name:chosen.name}:null;
      if(!chosen)assignmentReason='No hay integrantes disponibles con capacidad; queda sin asignar.';
    }
  }
  const addTagIds=actions.addTagIds.filter(id=>!ticket.tagIds.includes(id));
  if(new Set([...ticket.tagIds,...addTagIds]).size>20)throw new Error('El ticket no admite más de 20 etiquetas.');
  return {matches:true,addTagIds,department:actions.department!==ticket.department?actions.department:null,assignee,assignmentReason,tasks};
}
export const simulationSchema=z.object({ticketId:z.number().int().positive(),eventKind:z.enum(automationEventKinds).default('ticket_created'),ruleId:z.string().uuid().optional(),rule:automationRuleSchema.optional()}).strict().refine(v=>!(v.ruleId&&v.rule),'Selecciona una regla guardada o un borrador.');
export const ticketRelationSchema=z.object({operationId:z.string().uuid(),targetTicketId:z.number().int().positive(),kind:z.enum(['related','duplicate'])}).strict();
export const relationPatchSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().nonnegative(),archived:z.boolean()}).strict();
export function duplicateCompatible(left:Pick<AutomationTicket,'id'|'ownerId'|'customerCompanyId'|'requesterMemberId'>,right:Pick<AutomationTicket,'id'|'ownerId'|'customerCompanyId'|'requesterMemberId'>):boolean{return left.id!==right.id&&left.ownerId===right.ownerId&&left.customerCompanyId===right.customerCompanyId&&Boolean(left.requesterMemberId)&&left.requesterMemberId===right.requesterMemberId;}
export interface TicketRelation{id:string;sourceTicketId:number;targetTicketId:number;kind:'related'|'duplicate';version:number;archived:boolean;createdAt:string;otherTicket:{id:number;subject:string;status:string};isPrincipal:boolean}
export const templateApplySchema=z.object({operationId:z.string().uuid(),templateId:z.string().uuid(),expectedTemplateVersion:z.number().int().nonnegative()}).strict();

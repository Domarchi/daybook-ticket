/** Minimum success contracts for the interactive E1–E4 mutations. A valid
 * status with an incomplete response must not clear a draft or its operation. */
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const identifier=(value:unknown)=>typeof value==='string'&&value.length>0;
const versioned=(value:unknown):value is Record<string,unknown>=>record(value)&&identifier(value.id)&&integer(value.version);
const setting=(value:unknown)=>record(value)&&typeof value.enabled==='boolean'&&integer(value.version);
const ticket=(value:unknown)=>record(value)&&integer(value.id)&&Number(value.id)>0&&integer(value.version)&&typeof value.subject==='string';
const context=(value:unknown)=>record(value)&&integer(value.version)&&Array.isArray(value.assetIds)&&Array.isArray(value.contractIds)&&Array.isArray(value.assets)&&Array.isArray(value.contracts);

export function validDomainResponse(path:string,method:string,value:unknown):boolean{
 if(!record(value))return false;
 const url=new URL(path,'https://daybook.invalid'),route=url.pathname.replace(/^\/api\/workspaces\/[^/]+\//,'/api/');
 if(method==='GET')return Object.keys(value).length>0;
 if(route==='/api/auth/sign-out')return value.success===true;
 if(route==='/api/demo')return typeof value.loaded==='boolean';
 if(route==='/api/preferences')return ['light','dark','system'].includes(String(value.theme));
 if(route==='/api/evolution/features')return integer(value.version)&&record(value.features);
 if(/^\/api\/tickets\/\d+\/messages$/.test(route))return record(value.message)&&integer(value.message.id)&&Number(value.message.id)>0&&integer(value.message.ticketId)&&typeof value.message.body==='string'&&['request','reply','note'].includes(String(value.message.kind));
 if(/^\/api\/tickets(?:\/\d+)?$/.test(route)||/^\/api\/tickets\/\d+\/claim$/.test(route))return ticket(value.ticket);
 if(/^\/api\/articles(?:\/\d+)?$/.test(route))return record(value.article)&&integer(value.article.id)&&Number(value.article.id)>0&&typeof value.article.title==='string';
 if(route==='/api/settings')return record(value.settings)&&typeof value.settings.brandName==='string'&&record(value.settings.slaHours);
 if(route==='/api/organization/catalog')return versioned(value.item)&&record(value.item.definition)&&['tag','requestType','field','form'].includes(String(value.item.kind));
 if(/^\/api\/saved-views(?:\/[^/]+)?$/.test(route))return method==='DELETE'?value.ok===true:versioned(value.view)&&record(value.view.filters);
 if(/^\/api\/tickets\/\d+\/organization$/.test(route))return record(value.organization)&&integer(value.organization.version)&&record(value.organization.values)&&Array.isArray(value.organization.tags);
 if(/^\/api\/(?:ticket-tasks\/[^/]+|tickets\/\d+\/tasks)$/.test(route))return versioned(value.task)&&typeof value.task.title==='string'&&integer(value.task.ticketId);
 if(/^\/api\/tickets\/\d+\/followers$/.test(route))return typeof value.following==='boolean'&&Array.isArray(value.followers);
 if(route==='/api/automation/rules')return versioned(value.rule)&&typeof value.rule.enabled==='boolean'&&record(value.rule.conditions)&&record(value.rule.actions);
 if(route==='/api/automation/settings')return setting(value.settings);
 if(route==='/api/automation/simulate')return typeof value.matches==='boolean'&&record(value.ticket)&&integer(value.ticket.id)&&(value.simulationProof===null||identifier(value.simulationProof));
 if(route==='/api/task-templates')return versioned(value.template)&&Array.isArray(value.template.items);
 if(/^\/api\/tickets\/\d+\/task-templates$/.test(route))return integer(value.created)&&identifier(value.templateId)&&integer(value.templateVersion);
 if(/^\/api\/tickets\/\d+\/relations$/.test(route))return method==='PATCH'?value.ok===true:identifier(value.id)&&typeof value.created==='boolean';
 if(/^\/api\/tickets\/\d+\/service-context$/.test(route))return context(value);
 if(/^\/api\/service-context\/contracts\/[^/]+\/documents$/.test(route))return Array.isArray(value.attached)&&value.attached.every(identifier);
 if(route==='/api/service-context/config/current')return setting(value);
 if(/^\/api\/service-context\/reminders\/[^/]+$/.test(route))return identifier(value.id)&&typeof value.readAt==='string';
 if(route==='/api/service-context'||/^\/api\/service-context\/(?:profiles|sites|services|assets|contracts)\/[^/]+$/.test(route))return versioned(value.item)&&identifier(value.item.companyId);
 return false;
}
export const domainResponseValidator=<T>(path:string,method:string)=>(value:unknown):value is T=>validDomainResponse(path,method,value);

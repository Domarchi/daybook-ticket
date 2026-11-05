import { PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage } from 'pdf-lib';
import { metricsCsvCell } from './agent-metrics-model';
import { daybookLogoPng } from './mail-templates';
import { companyReportSchema,type CompanyMonthlyReport,type CompanyTrend } from './knowledge-model';

export function companyReportCsv(snapshot:CompanyMonthlyReport):string {
 const report=companyReportSchema.parse(snapshot.report),s=report.summary,historical=report.classificationBasis==='verified-period-cutoff';
 const rows:(string|number|null)[][]=[['Daybook Ticket','Informe mensual privado'],['Empresa',report.companyName],['Mes',snapshot.month],['Desde',report.period.from,'Hasta',report.period.to],['Zona horaria',report.period.timeZone],['Captura',snapshot.createdAt],['Datos ficticios',report.period.includeTests?'Incluidos':'Excluidos'],[],['Indicador','Valor'],['Creados (empresa actual)',s.created],['Abiertos actuales',s.currentOpen],['Pendientes actuales',s.currentPending],['Vencidos actuales',s.currentOverdue],['Resoluciones registradas',s.resolutions],['SLA cumplido',s.slaMet],['SLA excedido',s.slaBreached],['Cumplimiento SLA (%)',s.slaCompliancePercent],['Respuestas públicas del equipo',s.publicReplies],['Resueltos históricos sin medición',s.unknownResolved],[historical?'Entradas sin tipo verificable al cierre':'Entradas sin tipo',s.untyped],[historical?'Entradas sin equipo verificable al cierre':'Entradas sin equipo vinculado',s.withoutAsset]];
 for(const [label,values] of [['Tipos registrados',report.byType],[historical?'Equipos verificables al cierre':'Equipos vinculados actualmente',report.byAsset],['Entradas por día',report.byDay]] as [string,CompanyTrend[]][]){rows.push([],[label,'Tickets'],...values.map(value=>[value.label,value.count]));}
 rows.push([],['Alcance y cobertura'],...report.coverageNotes.map(note=>[note]),['Privado. Uso exclusivo del equipo autorizado. Un servicio Daybook.']);
 return '\uFEFF'+rows.map(row=>row.map(metricsCsvCell).join(',')).join('\r\n');
}
function printable(font:PDFFont,value:string):string {
 return Array.from(value.replace(/[\u0000-\u001f\u007f]/g,' ')).map(character=>{try{font.encodeText(character);return character;}catch{return '?';}}).join('');
}
export function wrapPdfText(font:PDFFont,value:string,size:number,width:number):string[] {
 const input=printable(font,value),lines:string[]=[];let line='';
 for(const word of input.split(/\s+/)){
  const candidate=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(candidate,size)<=width){line=candidate;continue;}
  if(line){lines.push(line);line='';}
  for(const character of word){if(line&&font.widthOfTextAtSize(line+character,size)>width){lines.push(line);line='';}line+=character;}
 }
 if(line)lines.push(line);return lines.length?lines:[''];
}
/** Bounded snapshots only. Text is measured and paginated; no network or file-provider access. */
export async function companyReportPdf(snapshot:CompanyMonthlyReport):Promise<Uint8Array> {
 const report=companyReportSchema.parse(snapshot.report),doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),logo=await doc.embedPng(daybookLogoPng());
 doc.setTitle(`Daybook Ticket - Informe ${snapshot.month}`);doc.setAuthor('Daybook');doc.setSubject('Informe privado del servicio');doc.setCreator('Daybook Ticket');doc.setCreationDate(new Date(snapshot.createdAt));
 const ink=rgb(.07,.07,.07),muted=rgb(.36,.36,.36),gold=rgb(.58,.40,.10),pale=rgb(.96,.95,.92),line=rgb(.86,.86,.84),margin=42,width=511;
 let page!:PDFPage;let y=0;
 const addPage=()=>{page=doc.addPage([595,842]);page.drawRectangle({x:0,y:762,width:595,height:80,color:ink});page.drawImage(logo,{x:margin,y:781,width:38,height:38});page.drawText('DAYBOOK',{x:92,y:801,font:bold,size:17,color:rgb(1,1,1)});page.drawText('TICKET  /  INFORME PRIVADO',{x:92,y:783,font:regular,size:9,color:rgb(.93,.78,.48)});y=735;};
 const ensure=(height:number)=>{if(y-height<58)addPage();};
 const text=(value:string,size=10,font=regular,color=ink)=>{for(const row of wrapPdfText(font,value,size,width)){ensure(size*1.5);page.drawText(row,{x:margin,y,font,size,color});y-=size*1.5;}};
 const heading=(value:string)=>{ensure(40);y-=14;text(value,14,bold);y-=8;};
 const count=(value:number)=>new Intl.NumberFormat('es-CL',{maximumFractionDigits:1}).format(value);
 const table=(title:string,rows:CompanyTrend[])=>{
  if(rows.length)ensure(40+Math.max(26,wrapPdfText(regular,rows[0].label,10,width-74).length*14+12));heading(title);if(!rows.length){text('Sin datos registrados para este período.',10,regular,muted);return;}
  for(const row of rows){const lines=wrapPdfText(regular,row.label,10,width-74),height=Math.max(26,lines.length*14+12);if(y-height<58){addPage();text(`${title} (continuación)`,12,bold);y-=10;}page.drawLine({start:{x:margin,y:y+3},end:{x:553,y:y+3},thickness:.5,color:line});for(const [i,label] of lines.entries())page.drawText(label,{x:margin+6,y:y-12-i*14,size:10,font:regular,color:ink});const value=count(row.count);page.drawText(value,{x:547-bold.widthOfTextAtSize(value,10),y:y-12,size:10,font:bold,color:gold});y-=height;}
 };
 addPage();text(`Informe mensual - ${snapshot.month}`,18,bold);y-=8;text(report.companyName,16,bold);y-=4;text(`${report.period.from} al ${report.period.to}  |  America/Santiago`,10,regular,muted);text(`Captura: ${new Date(snapshot.createdAt).toLocaleString('es-CL',{timeZone:'America/Santiago'})}`,9,regular,muted);if(report.period.includeTests)text('Incluye datos marcados como prueba.',9,bold,gold);y-=18;
 const s=report.summary,historical=report.classificationBasis==='verified-period-cutoff',metrics:[string,string][]=[['Creados (empresa actual)',count(s.created)],['Abiertos actuales',count(s.currentOpen)],['Pendientes actuales',count(s.currentPending)],['Vencidos actuales',count(s.currentOverdue)],['Resoluciones registradas',count(s.resolutions)],['Cumplimiento SLA',s.slaCompliancePercent===null?'Sin medición':`${count(s.slaCompliancePercent)}%`]];
 for(let i=0;i<metrics.length;i+=3){ensure(78);for(let c=0;c<3;c++){const [label,value]=metrics[i+c],x=margin+c*174;page.drawRectangle({x,y:y-67,width:163,height:67,color:pale});page.drawText(label,{x:x+10,y:y-18,font:regular,size:9,color:muted});page.drawText(value,{x:x+10,y:y-48,font:bold,size:value.length>12?13:21,color:ink});}y-=78;}
 text(`SLA: ${count(s.slaMet)} dentro del plazo y ${count(s.slaBreached)} fuera del plazo.`,10);text(`Respuestas públicas del equipo: ${count(s.publicReplies)}.`,10);text(`Cobertura: ${count(s.untyped)} ${historical?'sin tipo histórico':'sin tipo'}; ${count(s.withoutAsset)} ${historical?'sin equipo histórico':'sin equipo'}; ${count(s.unknownResolved)} resueltos históricos sin medición.`,9,regular,muted);
 table('Solicitudes por tipo registrado',report.byType);table(historical?'Equipos verificables al cierre':'Incidencias por equipo vinculado',report.byAsset);table('Entradas por día',report.byDay);heading('Alcance de este informe');for(const note of report.coverageNotes){text(note,9,regular,muted);y-=5;}text('Los caracteres que la fuente PDF no admite se representan con ?. El CSV conserva el texto original.',8,regular,muted);
 const pages=doc.getPages();for(const [i,current] of pages.entries()){current.drawLine({start:{x:margin,y:42},end:{x:553,y:42},thickness:.5,color:line});current.drawText('Privado - Un servicio Daybook',{x:margin,y:28,size:8,font:regular,color:muted});const label=`${i+1} / ${pages.length}`;current.drawText(label,{x:553-regular.widthOfTextAtSize(label,8),y:28,size:8,font:regular,color:muted});}
 return doc.save();
}

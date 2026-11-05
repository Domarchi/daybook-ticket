/** Read-only local handoff inventory. No dotenv, DB, HTTP, auth, credential
 * contents, dependency installation, configuration writes or Git mutation. */
import {spawnSync} from 'node:child_process';
import {access,lstat,readlink,readFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,delimiter,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),parent=dirname(root);
const EXPECTED_BRANCH='codex/daybook-evolution-07',BASELINE='dfa3839d9a066631e8afd0ee5b5648369fd03fac';
function git(args,cwd=root){const value=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false',...args],{cwd,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});return value.status===0?value.stdout.trim():null;}
async function present(path){try{await access(path);return true;}catch{return false;}}
async function binary(name){for(const folder of (process.env.PATH||'').split(delimiter).filter(Boolean))try{const path=join(folder,name);await access(path,constants.X_OK);return path;}catch{}return null;}
function statusCounts(raw){const records=(raw||'').split('\0').filter(Boolean),known=records.filter(value=>/^[12u?] /.test(value));return {entries:known.length,unmerged:known.filter(value=>value.startsWith('u ')).length,untracked:known.filter(value=>value.startsWith('? ')).length};}
async function main(){
 if(process.argv.length!==2)throw Error('Usage: node scripts/check-handoff-environment.mjs');
 const name=basename(root),mode=name==='daybook-ticket-claude'?'independent-clone':name==='daybook-evolution-07'?'source-worktree':'unrecognized-location';
 const branch=git(['branch','--show-current']),head=git(['rev-parse','HEAD']),originMain=git(['rev-parse','refs/remotes/origin/main']),status=git(['status','--porcelain=v2','-z','--untracked-files=normal']),gitRoot=git(['rev-parse','--show-toplevel']),common=git(['rev-parse','--git-common-dir']);
 const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8')),knownRepository=manifest.name==='daybook-ticket'&&git(['cat-file','-t',BASELINE])==='commit',counts=statusCounts(status),modules=join(root,'node_modules');
 let dependencyLink=false,dependencyDirectory=false,dependencyTarget=null,ownGitDirectory=false;
 try{const info=await lstat(modules);dependencyLink=info.isSymbolicLink();dependencyDirectory=info.isDirectory();if(dependencyLink)dependencyTarget=resolve(root,await readlink(modules));}catch{}
 try{const info=await lstat(join(root,'.git'));ownGitDirectory=info.isDirectory()&&!info.isSymbolicLink();}catch{}
 const commonDirectory=common?resolve(root,common):null,gitIndependent=ownGitDirectory&&commonDirectory===join(root,'.git'),hasAlternates=commonDirectory?await present(join(commonDirectory,'objects','info','alternates')):false;
 const dependencyLayoutSafe=mode==='independent-clone'?dependencyDirectory&&!dependencyLink:mode==='source-worktree'?dependencyLink:false;
 const worktrees=[];
 for(let number=2;number<=7;number++){
  const leaf=`daybook-evolution-${String(number).padStart(2,'0')}`,path=join(parent,leaf);
  if(mode==='independent-clone'){worktrees.push({name:leaf,path,referenceOnly:true,inspected:false});continue;}
  const exists=await present(path);
  worktrees.push({name:leaf,path,present:exists,branch:exists?git(['branch','--show-current'],path):null,head:exists?git(['rev-parse','HEAD'],path):null,referenceOnly:true});
 }
 const trackedEnvironmentTemplates=new Set();for(const name of ['.env.example'])if(git(['ls-files','--error-unmatch','--',name])===name){const info=await lstat(join(root,name));if(info.isFile()&&!info.isSymbolicLink())trackedEnvironmentTemplates.add(name);}
 const qaEnvPresent=await present(join(root,'.env.test.local')),rootNames=await readdir(root),privateEnvironmentFileCount=rootNames.filter(name=>(/^\.env/.test(name)||/^\.dev\.vars/.test(name))&&!trackedEnvironmentTemplates.has(name)).length;
 const privateAccessMarkers=[join(root,'.git-credentials'),join(root,'work','E7_REVIEW_ACCESS.json')];let privateAccessMarkerCount=0;for(const path of privateAccessMarkers)if(await present(path))privateAccessMarkerCount++;
 const instructions={agents:await present(join(root,'AGENTS.md')),claude:await present(join(root,'CLAUDE.md')),handoff:await present(join(root,'docs','CLAUDE_HANDOFF.md'))};
 const checks={instructionsPresent:Object.values(instructions).every(Boolean),knownProjectSource:knownRepository,expectedBranch:branch===EXPECTED_BRANCH,gitRootMatches:gitRoot===root,node24:Number(process.versions.node.split('.')[0])===24,dependencyLayoutSafe,dependenciesPresent:dependencyLink?Boolean(dependencyTarget&&await present(dependencyTarget)):dependencyDirectory,independentCloneMetadata:mode!=='independent-clone'||gitIndependent&&!hasAlternates,cleanCloneHasNoPrivateEnvironment:mode!=='independent-clone'||privateEnvironmentFileCount===0,cleanCloneHasNoPrivateAccessMarkers:mode!=='independent-clone'||privateAccessMarkerCount===0,noMergeConflicts:counts.unmerged===0,workingTreeClean:counts.entries===0,cachedOriginMainMatchesRecordedBaseline:originMain===BASELINE};
 const output={format:'daybook.claude-handoff-readiness.v1',checkedAt:new Date().toISOString(),result:Object.values(checks).every(Boolean)?'READY_FOR_LOCAL_REVIEW':'REVIEW_LOCAL_STATE',repository:'Domarchi/daybook-ticket',repositoryIdentityCheck:'known_baseline_commit_and_package_name',root,mode,branch,head,originMain,checks,workingTree:counts,nodeVersion:process.versions.node,nodeModules:{symlink:dependencyLink,ownDirectory:dependencyDirectory,target:dependencyTarget,lockedInstallAllowed:mode==='independent-clone'&&!dependencyLink},gitMetadata:{independent:gitIndependent,sharedObjectAlternates:hasAlternates},tools:{claudeCli:await binary('claude'),claudeDesktop:await binary('claude-desktop'),authenticationChecked:false},privateQaEnv:{present:qaEnvPresent,contentsRead:false},privateFilePresence:{environmentFileCount:privateEnvironmentFileCount,trackedTemplatesAllowed:[...trackedEnvironmentTemplates],accessMarkerCount:privateAccessMarkerCount,contentsRead:false},instructions,sourceWorktrees:worktrees,networkCalls:0,databaseCalls:0,environmentFilesLoaded:0,credentialContentsRead:false,filesWritten:0};
 console.log(JSON.stringify(output,null,2));if(output.result!=='READY_FOR_LOCAL_REVIEW')process.exitCode=1;
}
main().catch(()=>{console.error(JSON.stringify({result:'CHECK_UNAVAILABLE',networkCalls:0,databaseCalls:0,environmentFilesLoaded:0,credentialContentsRead:false,filesWritten:0}));process.exitCode=1;});

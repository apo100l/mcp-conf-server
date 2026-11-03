#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { BrowserAuthProvider } from './browser-auth.js';
import { packageVersion } from './version.js';
const base = process.env.CONFLUENCE_BASE_URL?.replace(/\/+$/, '');
let browser: BrowserAuthProvider | undefined;
function authBrowser() {
  if (!base) throw new Error('Set CONFLUENCE_BASE_URL');
  if (process.env.CONFLUENCE_AUTH_MODE !== 'browser') throw new Error('Set CONFLUENCE_AUTH_MODE=browser');
  return browser ??= new BrowserAuthProvider({baseUrl:base, loginUrl:process.env.CONFLUENCE_BROWSER_LOGIN_URL, profileDir:process.env.CONFLUENCE_BROWSER_PROFILE, channel:process.env.CONFLUENCE_BROWSER_CHANNEL || 'chrome'});
}
async function api(method:string, path:string, params?:object, data?:object) {
  if (!base) throw new Error('Set CONFLUENCE_BASE_URL including the context path, if any');
  const headers: Record<string,string> = {Accept:'application/json'};
  if (process.env.CONFLUENCE_AUTH_MODE === 'browser') headers.Cookie = await authBrowser().getCookieHeader();
  else if (process.env.CONFLUENCE_COOKIE) headers.Cookie = process.env.CONFLUENCE_COOKIE;
  else if (process.env.CONFLUENCE_PAT) headers.Authorization = `Bearer ${process.env.CONFLUENCE_PAT}`;
  else throw new Error('Set CONFLUENCE_PAT, CONFLUENCE_COOKIE or CONFLUENCE_AUTH_MODE=browser');
  const response = await axios.request({method, url:`${base}/rest/api/${path}`, params, data, headers, timeout:30000, maxRedirects:0});
  if (response.status !== 204 && !String(response.headers['content-type']).includes('application/json')) throw new Error('Expected JSON; check authentication and base URL');
  return response.data || {success:true};
}
const str = {type:'string'};
const paging = {start:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:100,default:25}};
const tools: Tool[] = [];
const handlers = new Map<string,(a:Record<string,unknown>)=>Promise<unknown>>();
function tool(name:string, description:string, properties:Record<string,object>, required:string[], handler:(a:any)=>Promise<unknown>, write=false) {
  tools.push({name:`conf_${name}`,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:!write,openWorldHint:true}});
  handlers.set(`conf_${name}`,handler);
}
const id = (s:string) => encodeURIComponent(s);
const page = (a:any) => ({start:a.start ?? 0,limit:a.limit ?? 25});
tool('browser_login','Open browser for Confluence SSO sign-in',{},[],async()=>authBrowser().openLogin());
tool('browser_auth_status','Check browser authentication',{},[],async()=>authBrowser().getStatus(false));
tool('get_current_user','Get authenticated user',{},[],async()=>api('GET','user/current'));
tool('search','Search content using CQL; returns one page with pagination metadata',{cql:str,...paging},['cql'],async a=>api('GET','content/search',{cql:a.cql,...page(a),expand:'space,version'}));
tool('get_spaces','List spaces (one page)',paging,[],async a=>api('GET','space',page(a)));
tool('get_space','Get space details',{spaceKey:str},['spaceKey'],async a=>api('GET',`space/${id(a.spaceKey)}`,{expand:'description.plain,homepage'}));
tool('get_page','Read page with storage XHTML body, version and ancestors',{pageId:str},['pageId'],async a=>api('GET',`content/${id(a.pageId)}`,{expand:'body.storage,version,space,ancestors'}));
tool('get_children','List child pages (one page)',{pageId:str,...paging},['pageId'],async a=>api('GET',`content/${id(a.pageId)}/child/page`,page(a)));
tool('create_page','Create page; body must be Confluence storage XHTML',{spaceKey:str,title:str,body:str,parentId:str},['spaceKey','title','body'],async a=>api('POST','content',undefined,{type:'page',title:a.title,space:{key:a.spaceKey},...(a.parentId?{ancestors:[{id:a.parentId}]}:{}),body:{storage:{value:a.body,representation:'storage'}}}),true);
tool('update_page','Update page using the current version returned by get_page. Conflicts are returned without retry.',{pageId:str,title:str,body:str,currentVersion:{type:'integer',minimum:1}},['pageId','title','body','currentVersion'],async a=>api('PUT',`content/${id(a.pageId)}`,undefined,{id:a.pageId,type:'page',title:a.title,version:{number:a.currentVersion+1},body:{storage:{value:a.body,representation:'storage'}}}),true);
tool('delete_page','Move a page to trash',{pageId:str},['pageId'],async a=>api('DELETE',`content/${id(a.pageId)}`),true);
tool('get_comments','List page comments (one page)',{pageId:str,...paging},['pageId'],async a=>api('GET',`content/${id(a.pageId)}/child/comment`,{...page(a),expand:'body.storage,version'}));
tool('add_comment','Add comment using storage XHTML',{pageId:str,body:str},['pageId','body'],async a=>api('POST','content',undefined,{type:'comment',container:{id:a.pageId,type:'page'},body:{storage:{value:a.body,representation:'storage'}}}),true);
tool('get_labels','List labels (one page)',{pageId:str,...paging},['pageId'],async a=>api('GET',`content/${id(a.pageId)}/label`,page(a)));
tool('add_label','Add global label',{pageId:str,label:str},['pageId','label'],async a=>api('POST',`content/${id(a.pageId)}/label`,undefined,{prefix:'global',name:a.label}),true);
const server = new Server({name:'mcp-conf-server',version:packageVersion},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
server.setRequestHandler(CallToolRequestSchema,async request=>{
 try {
  const definition=tools.find(t=>t.name===request.params.name);
  const handler=handlers.get(request.params.name);
  if (!definition || !handler) throw new Error('Unknown tool');
  const args=request.params.arguments ?? {};
  const schema=definition.inputSchema;
  for (const key of schema.required ?? []) if (!(key in args)) throw new Error(`Missing ${key}`);
  for (const [key,value] of Object.entries(args)) {
   const prop=(schema.properties as Record<string,any>)[key];
   if (!prop) throw new Error(`Unknown argument ${key}`);
   if (prop.type==='string' && (typeof value!=='string' || !value.trim())) throw new Error(`${key} must be a nonempty string`);
   if (prop.type==='integer' && (typeof value!=='number' || !Number.isInteger(value) || value<prop.minimum || (prop.maximum && value>prop.maximum))) throw new Error(`Invalid ${key}`);
  }
  return {content:[{type:'text',text:JSON.stringify(await handler(args),null,2)}]};
 } catch(e) {
  const message=axios.isAxiosError(e) ? `Confluence request failed${e.response ? ` (HTTP ${e.response.status})` : ''}` : e instanceof Error ? e.message : 'Request failed';
  return {isError:true,content:[{type:'text',text:message}]};
 }
});
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await browser?.close();await server.close();process.exit(0);});
server.connect(new StdioServerTransport()).catch(()=>{console.error('Failed to start Confluence MCP server');process.exit(1);});

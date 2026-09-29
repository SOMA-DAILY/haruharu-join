// Local-only visual fixture: the offer has just expired. Never part of public/.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {earlyOffer,EARLY_END} from '../shared/early-offer.mjs';
const root=resolve('public');
http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/api/early-offer'){res.setHeader('Content-Type','application/json');let now=Date.parse(EARLY_END);try{now=Number(await readFile('.wrangler/preview-time','utf8'));}catch{} res.end(JSON.stringify(earlyOffer(now)));return;}
 if(pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;}
 const file=resolve(root,'.'+decodeURIComponent(pathname)+(pathname.endsWith('/')?'index.html':''));
 if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
 try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
}).listen(4319,'127.0.0.1',()=>console.log('Expired-offer visual fixture: http://127.0.0.1:4319'));

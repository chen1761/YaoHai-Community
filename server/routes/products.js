import { randomUUID } from 'node:crypto';
import { crud, csv, parseCsv, validateRecord, audit } from './_business.js';
import { requireSession } from './auth.js';
const fields = ['sku','name','description','price','currency','category','imageUrl','active'];
export async function handleProductRoute(req,res,c) {
  const { pathname } = new URL(req.url,'http://localhost');
  if (pathname === '/api/products/export' && req.method === 'GET') { if (!requireSession(req,res,c)) return true; return c.sendJson(res,200,{csv:csv(c.store.list('products'),['id',...fields])}); }
  if (pathname === '/api/products/import' && req.method === 'POST') { if (!requireSession(req,res,c)) return true; const rows=parseCsv((await c.readJson(req)).csv,fields); const seen=new Set(c.store.list('products').map(x=>x.sku)); const records=rows.map((row,i)=>{if(!row.sku||seen.has(row.sku)) throw new TypeError('duplicate SKU at row '+(i+2)); seen.add(row.sku); const record={...row,price:Number(row.price),active:row.active==='true'}; validateRecord('products',record); return {...record,id:randomUUID()};}); c.store.transaction(()=>records.forEach(record=>c.store.create('products',record))); audit(c,'product_import',{count:records.length}); return c.sendJson(res,201,{imported:records.length}); }
  return crud('products')(req,res,c);
}

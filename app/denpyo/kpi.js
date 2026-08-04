/*
  data.js（農家の伝票 v2）
  状態管理・永続化・学習ロジックを集約。UIは app.js が担当。

  ドキュメントの一方通行の連鎖を軸に設計している：
    見積書 --(ワンタップ)--> 納品書 --(ワンタップ)--> 請求書 --(入金記録)--> 領収書
  各段階のドキュメントは作成時点の内容をスナップショットとして保持するため、
  後から商品マスタの価格を変えても過去のドキュメントの金額は変わらない。
*/
import { loadJSON, saveJSON } from '../../assets/js/storage.js';
import { pushRecord } from './sheetsSync.js';

const STORAGE_KEY = 'nouka-denpyo:v2';
const UNIT_OPTIONS = ['個','ケース','キロ','玉','袋','本','箱','束'];

function seedState(){
  return {
    farmName: '緑川農園',
    taxSettings: { type:'exclusive', rate:8 },
    invoiceRegNo: 'T1234567890123',
    bankInfo: '○○銀行 ○○支店 普通 0000000 ミドリカワノウエン',
    quoteValidDays: 14,

    customerMaster: [
      { name:'スーパーA', freq:12 },
      { name:'直売所B', freq:8 },
      { name:'飲食店C', freq:5 },
    ],
    productMaster: [
      { name:'トマト', unit:'キロ', price:300, cost:170 },
      { name:'きゅうり', unit:'キロ', price:250, cost:140 },
      { name:'なす', unit:'袋', price:200, cost:110 },
    ],
    itemsByCustomer: {
      'スーパーA': [{ name:'トマト', freq:9 }, { name:'きゅうり', freq:4 }],
      '直売所B': [{ name:'なす', freq:6 }, { name:'トマト', freq:3 }],
      '飲食店C': [{ name:'きゅうり', freq:5 }],
    },
    priceMaster: [
      { customer:'スーパーA', item:'トマト', price:300, unit:'キロ' },
      { customer:'スーパーA', item:'きゅうり', price:250, unit:'キロ' },
      { customer:'直売所B', item:'なす', price:200, unit:'袋' },
      { customer:'直売所B', item:'トマト', price:280, unit:'キロ' },
      { customer:'飲食店C', item:'きゅうり', price:230, unit:'キロ' },
    ],

    documents:{
      quote:   [],
      delivery:[
        { id:'D3', date:'7/30', customer:'スーパーA', items:[{name:'トマト',qty:10,unit:'キロ',price:300}], detail:'トマト 10キロ ほか', total:12000, invoiced:false, reservation:false, fromQuoteId:null, createdAt: Date.now()-1*86400000 },
        { id:'D2', date:'7/29', customer:'直売所B', items:[{name:'きゅうり',qty:15,unit:'キロ',price:250}], detail:'きゅうり 15キロ', total:4500, invoiced:false, reservation:false, fromQuoteId:null, createdAt: Date.now()-2*86400000 },
        { id:'D1', date:'7/28', customer:'飲食店C', items:[{name:'トマト',qty:8,unit:'キロ',price:300}], detail:'トマト 8キロ', total:8000, invoiced:false, reservation:false, fromQuoteId:null, createdAt: Date.now()-3*86400000 },
      ],
      invoice: [],
      receipt: [],
    },
    seq:{ quote:0, delivery:3, invoice:0, receipt:0 },

    /*
      lastYearMonthly：前年実績のプレースホルダ。
      実データが1年分蓄積されるまでの参考値として、控えめな固定値を仮置きしている。
      Part4以降、Googleスプレッドシート連携で実際の前年実績を読み込めるようになった時点で
      この仮データは自動的に使われなくなる想定（kpi.js 側でフォールバックとして扱う）。
    */
    lastYearMonthly:{
      '2025-02': 96000, '2025-03': 101000, '2025-04': 108000,
      '2025-05': 112000, '2025-06': 115000, '2025-07': 118000,
    },
  };
}

export let state = loadJSON(STORAGE_KEY, null) || seedState();
export function persist(){ saveJSON(STORAGE_KEY, state); }
export function resetDemoData(){ state = seedState(); persist(); }

/* ---------- 学習型の候補ロジック ---------- */
export function sortedCustomers(){
  return [...state.customerMaster].sort((a,b)=>b.freq-a.freq);
}
export function itemsForCustomer(customerName){
  const list = state.itemsByCustomer[customerName];
  if(list && list.length) return { list:[...list].sort((a,b)=>b.freq-a.freq), personalized:true };
  const fallback = state.productMaster.slice(0,3).map(p=>({ name:p.name, freq:0 }));
  return { list: fallback, personalized:false };
}
export function lastDealFor(customer, item){
  const p = state.priceMaster.find(p=>p.customer===customer && p.item===item);
  if(p) return { price:p.price, unit:p.unit };
  const prod = state.productMaster.find(p=>p.name===item);
  return prod ? { price:prod.price, unit:prod.unit } : { price:250, unit:'キロ' };
}
export function recordUsage(customer, itemNames){
  const c = state.customerMaster.find(c=>c.name===customer);
  if(c) c.freq += 1;
  if(!state.itemsByCustomer[customer]) state.itemsByCustomer[customer] = [];
  itemNames.forEach(name=>{
    const entry = state.itemsByCustomer[customer].find(i=>i.name===name);
    if(entry) entry.freq += 1;
    else state.itemsByCustomer[customer].push({ name, freq:1 });
  });
  persist();
}

/* ---------- 顧客管理 ---------- */
export function addCustomer(name){
  if(!state.customerMaster.find(c=>c.name===name)){
    state.customerMaster.push({ name, freq:0 });
    state.itemsByCustomer[name] = [];
    persist();
    pushRecord('顧客', { name });
  }
}

/* ---------- 商品管理 ---------- */
export function addProduct(name, unit, price, cost){
  if(!state.productMaster.find(p=>p.name===name)){
    state.productMaster.push({ name, unit: unit || 'キロ', price: price || 0, cost: cost || 0 });
    persist();
    pushRecord('商品', { name, unit: unit || 'キロ', price: price || 0, cost: cost || 0 });
  }
}
export function updateProduct(index, patch){
  Object.assign(state.productMaster[index], patch);
  persist();
}

function upsertPrice(customer, item, price, unit){
  const existing = state.priceMaster.find(p=>p.customer===customer && p.item===item);
  if(existing){ existing.price = price; existing.unit = unit || existing.unit; }
  else state.priceMaster.push({ customer, item, price, unit: unit || 'キロ' });
}

/* ---------- 共通：金額計算 ---------- */
export function calcTotals(items){
  const subtotal = items.reduce((s,i)=>s + i.qty*i.price, 0);
  let taxBase, taxAmount, total;
  if(state.taxSettings.type==='exclusive'){
    taxBase = subtotal; taxAmount = Math.round(subtotal*state.taxSettings.rate/100); total = taxBase+taxAmount;
  } else {
    total = subtotal; taxAmount = Math.round(total - total/(1+state.taxSettings.rate/100)); taxBase = total-taxAmount;
  }
  return { taxBase:Math.round(taxBase), taxAmount, total:Math.round(total) };
}

/* ---------- 見積書 ---------- */
export function createQuote({ customer, items, memo, validDays }){
  state.seq.quote += 1;
  const { total } = calcTotals(items);
  const detail = items.map(i=>`${i.name} ${i.qty}${i.unit}`).join('、');
  const doc = {
    id:'Q'+state.seq.quote, date: todayLabel(), customer, items, detail, total,
    memo: memo||'', validDays: validDays || state.quoteValidDays, converted:false,
    createdAt: Date.now(),
  };
  state.documents.quote.unshift(doc);
  items.forEach(i=> upsertPrice(customer, i.name, i.price, i.unit));
  recordUsage(customer, items.map(i=>i.name));
  persist();
  pushRecord('見積書', { id:doc.id, date:doc.date, customer:doc.customer, detail:doc.detail, items:doc.items, total:doc.total, validDays:doc.validDays, converted:doc.converted });
  return doc;
}
export function convertQuoteToDelivery(quoteId, { isReservation, dateLabel } = {}){
  const q = state.documents.quote.find(d=>d.id===quoteId);
  if(!q) return null;
  state.seq.delivery += 1;
  const doc = {
    id:'D'+state.seq.delivery, date: dateLabel || todayLabel(), customer:q.customer,
    items:q.items, detail:q.detail, total:q.total, invoiced:false,
    reservation: !!isReservation, fromQuoteId:q.id, createdAt: Date.now(),
  };
  state.documents.delivery.unshift(doc);
  q.converted = true;
  persist();
  pushRecord('納品書', { id:doc.id, date:doc.date, customer:doc.customer, detail:doc.detail, items:doc.items, total:doc.total, invoiced:doc.invoiced, reservation:doc.reservation, fromQuoteId:doc.fromQuoteId });
  return doc;
}

/* ---------- 納品書 ---------- */
export function createDeliveryNote({ date, customer, items, memo, isReservation }){
  state.seq.delivery += 1;
  const { total } = calcTotals(items);
  const detail = items.map(i=>`${i.name} ${i.qty}${i.unit}`).join('、');
  const doc = {
    id:'D'+state.seq.delivery, date, customer, items, detail, total, memo: memo||'',
    invoiced:false, reservation: !!isReservation, fromQuoteId:null, createdAt: Date.now(),
  };
  state.documents.delivery.unshift(doc);
  items.forEach(i=> upsertPrice(customer, i.name, i.price, i.unit));
  recordUsage(customer, items.map(i=>i.name));
  persist();
  pushRecord('納品書', { id:doc.id, date:doc.date, customer:doc.customer, detail:doc.detail, items:doc.items, total:doc.total, invoiced:doc.invoiced, reservation:doc.reservation, fromQuoteId:doc.fromQuoteId });
  return doc;
}
export function unbilledNotesFor(customer){
  return state.documents.delivery.filter(n=>n.customer===customer && !n.invoiced && !n.reservation);
}

/* ---------- 請求書 ---------- */
export function createInvoice(customer, noteIds){
  state.seq.invoice += 1;
  const targets = state.documents.delivery.filter(n=>noteIds.includes(n.id));
  const total = targets.reduce((s,n)=>s+n.total, 0);
  targets.forEach(n=> n.invoiced = true);
  const doc = { id:'IV'+state.seq.invoice, date: todayLabel(), customer, total, noteIds, items: targets, paid:false, createdAt: Date.now() };
  state.documents.invoice.unshift(doc);
  persist();
  pushRecord('請求書', { id:doc.id, date:doc.date, customer:doc.customer, total:doc.total, noteCount:doc.items.length, paid:doc.paid });
  return doc;
}
export function unpaidInvoicesFor(customer){
  return state.documents.invoice.filter(inv=>!customer || inv.customer===customer).filter(inv=>!inv.paid);
}
export function markInvoicePaid(invoiceId){
  const inv = state.documents.invoice.find(i=>i.id===invoiceId);
  if(inv){ inv.paid = true; persist(); }
  return inv;
}

/* ---------- 領収書 ---------- */
export function createReceipt({ customer, amount, method, refInvoiceId, memo }){
  state.seq.receipt += 1;
  if(refInvoiceId) markInvoicePaid(refInvoiceId);
  const doc = { id:'R'+state.seq.receipt, date: todayLabel(), customer, amount, method: method||'振込', refInvoiceId: refInvoiceId||null, memo: memo||'', createdAt: Date.now() };
  state.documents.receipt.unshift(doc);
  persist();
  pushRecord('領収書', { id:doc.id, date:doc.date, customer:doc.customer, amount:doc.amount, method:doc.method, refInvoiceId:doc.refInvoiceId, memo:doc.memo });
  return doc;
}

/* ---------- 設定 ---------- */
export function setTaxSettings(type, rate){ state.taxSettings = { type, rate }; persist(); }

/* ---------- ユーティリティ ---------- */
export function todayLabel(){
  const d = new Date();
  return `${d.getMonth()+1}月${d.getDate()}日`;
}
export function allDocumentsFlat(){
  const rows = [];
  state.documents.quote.forEach(d=> rows.push({ type:'見積書', typeKey:'quote', id:d.id, date:d.date, customer:d.customer, detail:d.detail, amt:d.total, tag: d.converted?'納品書へ変換済み':'見積中', createdAt:d.createdAt }));
  state.documents.delivery.forEach(d=> rows.push({ type:'納品書', typeKey:'delivery', id:d.id, date:d.date, customer:d.customer, detail:d.detail, amt:d.total, tag: d.reservation ? '予約中' : (d.invoiced?'請求済み':'未請求'), createdAt:d.createdAt }));
  state.documents.invoice.forEach(d=> rows.push({ type:'請求書', typeKey:'invoice', id:d.id, date:d.date, customer:d.customer, detail:`納品書${d.items.length}件分`, amt:d.total, tag: d.paid?'入金済み':'未収', createdAt:d.createdAt }));
  state.documents.receipt.forEach(d=> rows.push({ type:'領収書', typeKey:'receipt', id:d.id, date:d.date, customer:d.customer, detail:d.method, amt:d.amount, tag:'発行済み', createdAt:d.createdAt }));
  return rows.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
}

export { UNIT_OPTIONS };

/*
  kpi.js（売上分析 / KPI 集計ロジック）
  「農家の伝票」に蓄積されたデータ（納品書）から、売上分析に必要な集計だけを行う。
  UIの描画は app.js（または kpi専用の描画関数）が担当し、このファイルは
  「集計・計算」にのみ責務を絞っている。

  将来、Googleスプレッドシートやサーバー側DBがデータの正になった場合も、
  このファイルの各関数が受け取る「documents（納品書配列）」の形が同じであれば
  そのまま動作する設計にしている。
*/
import { state } from './data.js';

function monthKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthLabel(key){
  const [y,m] = key.split('-');
  return `${parseInt(m,10)}月`;
}

/* 実績のある納品書のみを対象にする（予約中は除く） */
function completedDeliveries(){
  return state.documents.delivery.filter(n=>!n.reservation);
}

/* ---------- 売上推移（月別） ---------- */
export function monthlySeries(monthsBack = 6){
  const now = new Date();
  const buckets = [];
  for(let i = monthsBack-1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${d.getMonth()+1}月`, total: 0 });
  }
  const map = Object.fromEntries(buckets.map(b=>[b.key, b]));
  completedDeliveries().forEach(n=>{
    const key = monthKey(n.createdAt || Date.now());
    if(map[key]) map[key].total += n.total;
  });
  return buckets;
}

/* ---------- 商品ランキング ---------- */
export function productRanking(){
  const agg = {};
  completedDeliveries().forEach(n=>{
    (n.items||[]).forEach(i=>{
      const revenue = Math.round(i.qty * i.price);
      if(!agg[i.name]) agg[i.name] = { name:i.name, revenue:0, qty:0 };
      agg[i.name].revenue += revenue;
      agg[i.name].qty += i.qty;
    });
  });
  return Object.values(agg).sort((a,b)=>b.revenue-a.revenue);
}

/* ---------- 顧客ランキング ---------- */
export function customerRanking(){
  const agg = {};
  completedDeliveries().forEach(n=>{
    if(!agg[n.customer]) agg[n.customer] = { name:n.customer, revenue:0, count:0 };
    agg[n.customer].revenue += n.total;
    agg[n.customer].count += 1;
  });
  return Object.values(agg).sort((a,b)=>b.revenue-a.revenue);
}

/* ---------- 平均単価 ---------- */
export function averageUnitPrice(){
  let totalAmount = 0, totalQty = 0;
  completedDeliveries().forEach(n=>{
    (n.items||[]).forEach(i=>{ totalAmount += i.qty*i.price; totalQty += i.qty; });
  });
  return totalQty > 0 ? Math.round(totalAmount/totalQty) : 0;
}

/* ---------- 粗利分析 ---------- */
export function marginAnalysis(){
  const productCost = Object.fromEntries(state.productMaster.map(p=>[p.name, p.cost||0]));
  const perProduct = {};
  let totalRevenue = 0, totalCost = 0;
  completedDeliveries().forEach(n=>{
    (n.items||[]).forEach(i=>{
      const revenue = i.qty * i.price;
      const cost = i.qty * (productCost[i.name] || 0);
      if(!perProduct[i.name]) perProduct[i.name] = { name:i.name, revenue:0, cost:0 };
      perProduct[i.name].revenue += revenue;
      perProduct[i.name].cost += cost;
      totalRevenue += revenue; totalCost += cost;
    });
  });
  const rows = Object.values(perProduct).map(p=>({
    ...p, margin: p.revenue - p.cost,
    marginRate: p.revenue > 0 ? Math.round((p.revenue-p.cost)/p.revenue*100) : 0,
  })).sort((a,b)=>b.margin-a.margin);
  const totalMargin = totalRevenue - totalCost;
  return {
    rows,
    totalRevenue: Math.round(totalRevenue),
    totalCost: Math.round(totalCost),
    totalMargin: Math.round(totalMargin),
    totalMarginRate: totalRevenue > 0 ? Math.round(totalMargin/totalRevenue*100) : 0,
  };
}

/* ---------- 前年比較 ---------- */
export function yoyComparison(monthsBack = 6){
  const current = monthlySeries(monthsBack);
  const rows = current.map(b=>{
    const now = new Date();
    const idx = current.indexOf(b);
    const d = new Date(now.getFullYear()-1, now.getMonth()-(monthsBack-1-idx), 1);
    const lastYearKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const lastYearTotal = state.lastYearMonthly[lastYearKey] || null;
    return { label:b.label, thisYear:b.total, lastYear:lastYearTotal };
  });
  return rows;
}

/* ---------- CSV出力 ---------- */
export function toCSV(){
  const header = ['種別','日付','取引先','内容','金額','ステータス'];
  const rows = [header.join(',')];
  const push = (type, date, customer, detail, amt, tag)=>{
    const esc = (v)=> `"${String(v).replace(/"/g,'""')}"`;
    rows.push([esc(type), esc(date), esc(customer), esc(detail), amt, esc(tag)].join(','));
  };
  state.documents.quote.forEach(d=> push('見積書', d.date, d.customer, d.detail, d.total, d.converted?'変換済み':'見積中'));
  state.documents.delivery.forEach(d=> push('納品書', d.date, d.customer, d.detail, d.total, d.reservation?'予約中':(d.invoiced?'請求済み':'未請求')));
  state.documents.invoice.forEach(d=> push('請求書', d.date, d.customer, `納品書${d.items.length}件分`, d.total, d.paid?'入金済み':'未収'));
  state.documents.receipt.forEach(d=> push('領収書', d.date, d.customer, d.method, d.amount, '発行済み'));
  return rows.join('\r\n');
}

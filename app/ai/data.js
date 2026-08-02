/*
  data.js（農家の販売担当AI）
  データ取得の優先順位：
    1. Googleスプレッドシート（Apps Script経由・doGet）にデータがあればそれを使う
    2. なければ、同一オリジンに配置された「農家の伝票」のlocalStorage（nouka-denpyo:v2）を使う
    3. どちらも無ければ「データがまだありません」という空の状態を返す

  この優先順位にしている理由：
  ・スプレッドシート連携をONにしている場合は、複数端末・複数人での利用を想定し、
    より"共有された正"に近いスプレッドシートを優先する
  ・連携していない場合でも、同じブラウザで「農家の伝票」を使っていればすぐに分析できるようにする
*/
import { loadJSON, saveJSON } from '../../assets/js/storage.js';

const DENPYO_KEY = 'nouka-denpyo:v2';
const SHEETS_CONFIG_KEY = 'nouka-sheets-config:v1';
const AI_LOCAL_KEY = 'nouka-ai:v2';

function getSheetsConfig(){
  return loadJSON(SHEETS_CONFIG_KEY, { url:'', enabled:false });
}

async function fetchSheet(type){
  const cfg = getSheetsConfig();
  if(!cfg.enabled || !cfg.url) return null;
  try{
    const res = await fetch(`${cfg.url}?type=${encodeURIComponent(type)}`);
    const data = await res.json();
    return (data && data.ok) ? data.rows : null;
  }catch(err){
    console.warn('[ai/data] fetchSheet failed', err);
    return null;
  }
}

function getLocalSnapshot(){
  return loadJSON(DENPYO_KEY, null);
}

/* ---------- AI固有のローカル状態（提案の採用/見送り状態など） ---------- */
function seedAiLocal(){ return { proposalStatus:{} }; }
export let aiState = loadJSON(AI_LOCAL_KEY, null) || seedAiLocal();
export function persistAi(){ saveJSON(AI_LOCAL_KEY, aiState); }

/* ---------- データソースの判定 ---------- */
export async function getDataSourceLabel(){
  const cfg = getSheetsConfig();
  if(cfg.enabled && cfg.url){
    const rows = await fetchSheet('納品書');
    if(rows && rows.length) return 'sheets';
  }
  return getLocalSnapshot() ? 'local' : 'none';
}

/* ---------- 集計用の共通データ取得 ---------- */
async function loadDeliveries(){
  const cfg = getSheetsConfig();
  if(cfg.enabled && cfg.url){
    const rows = await fetchSheet('納品書');
    if(rows && rows.length){
      return rows
        .filter(r=> String(r['予約']) !== 'true')
        .map(r=>({
          customer: r['顧客'],
          total: Number(r['合計金額']) || 0,
          date: r['納品日'],
          detail: r['明細'],
          items: safeParseItems(r['明細JSON']),
          invoiced: String(r['請求済み']) === 'true',
        }));
    }
  }
  const snap = getLocalSnapshot();
  if(!snap) return null;
  return (snap.documents && snap.documents.delivery ? snap.documents.delivery : [])
    .filter(n=>!n.reservation)
    .map(n=>({ customer:n.customer, total:n.total, date:n.date, detail:n.detail, items:n.items||[], invoiced:n.invoiced }));
}
function safeParseItems(v){
  if(!v) return [];
  try{ return JSON.parse(v); }catch(e){ return []; }
}

async function loadProductPrices(){
  const cfg = getSheetsConfig();
  if(cfg.enabled && cfg.url){
    const rows = await fetchSheet('商品');
    if(rows && rows.length){
      return rows.map(r=>({ name:r['商品名'], unit:r['規格'], price:Number(r['標準価格'])||0 }));
    }
  }
  const snap = getLocalSnapshot();
  return snap && snap.productMaster ? snap.productMaster : [];
}

/* ---------- 分析サマリー ---------- */
export async function summarize(){
  const deliveries = await loadDeliveries();
  if(!deliveries || deliveries.length===0) return null;

  const totalSales = deliveries.reduce((s,n)=>s+n.total, 0);
  const byCustomer = {};
  const byItem = {};
  deliveries.forEach(n=>{
    byCustomer[n.customer] = (byCustomer[n.customer]||0) + n.total;
    (n.items||[]).forEach(i=>{
      const sub = Math.round((i.qty||0) * (i.price||0));
      if(sub>0) byItem[i.name] = (byItem[i.name]||0) + sub;
    });
  });
  const latest = deliveries[0];
  const unbilled = deliveries.filter(n=>!n.invoiced).length;

  return { totalSales, byCustomer, byItem, latest, unbilled };
}

export async function priceReference(itemName){
  const products = await loadProductPrices();
  const p = products.find(p=>p.name===itemName);
  return p ? p.price : null;
}

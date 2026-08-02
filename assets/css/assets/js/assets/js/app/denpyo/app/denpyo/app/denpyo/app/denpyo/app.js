/*
  app.js（農家の伝票 v2）
  画面遷移・イベント処理・描画。データの読み書きは data.js に委譲する。
*/
import { login, isLoggedIn } from '../../assets/js/auth.js';
import { isSubscribed, subscribe } from '../../assets/js/billing.js';
import {
  state, persist, UNIT_OPTIONS, todayLabel,
  sortedCustomers, itemsForCustomer, lastDealFor, recordUsage,
  addCustomer, addProduct, updateProduct,
  calcTotals, createQuote, convertQuoteToDelivery, createDeliveryNote, unbilledNotesFor,
  createInvoice, unpaidInvoicesFor, markInvoicePaid, createReceipt,
  setTaxSettings, allDocumentsFlat,
} from './data.js';
import {
  monthlySeries, productRanking, customerRanking, averageUnitPrice,
  marginAnalysis, yoyComparison, toCSV,
} from './kpi.js';
import { getSyncConfig, setSyncConfig, testConnection } from './sheetsSync.js';

/* ---------- 画面遷移 ---------- */
const NAV_GROUPS = {
  'screen-dashboard':'dashboard',
  'screen-documents':'documents',
  'screen-customers':'customers',
  'screen-products':'products',
  'screen-settings':'settings',
};
function go(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
  const nav = document.getElementById('bottomNav');
  const group = NAV_GROUPS[id];
  if(group){
    nav.classList.add('show');
    nav.querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.group===group));
  } else {
    nav.classList.remove('show');
  }
  if(id==='screen-dashboard') renderDashboard();
  if(id==='screen-documents') renderDocumentSearch();
  if(id==='screen-customers') renderCustomerList();
  if(id==='screen-products') renderProductTable();
  if(id==='screen-settings') renderSettings();
  if(id==='screen-kpi-dashboard') renderKpiDashboard();
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}
function togglePanel(id){ document.getElementById(id).classList.toggle('show'); }
function cssSafe(s){ return s.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠]/g,'_'); }

document.addEventListener('click', (e)=>{
  const goEl = e.target.closest('[data-go]');
  if(goEl){ go(goEl.dataset.go); return; }
  const toastEl = e.target.closest('[data-toast]');
  if(toastEl){ toast(toastEl.dataset.toast); return; }
});

/* ---------- ログイン ---------- */
document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  await login(email, password);
  go('screen-dashboard');
});
if(isLoggedIn()) go('screen-dashboard');

/* ---------- ダッシュボード ---------- */
function renderDashboard(){
  document.getElementById('greeting').textContent = `${state.farmName}さん、こんにちは`;
  document.getElementById('greetingDate').textContent = new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
  document.getElementById('unbilledCount').textContent = unbilledNotesFor_all().length + '件';
  document.getElementById('unpaidCount').textContent = unpaidInvoicesFor(null).length + '件';

  const list = document.getElementById('recentList');
  list.innerHTML = '';
  allDocumentsFlat().slice(0,5).forEach(r=>{
    const el = document.createElement('div');
    el.className = 'note-row';
    const tagClass = r.tag.includes('請求済') || r.tag.includes('入金済') || r.tag.includes('発行済') ? 'ok' : (r.tag.includes('未') ? 'pend' : 'pend');
    el.innerHTML = `<div class="n-main"><div class="n-name">[${r.type}] ${r.customer}</div><div class="n-date">${r.date}</div>
      <span class="status-tag ${tagClass}">${r.tag}</span></div>
      <div class="n-amt">¥${r.amt.toLocaleString()}</div>`;
    list.appendChild(el);
  });
  document.getElementById('kpiLockDot').style.display = isSubscribed('kpi') ? 'none' : 'flex';
}
function unbilledNotesFor_all(){
  return state.documents.delivery.filter(n=>!n.invoiced && !n.reservation);
}
document.getElementById('kpiEntry').addEventListener('click', goKpi);
document.getElementById('kpiSettingsBtn').addEventListener('click', goKpi);
function goKpi(){ go(isSubscribed('kpi') ? 'screen-kpi-dashboard' : 'screen-kpi-intro'); }
document.getElementById('subscribeKpiBtn').addEventListener('click', async ()=>{
  await subscribe('kpi');
  toast('ご加入ありがとうございます');
  setTimeout(()=>go('screen-kpi-dashboard'), 300);
});

/* ---------- 書類フロー（見積書・納品書 共通） ---------- */
let flow = { docType:'delivery', mode:'new', isReservation:false, dateLabel:'', customer:null, selectedItems:[], unitPrice:{}, quoteId:null };

document.getElementById('tileQuote').addEventListener('click', ()=>startDocFlow('quote'));
document.getElementById('tileDelivery').addEventListener('click', ()=>startDocFlow('delivery'));
document.getElementById('tileInvoice').addEventListener('click', ()=>startInvoiceFlow(null));
document.getElementById('tileReceipt').addEventListener('click', startReceiptFlow);

function startDocFlow(type){
  flow = { docType:type, mode:'new', isReservation:false, dateLabel:todayLabel(), customer:null, selectedItems:[], unitPrice:{}, quoteId:null };
  if(type==='delivery'){
    document.getElementById('todayLabel').textContent = `今日（${todayLabel()}）`;
    document.getElementById('opt-today').classList.add('selected');
    document.getElementById('opt-future').classList.remove('selected');
    document.getElementById('datePicker').style.display = 'none';
    go('screen-doc-date');
  } else {
    goCustomer();
  }
}
document.getElementById('opt-today').addEventListener('click', ()=>{
  flow.isReservation = false; flow.dateLabel = todayLabel();
  document.getElementById('opt-today').classList.add('selected');
  document.getElementById('opt-future').classList.remove('selected');
  document.getElementById('datePicker').style.display = 'none';
});
document.getElementById('opt-future').addEventListener('click', ()=>{
  document.getElementById('opt-future').classList.add('selected');
  document.getElementById('opt-today').classList.remove('selected');
  document.getElementById('datePicker').style.display = 'block';
});
document.getElementById('datePicker').addEventListener('change', (e)=>{
  flow.isReservation = true;
  const d = new Date(e.target.value);
  if(!isNaN(d)) flow.dateLabel = `${d.getMonth()+1}月${d.getDate()}日`;
});
document.getElementById('dateNextBtn').addEventListener('click', ()=>{
  if(flow.mode === 'convert'){
    const doc = convertQuoteToDelivery(flow.quoteId, { isReservation: flow.isReservation, dateLabel: flow.dateLabel });
    if(doc) finishDoc(doc, 'delivery');
  } else {
    goCustomer();
  }
});

function goCustomer(){
  document.getElementById('docCustomerTitle').textContent = flow.docType==='quote' ? '見積先を選んでください' : '納品先を選んでください';
  renderCustomerChips();
  go('screen-doc-customer');
}
document.getElementById('docCustomerBack').addEventListener('click', ()=>{
  go(flow.docType==='delivery' ? 'screen-doc-date' : 'screen-dashboard');
});
function renderCustomerChips(){
  const wrap = document.getElementById('customerChips'); wrap.innerHTML = '';
  sortedCustomers().forEach((c,i)=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (i===0 ? ' top-pick' : '');
    chip.textContent = c.name;
    chip.addEventListener('click', ()=>selectCustomer(c.name));
    wrap.appendChild(chip);
  });
  document.getElementById('customerAddPanel').classList.remove('show');
}
document.getElementById('showCustomerAddPanel').addEventListener('click', ()=>togglePanel('customerAddPanel'));
document.getElementById('addCustomerBtn').addEventListener('click', ()=>{
  const val = document.getElementById('newCustomerInput').value.trim();
  if(!val){ toast('顧客名を入力してください'); return; }
  addCustomer(val);
  selectCustomer(val);
});
function selectCustomer(name){ flow.customer = name; renderItemChips(); go('screen-doc-item'); }

function renderItemChips(){
  const wrap = document.getElementById('itemChips'); wrap.innerHTML = ''; flow.selectedItems = [];
  const { list, personalized } = itemsForCustomer(flow.customer);
  document.getElementById('itemSubtitle').textContent = personalized ? 'このお客様によく出す商品' : 'よく使う商品';
  list.forEach((it,i)=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (i===0 ? ' top-pick' : '');
    chip.textContent = it.name;
    chip.addEventListener('click', ()=>toggleItem(chip, it.name));
    wrap.appendChild(chip);
  });
  document.getElementById('itemAddPanel').classList.remove('show');
  updateItemNextBtn();
}
document.getElementById('showItemAddPanel').addEventListener('click', ()=>togglePanel('itemAddPanel'));
document.getElementById('addItemBtn').addEventListener('click', ()=>{
  const val = document.getElementById('newItemInput').value.trim();
  if(!val){ toast('商品名を入力してください'); return; }
  addProduct(val, 'キロ', 0);
  const wrap = document.getElementById('itemChips');
  const chip = document.createElement('div');
  chip.className = 'chip selected'; chip.textContent = val;
  chip.addEventListener('click', ()=>toggleItem(chip, val));
  wrap.appendChild(chip);
  flow.selectedItems.push(val);
  document.getElementById('newItemInput').value = '';
  document.getElementById('itemAddPanel').classList.remove('show');
  updateItemNextBtn();
});
function toggleItem(chip, name){
  chip.classList.toggle('selected');
  if(chip.classList.contains('selected')) flow.selectedItems.push(name);
  else flow.selectedItems = flow.selectedItems.filter(n=>n!==name);
  updateItemNextBtn();
}
function updateItemNextBtn(){
  const btn = document.getElementById('itemNextBtn');
  const n = flow.selectedItems.length;
  btn.disabled = n===0;
  btn.textContent = `次へ（${n}品目選択中）`;
}
document.getElementById('itemNextBtn').addEventListener('click', goConfirm);

function goConfirm(){
  document.getElementById('docConfirmTitle').textContent = flow.docType==='quote' ? '見積内容を確認' : '数量と単価を確認';
  document.getElementById('validDaysField').style.display = flow.docType==='quote' ? 'block' : 'none';
  renderConfirmCards();
  go('screen-doc-confirm');
}

function renderConfirmCards(){
  const wrap = document.getElementById('itemCards'); wrap.innerHTML = ''; flow.unitPrice = {};
  flow.selectedItems.forEach(name=>{
    const deal = lastDealFor(flow.customer, name);
    flow.unitPrice[name] = { qty:10, price:deal.price, unit:deal.unit };
    const key = cssSafe(name);
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <h3>【${name}】</h3>
      <div class="unit-row">${UNIT_OPTIONS.map(u=>`<div class="unit-chip${u===deal.unit?' selected':''}" data-unit="${u}">${u}</div>`).join('')}</div>
      <div class="qty-row">
        <button class="qty-btn" data-step="-1">－</button>
        <input class="qty-input" type="number" id="qty-${key}" value="10">
        <button class="qty-btn" data-step="1">＋</button>
      </div>
      <div class="price-row">単価 ¥ <input type="number" id="price-${key}" value="${deal.price}"> <span style="font-size:11.5px; color:var(--ink-faint); font-weight:400;">（前回と同じ）</span></div>
      <div class="subtotal-line" id="subtotal-${key}">小計 ¥${(10*deal.price).toLocaleString()}</div>`;
    wrap.appendChild(card);

    card.querySelectorAll('.unit-chip').forEach(el=>{
      el.addEventListener('click', ()=>{
        card.querySelectorAll('.unit-chip').forEach(c=>c.classList.remove('selected'));
        el.classList.add('selected');
        flow.unitPrice[name].unit = el.dataset.unit;
      });
    });
    card.querySelector('[data-step="-1"]').addEventListener('click', ()=>stepQty(name, key, -1));
    card.querySelector('[data-step="1"]').addEventListener('click', ()=>stepQty(name, key, 1));
    card.querySelector(`#qty-${key}`).addEventListener('change', (e)=>{ flow.unitPrice[name].qty = parseFloat(e.target.value)||0; updateSubtotal(name, key); });
    card.querySelector(`#price-${key}`).addEventListener('change', (e)=>{ flow.unitPrice[name].price = parseFloat(e.target.value)||0; updateSubtotal(name, key); });
  });
  updateTaxSummary();
}
function stepQty(name, key, delta){
  const input = document.getElementById('qty-'+key);
  let v = parseFloat(input.value)||0; v = Math.max(1, v+delta); input.value = v;
  flow.unitPrice[name].qty = v; updateSubtotal(name, key);
}
function updateSubtotal(name, key){
  const d = flow.unitPrice[name];
  document.getElementById('subtotal-'+key).textContent = '小計 ¥' + Math.round(d.qty*d.price).toLocaleString();
  updateTaxSummary();
}
function updateTaxSummary(){
  const items = flow.selectedItems.map(n=>({ name:n, ...flow.unitPrice[n] }));
  const { taxBase, taxAmount, total } = calcTotals(items);
  document.getElementById('taxSummary').innerHTML = `
    <div class="tax-line"><span>小計（税抜）</span><span>¥${taxBase.toLocaleString()}</span></div>
    <div class="tax-line"><span>消費税（${state.taxSettings.rate}%）</span><span>¥${taxAmount.toLocaleString()}</span></div>
    <div class="tax-line total"><span>合計</span><span>¥${total.toLocaleString()}</span></div>`;
  window.__lastTotal = total;
  const btn = document.getElementById('confirmBtn');
  btn.textContent = flow.docType==='quote' ? '見積書を作成する' : (flow.isReservation ? '予約する' : '記録する');
}

document.getElementById('confirmBtn').addEventListener('click', ()=>{
  const items = flow.selectedItems.map(n=>({ name:n, qty:flow.unitPrice[n].qty, unit:flow.unitPrice[n].unit, price:flow.unitPrice[n].price }));
  const memo = document.getElementById('memoInput').value;
  let doc;
  if(flow.docType==='quote'){
    const validDays = parseInt(document.getElementById('validDaysInput').value, 10);
    doc = createQuote({ customer:flow.customer, items, memo, validDays });
  } else {
    doc = createDeliveryNote({ date:flow.dateLabel, customer:flow.customer, items, memo, isReservation:flow.isReservation });
  }
  finishDoc(doc, flow.docType);
});

function finishDoc(doc, type){
  const label = type==='quote' ? '見積書' : '納品書';
  document.getElementById('stampMsg').textContent = (type==='delivery' && doc.reservation) ? '予約を登録しました' : `${label}を作成しました`;
  document.getElementById('stampSub').textContent = `${doc.customer}・¥${doc.total.toLocaleString()}`;
  renderDocPdf(doc, type);
  go('screen-doc-stamp');
}

function renderDocPdf(doc, type){
  const title = type==='quote' ? '見積書' : '納品書';
  document.getElementById('docPdfTitle').textContent = title;
  const rows = doc.items.map(i=>`<div class="pm-row"><span>${i.name}（${i.unit}）</span><span>${i.qty} × ¥${i.price} = ¥${Math.round(i.qty*i.price).toLocaleString()}</span></div>`).join('');
  const extra = type==='quote' ? `<div class="pm-row"><span>有効期限</span><span>発行から${doc.validDays}日間</span></div>` : '';
  document.getElementById('pdfSheet').innerHTML = `
    <div class="pm-title">${title}</div>
    <div class="pm-row"><span>${type==='quote'?'見積日':'納品日'}</span><span>${doc.date}</span></div>
    <div class="pm-row"><span>${type==='quote'?'見積先':'納品先'}</span><span>${doc.customer} 様</span></div>
    <div class="pm-row"><span>発行元</span><span>${state.farmName}</span></div>
    ${extra}
    ${rows}
    <div class="pm-total"><span>合計（税込）</span><span>¥${doc.total.toLocaleString()}</span></div>`;

  const convertBtn = document.getElementById('convertBtn');
  if(type==='quote'){
    convertBtn.textContent = doc.converted ? '納品書に変換済みです' : 'ワンタップで納品書を作成';
    convertBtn.disabled = !!doc.converted;
    convertBtn.onclick = ()=> startConvertFlow(doc.id);
  } else {
    convertBtn.textContent = 'この顧客の請求書をワンタップで作成';
    convertBtn.disabled = false;
    convertBtn.onclick = ()=> startInvoiceFlow(doc.customer);
  }
}

function startConvertFlow(quoteId){
  const q = state.documents.quote.find(d=>d.id===quoteId);
  if(!q) return;
  flow = { docType:'delivery', mode:'convert', quoteId, customer:q.customer, isReservation:false, dateLabel:todayLabel(), selectedItems:[], unitPrice:{} };
  document.getElementById('todayLabel').textContent = `今日（${todayLabel()}）`;
  document.getElementById('opt-today').classList.add('selected');
  document.getElementById('opt-future').classList.remove('selected');
  document.getElementById('datePicker').style.display = 'none';
  go('screen-doc-date');
}

/* ---------- 請求書作成フロー ---------- */
let invoiceFlow = { customer:null };
function startInvoiceFlow(customer){
  invoiceFlow = { customer: customer || null };
  renderInvoiceCustomerChips();
  renderInvoiceItems();
  go('screen-invoice-setup');
}
function renderInvoiceCustomerChips(){
  const wrap = document.getElementById('invoiceCustomerChips'); wrap.innerHTML = '';
  state.customerMaster.forEach(c=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (c.name===invoiceFlow.customer ? ' selected' : '');
    chip.textContent = c.name;
    chip.addEventListener('click', ()=>{ invoiceFlow.customer = c.name; renderInvoiceCustomerChips(); renderInvoiceItems(); });
    wrap.appendChild(chip);
  });
}
function renderInvoiceItems(){
  const wrap = document.getElementById('invoiceItemsWrap');
  const issueBtn = document.getElementById('invoiceIssueBtn');
  if(!invoiceFlow.customer){ wrap.innerHTML = '<div class="helper-note">顧客を選ぶと対象の納品書が表示されます</div>'; issueBtn.disabled = true; return; }
  const targets = unbilledNotesFor(invoiceFlow.customer);
  if(targets.length===0){ wrap.innerHTML = '<div class="helper-note">この顧客には、未請求の納品書がありません。</div>'; issueBtn.disabled = true; return; }
  issueBtn.disabled = false;
  const total = targets.reduce((s,n)=>s+n.total, 0);
  const rows = targets.map(n=>`<div class="note-row"><div class="n-main"><div class="n-name">${n.date}</div><div class="n-date">${n.detail}</div></div><div class="n-amt">¥${n.total.toLocaleString()}</div></div>`).join('');
  wrap.innerHTML = `<div class="section-title">対象の納品書（${targets.length}件・未請求）</div>${rows}
    <div class="tax-summary" style="margin-top:10px;"><div class="tax-line total"><span>合計（税込）</span><span>¥${total.toLocaleString()}</span></div></div>`;
  window.__invoiceTargetIds = targets.map(n=>n.id);
}
document.getElementById('invoiceIssueBtn').addEventListener('click', ()=>{
  if(!invoiceFlow.customer || !window.__invoiceTargetIds || window.__invoiceTargetIds.length===0) return;
  const invoice = createInvoice(invoiceFlow.customer, window.__invoiceTargetIds);
  renderInvoicePdf(invoice);
  go('screen-invoice-pdf');
});
function renderInvoicePdf(inv){
  const rows = inv.items.map(n=>`<div class="pm-row"><span>${n.date}</span><span>${n.detail} ／ ¥${n.total.toLocaleString()}</span></div>`).join('');
  document.getElementById('invoicePdfSheet').innerHTML = `
    <div class="pm-title">請求書</div>
    <div class="pm-row"><span>請求先</span><span>${inv.customer} 様</span></div>
    <div class="pm-row"><span>発行元</span><span>${state.farmName}</span></div>
    <div class="pm-row"><span>対象</span><span>納品書 ${inv.items.length}件</span></div>
    ${rows}
    <div class="pm-total"><span>合計（税込）</span><span>¥${inv.total.toLocaleString()}</span></div>`;
  document.getElementById('toReceiptBtn').onclick = ()=> openReceiptFromInvoice(inv.id);
}

/* ---------- 領収書フロー ---------- */
function startReceiptFlow(){
  document.getElementById('receiptModeInvoice').classList.add('selected');
  document.getElementById('receiptModeStandalone').classList.remove('selected');
  document.getElementById('receiptInvoicePane').style.display = 'block';
  document.getElementById('receiptStandalonePane').style.display = 'none';
  renderUnpaidInvoiceList();
  go('screen-receipt-setup');
}
document.getElementById('receiptModeInvoice').addEventListener('click', ()=>{
  document.getElementById('receiptModeInvoice').classList.add('selected');
  document.getElementById('receiptModeStandalone').classList.remove('selected');
  document.getElementById('receiptInvoicePane').style.display = 'block';
  document.getElementById('receiptStandalonePane').style.display = 'none';
  renderUnpaidInvoiceList();
});
document.getElementById('receiptModeStandalone').addE

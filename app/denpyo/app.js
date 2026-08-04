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
document.getElementById('receiptModeStandalone').addEventListener('click', ()=>{
  document.getElementById('receiptModeStandalone').classList.add('selected');
  document.getElementById('receiptModeInvoice').classList.remove('selected');
  document.getElementById('receiptStandalonePane').style.display = 'block';
  document.getElementById('receiptInvoicePane').style.display = 'none';
  renderReceiptCustomerChips();
});
function renderUnpaidInvoiceList(){
  const wrap = document.getElementById('unpaidInvoiceList');
  const list = unpaidInvoicesFor(null);
  if(list.length===0){ wrap.innerHTML = '<div class="helper-note">未収の請求書はありません。</div>'; return; }
  wrap.innerHTML = '';
  list.forEach(inv=>{
    const el = document.createElement('div'); el.className = 'note-row'; el.style.cursor = 'pointer';
    el.innerHTML = `<div class="n-main"><div class="n-name">${inv.customer}</div><div class="n-date">請求書 ${inv.id}</div></div><div class="n-amt">¥${inv.total.toLocaleString()}</div>`;
    el.addEventListener('click', ()=> openReceiptFromInvoice(inv.id));
    wrap.appendChild(el);
  });
}
function openReceiptFromInvoice(invoiceId){
  const inv = state.documents.invoice.find(i=>i.id===invoiceId);
  if(!inv) return;
  const doc = createReceipt({ customer:inv.customer, amount:inv.total, method:'振込', refInvoiceId:inv.id });
  renderReceiptPdf(doc);
  toast('入金を記録しました');
  go('screen-receipt-pdf');
}
function renderReceiptCustomerChips(){
  const wrap = document.getElementById('receiptCustomerChips'); wrap.innerHTML = '';
  window.__receiptCustomer = null;
  state.customerMaster.forEach(c=>{
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = c.name;
    chip.addEventListener('click', ()=>{
      wrap.querySelectorAll('.chip').forEach(x=>x.classList.remove('selected'));
      chip.classList.add('selected');
      window.__receiptCustomer = c.name;
    });
    wrap.appendChild(chip);
  });
}
document.getElementById('issueStandaloneReceiptBtn').addEventListener('click', ()=>{
  if(!window.__receiptCustomer){ toast('顧客を選んでください'); return; }
  const amount = parseFloat(document.getElementById('receiptAmountInput').value) || 0;
  if(amount<=0){ toast('金額を入力してください'); return; }
  const method = document.getElementById('receiptMethodInput').value;
  const memo = document.getElementById('receiptMemoInput').value;
  const doc = createReceipt({ customer:window.__receiptCustomer, amount, method, refInvoiceId:null, memo });
  renderReceiptPdf(doc);
  go('screen-receipt-pdf');
});
function renderReceiptPdf(doc){
  document.getElementById('receiptPdfSheet').innerHTML = `
    <div class="pm-title">領収書</div>
    <div class="pm-row"><span>発行日</span><span>${doc.date}</span></div>
    <div class="pm-row"><span>宛先</span><span>${doc.customer} 様</span></div>
    <div class="pm-row"><span>受領方法</span><span>${doc.method}</span></div>
    ${doc.memo ? `<div class="pm-row"><span>但し書き</span><span>${doc.memo}</span></div>` : ''}
    <div class="pm-total"><span>金額（税込）</span><span>¥${doc.amount.toLocaleString()}</span></div>`;
}

/* ---------- 顧客管理 ---------- */
function renderCustomerList(filter){
  filter = filter || document.getElementById('customerSearch').value;
  const wrap = document.getElementById('customerList'); wrap.innerHTML = '';
  state.customerMaster.filter(c=>!filter || c.name.includes(filter)).forEach(c=>{
    const el = document.createElement('div'); el.className = 'list-row';
    el.innerHTML = `<div><div class="l-name">${c.name}</div><div class="l-sub">利用回数 ${c.freq}回</div></div><div class="l-edit" data-toast="編集画面は準備中です">編集</div>`;
    wrap.appendChild(el);
  });
}
document.getElementById('customerSearch').addEventListener('input', (e)=>renderCustomerList(e.target.value));
document.getElementById('showMgmtCustomerAddPanel').addEventListener('click', ()=>togglePanel('mgmtCustomerAddPanel'));
document.getElementById('mgmtAddCustomerBtn').addEventListener('click', ()=>{
  const val = document.getElementById('mgmtNewCustomer').value.trim();
  if(!val){ toast('顧客名を入力してください'); return; }
  addCustomer(val);
  document.getElementById('mgmtNewCustomer').value = '';
  document.getElementById('mgmtCustomerAddPanel').classList.remove('show');
  renderCustomerList();
  toast('顧客を追加しました');
});

/* ---------- 商品管理 ---------- */
function renderProductTable(filter){
  filter = filter || document.getElementById('productSearch').value;
  const table = document.getElementById('productTable');
  let html = '<tr><th>商品名</th><th>規格</th><th class="num">標準価格</th><th class="num">原価</th></tr>';
  state.productMaster.forEach((p,i)=>{
    if(filter && !p.name.includes(filter)) return;
    html += `<tr>
      <td>${p.name}</td>
      <td><select data-idx="${i}" data-field="unit">${UNIT_OPTIONS.map(u=>`<option${u===p.unit?' selected':''}>${u}</option>`).join('')}</select></td>
      <td class="num">¥<input type="number" value="${p.price}" data-idx="${i}" data-field="price"></td>
      <td class="num">¥<input type="number" value="${p.cost||0}" data-idx="${i}" data-field="cost"></td>
    </tr>`;
  });
  table.innerHTML = html;
  table.querySelectorAll('[data-idx]').forEach(el=>{
    el.addEventListener('change', (e)=>{
      const i = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      const value = (field==='price'||field==='cost') ? (parseFloat(e.target.value)||0) : e.target.value;
      updateProduct(i, { [field]: value });
      toast('商品情報を更新しました');
    });
  });
}
document.getElementById('productSearch').addEventListener('input', (e)=>renderProductTable(e.target.value));
document.getElementById('showMgmtProductAddPanel').addEventListener('click', ()=>togglePanel('mgmtProductAddPanel'));
document.getElementById('mgmtAddProductBtn').addEventListener('click', ()=>{
  const name = document.getElementById('mgmtNewProductName').value.trim();
  const price = parseFloat(document.getElementById('mgmtNewProductPrice').value) || 0;
  const cost = parseFloat(document.getElementById('mgmtNewProductCost').value) || 0;
  if(!name){ toast('商品名を入力してください'); return; }
  addProduct(name, 'キロ', price, cost);
  document.getElementById('mgmtNewProductName').value = '';
  document.getElementById('mgmtNewProductPrice').value = '';
  document.getElementById('mgmtNewProductCost').value = '';
  document.getElementById('mgmtProductAddPanel').classList.remove('show');
  renderProductTable();
  toast('商品を追加しました');
});

/* ---------- 書類検索 ---------- */
function renderDocumentSearch(){
  const filter = document.getElementById('docSearch').value;
  const typeFilter = document.getElementById('docTypeFilter').value;
  const wrap = document.getElementById('documentSearchList'); wrap.innerHTML = '';
  let rows = allDocumentsFlat();
  if(typeFilter !== 'all') rows = rows.filter(r=>r.typeKey===typeFilter);
  rows = rows.filter(r=> !filter || r.customer.includes(filter) || r.detail.includes(filter));
  if(rows.length===0){ wrap.innerHTML = '<div class="helper-note">該当する書類が見つかりませんでした</div>'; return; }
  rows.forEach(r=>{
    const el = document.createElement('div'); el.className = 'list-row';
    el.innerHTML = `<div><div class="l-name">[${r.type}] ${r.customer}</div><div class="l-sub">${r.date}・${r.detail}</div></div><div style="text-align:right;"><div style="font-weight:600;">¥${r.amt.toLocaleString()}</div><div class="l-sub">${r.tag}</div></div>`;
    wrap.appendChild(el);
  });
}
document.getElementById('docSearch').addEventListener('input', renderDocumentSearch);
document.getElementById('docTypeFilter').addEventListener('change', renderDocumentSearch);

/* ---------- 設定 ---------- */
function renderSettings(){
  document.getElementById('settingsFarmName').textContent = state.farmName;
  document.getElementById('regNoInput').value = state.invoiceRegNo;
  document.getElementById('bankInfoInput').value = state.bankInfo;
  document.getElementById('segIn').classList.toggle('active', state.taxSettings.type==='inclusive');
  document.getElementById('segEx').classList.toggle('active', state.taxSettings.type==='exclusive');
  document.getElementById('rate8').classList.toggle('active', state.taxSettings.rate===8);
  document.getElementById('rate10').classList.toggle('active', state.taxSettings.rate===10);
  document.getElementById('kpiSettingsSub').textContent = isSubscribed('kpi') ? '加入中（月額¥980）' : '未加入';

  const cfg = getSyncConfig();
  document.getElementById('sheetsUrlInput').value = cfg.url || '';
  document.getElementById('sheetsOn').classList.toggle('active', cfg.enabled);
  document.getElementById('sheetsOff').classList.toggle('active', !cfg.enabled);
  renderSheetsStatus(cfg);
}
function renderSheetsStatus(cfg){
  const note = document.getElementById('sheetsStatusNote');
  if(!cfg.url){ note.textContent = '未設定です。設定方法はREADME-google-sheets.mdをご覧ください。'; return; }
  if(!cfg.enabled){ note.textContent = 'URLは設定済みですが、同期はOFFになっています。'; return; }
  if(cfg.lastError){ note.textContent = `直近の同期でエラーが発生しました：${cfg.lastError}`; return; }
  note.textContent = cfg.lastSyncAt ? `最終同期：${new Date(cfg.lastSyncAt).toLocaleString('ja-JP')}` : 'まだ同期履歴はありません（書類を作成すると自動送信されます）。';
}
document.getElementById('sheetsOn').addEventListener('click', ()=>{ setSyncConfig({ enabled:true }); renderSettings(); toast('スプレッドシート連携をONにしました'); });
document.getElementById('sheetsOff').addEventListener('click', ()=>{ setSyncConfig({ enabled:false }); renderSettings(); toast('スプレッドシート連携をOFFにしました'); });
document.getElementById('sheetsUrlInput').addEventListener('change', (e)=>{ setSyncConfig({ url:e.target.value.trim() }); renderSettings(); });
document.getElementById('testSheetsBtn').addEventListener('click', async ()=>{
  const url = document.getElementById('sheetsUrlInput').value.trim();
  if(!url){ toast('URLを入力してください'); return; }
  setSyncConfig({ url });
  toast('送信しています…');
  const result = await testConnection(url);
  if(result.ok){ toast('接続に成功しました'); }
  else { toast('接続に失敗しました：' + (result.error||'')); }
  renderSettings();
});
document.getElementById('segIn').addEventListener('click', ()=>{ setTaxSettings('inclusive', state.taxSettings.rate); renderSettings(); });
document.getElementById('segEx').addEventListener('click', ()=>{ setTaxSettings('exclusive', state.taxSettings.rate); renderSettings(); });
document.getElementById('rate8').addEventListener('click', ()=>{ setTaxSettings(state.taxSettings.type, 8); renderSettings(); });
document.getElementById('rate10').addEventListener('click', ()=>{ setTaxSettings(state.taxSettings.type, 10); renderSettings(); });
document.getElementById('regNoInput').addEventListener('change', (e)=>{ state.invoiceRegNo = e.target.value; persist(); toast('登録番号を更新しました'); });
document.getElementById('bankInfoInput').addEventListener('change', (e)=>{ state.bankInfo = e.target.value; persist(); toast('振込先を更新しました'); });

/* ---------- 売上分析（KPI）ダッシュボード ---------- */
function renderKpiDashboard(){
  const series = monthlySeries(6);
  const thisMonthTotal = series[series.length-1].total;
  const yoy = yoyComparison(6);
  const lastRow = yoy[yoy.length-1];
  const yoyPct = (lastRow && lastRow.lastYear) ? Math.round((lastRow.thisYear - lastRow.lastYear)/lastRow.lastYear*100) : null;
  const margin = marginAnalysis();

  document.getElementById('kpiThisMonth').textContent = `¥${thisMonthTotal.toLocaleString()}`;
  document.getElementById('kpiYoy').textContent = yoyPct===null ? '―' : `${yoyPct>=0?'+':''}${yoyPct}%`;
  document.getElementById('kpiAvgPrice').textContent = `¥${averageUnitPrice().toLocaleString()}`;
  document.getElementById('kpiMarginRate').textContent = margin.totalRevenue>0 ? `${margin.totalMarginRate}%` : '―';

  renderTrendChart(series);
  renderRanking('kpiProductRanking', productRanking().slice(0,5), 'revenue');
  renderRanking('kpiCustomerRanking', customerRanking().slice(0,5), 'revenue');

  document.getElementById('marginRevenue').textContent = `¥${margin.totalRevenue.toLocaleString()}`;
  document.getElementById('marginCost').textContent = `¥${margin.totalCost.toLocaleString()}`;
  document.getElementById('marginTotal').textContent = `¥${margin.totalMargin.toLocaleString()}`;
  const marginWrap = document.getElementById('kpiMarginRows'); marginWrap.innerHTML = '';
  if(margin.rows.length===0){ marginWrap.innerHTML = '<div class="helper-note">まだ集計できるデータがありません。</div>'; }
  margin.rows.forEach(r=>{
    const el = document.createElement('div'); el.className = 'margin-row';
    el.innerHTML = `<span class="mr-name">${r.name}</span><span class="rank-amt">¥${Math.round(r.margin).toLocaleString()} <span class="mr-rate">（粗利率${r.marginRate}%）</span></span>`;
    marginWrap.appendChild(el);
  });

  const yoyWrap = document.getElementById('kpiYoyRows'); yoyWrap.innerHTML = '';
  const maxYoy = Math.max(...yoy.map(r=>Math.max(r.thisYear, r.lastYear||0)), 1);
  yoy.forEach(r=>{
    const el = document.createElement('div'); el.className = 'yoy-row';
    el.innerHTML = `
      <div class="yr-lbl">${r.label}</div>
      <div class="yr-bars">
        <div class="yr-track"><div class="yr-fill" style="width:${Math.round(r.thisYear/maxYoy*100)}%; background:var(--green-deep);"></div></div>
        <div class="yr-track"><div class="yr-fill" style="width:${r.lastYear?Math.round(r.lastYear/maxYoy*100):0}%; background:var(--beige);"></div></div>
      </div>
      <div class="yr-vals">今¥${r.thisYear.toLocaleString()}<br>前${r.lastYear?'¥'+r.lastYear.toLocaleString():'―'}</div>`;
    yoyWrap.appendChild(el);
  });
}

function renderTrendChart(series){
  const width = 280, height = 90;
  const max = Math.max(...series.map(s=>s.total), 1);
  const stepX = series.length>1 ? width/(series.length-1) : width;
  const pts = series.map((s,i)=>{
    const x = Math.round(i*stepX);
    const y = Math.round(height - (s.total/max)*height*0.9 - 5);
    return { x, y };
  });
  const polyline = pts.map(p=>`${p.x},${p.y}`).join(' ');
  const dots = pts.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3" fill="#B48849"></circle>`).join('');
  const svg = `<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:${height}px; display:block;">
    <polyline points="${polyline}" fill="none" stroke="#1E3229" stroke-width="2"></polyline>
    ${dots}
  </svg>`;
  const axis = `<div class="chart-axis">${series.map(s=>`<span>${s.label}</span>`).join('')}</div>`;
  document.getElementById('kpiTrendChart').innerHTML = svg + axis;
}

function renderRanking(containerId, rows, amountField){
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  if(rows.length===0){ wrap.innerHTML = '<div class="helper-note">まだ集計できるデータがありません。</div>'; return; }
  rows.forEach((r,i)=>{
    const el = document.createElement('div');
    el.className = 'rank-row' + (i===0 ? ' top1' : '');
    const sub = r.qty!==undefined ? `合計数量 ${r.qty}` : `${r.count}件の取引`;
    el.innerHTML = `<div class="rank-num">${i+1}</div><div><div class="rank-name">${r.name}</div><div class="rank-sub">${sub}</div></div><div class="rank-amt" style="margin-left:auto;">¥${r[amountField].toLocaleString()}</div>`;
    wrap.appendChild(el);
  });
}

document.getElementById('exportCsvBtn').addEventListener('click', ()=>{
  const csv = toCSV();
  const bom = '\uFEFF'; // Excelで文字化けしないようBOMを付与
  const blob = new Blob([bom + csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  a.href = url;
  a.download = `nouka-denpyo_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSVをダウンロードしました');
});

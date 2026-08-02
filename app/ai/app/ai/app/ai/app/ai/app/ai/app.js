/*
  app.js（農家の販売担当AI v2）
  画面遷移・イベント処理・描画。データ集計は data.js、応答生成は aiEngine.js に委譲する。
*/
import { login, isLoggedIn } from '../../assets/js/auth.js';
import { isSubscribed, subscribe } from '../../assets/js/billing.js';
import { summarize, priceReference, getDataSourceLabel, aiState, persistAi } from './data.js';
import { answer, draftReplyText, judgePrice } from './aiEngine.js';

const NAV_GROUPS = {
  'screen-chat':'chat', 'screen-price':'price', 'screen-analysis':'analysis',
  'screen-proposals':'proposals', 'screen-notifications':'notif',
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
  if(id==='screen-chat'){ renderChatIfEmpty(); updateDataSourceBadge(); }
  if(id==='screen-analysis') renderAnalysis();
  if(id==='screen-proposals') renderProposals();
  if(id==='screen-notifications') renderNotifications();
}

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

document.addEventListener('click', (e)=>{
  const goEl = e.target.closest('[data-go]');
  if(goEl){ go(goEl.dataset.go); return; }
  const toastEl = e.target.closest('[data-toast]');
  if(toastEl){ toast(toastEl.dataset.toast); return; }
});

/* ---------- ログイン／有料オプション ---------- */
function enterApp(){
  if(isSubscribed('ai')){ go('screen-chat'); }
  else {
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('screen-ai-intro').classList.add('active');
    document.getElementById('bottomNav').classList.remove('show');
  }
}
document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  await login(email, password);
  enterApp();
});
document.getElementById('subscribeAiBtn').addEventListener('click', async ()=>{
  await subscribe('ai');
  toast('ご加入ありがとうございます');
  setTimeout(()=>go('screen-chat'), 300);
});
if(isLoggedIn()) enterApp();

/* ---------- データソース表示 ---------- */
async function updateDataSourceBadge(){
  const badge = document.getElementById('dataSourceBadge');
  const text = document.getElementById('dataSourceText');
  const label = await getDataSourceLabel();
  if(label==='sheets'){ badge.classList.remove('none'); text.textContent = 'Googleスプレッドシートのデータを参照中'; }
  else if(label==='local'){ badge.classList.remove('none'); text.textContent = '「農家の伝票」のデータを参照中（この端末のみ）'; }
  else { badge.classList.add('none'); text.textContent = 'まだ参照できるデータがありません'; }
}

/* ---------- チャット ---------- */
const QUICK_QUESTIONS = ['今日の注文は？','この価格で売っていい？','去年の実績は？','返信文を作って','売上分析','価格提案'];
let chatRendered = false;
function renderChatIfEmpty(){
  if(chatRendered) return; chatRendered = true;
  const scroll = document.getElementById('chatScroll'); scroll.innerHTML = '';
  appendMsg('ai', 'こんにちは。今日はどんなご相談ですか？下のよくある質問からも選べます。');
  const qrow = document.getElementById('quickRow'); qrow.innerHTML = '';
  QUICK_QUESTIONS.forEach(q=>{
    const chip = document.createElement('div');
    chip.className = 'quick-chip'; chip.textContent = q;
    chip.addEventListener('click', ()=>sendChat(q));
    qrow.appendChild(chip);
  });
}
function appendMsg(role, html){
  const scroll = document.getElementById('chatScroll');
  const div = document.createElement('div');
  div.className = 'msg ' + role; div.innerHTML = html;
  scroll.appendChild(div); scroll.scrollTop = scroll.scrollHeight;
}
function appendThinking(){
  const scroll = document.getElementById('chatScroll');
  const div = document.createElement('div');
  div.className = 'msg ai'; div.id = 'thinkingMsg'; div.textContent = '考えています…';
  scroll.appendChild(div); scroll.scrollTop = scroll.scrollHeight;
  return div;
}
async function sendChat(preset){
  const input = document.getElementById('chatInput');
  const text = preset || input.value.trim();
  if(!text) return;
  appendMsg('user', text); input.value = '';

  if(text === '返信文を作って'){
    setTimeout(()=>{
      appendMsg('ai', 'どちらの納品先への返信ですか？' + `
        <div class="inline-chips">
          <div class="inline-chip" data-draft="スーパーA">スーパーA</div>
          <div class="inline-chip" data-draft="直売所B">直売所B</div>
          <div class="inline-chip" data-draft="飲食店C">飲食店C</div>
        </div>`);
    }, 400);
    return;
  }

  const thinkEl = appendThinking();
  const summary = await summarize();
  const reply = await answer({ question:text, context:{ summary } });
  thinkEl.remove();
  appendMsg('ai', reply);
}
document.getElementById('sendChatBtn').addEventListener('click', ()=>sendChat());
document.getElementById('chatInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(); });
document.getElementById('chatScroll').addEventListener('click', (e)=>{
  const el = e.target.closest('[data-draft]');
  if(el) draftReply(el.dataset.draft);
});
async function draftReply(customerName){
  appendMsg('user', customerName);
  const thinkEl = appendThinking();
  const text = await draftReplyText(customerName);
  thinkEl.remove();
  appendMsg('ai', `以下の文面はいかがでしょうか。<br><br>「${text}」<span class="m-note">${customerName} 様宛て・下書き</span>` +
    `<div class="inline-chips"><div class="inline-chip" data-toast="文面をコピーしました">コピーする</div></div>`);
}

/* ---------- 価格相談 ---------- */
document.getElementById('judgePriceBtn').addEventListener('click', async ()=>{
  const item = document.getElementById('priceItemInput').value.trim() || '品目';
  const price = parseFloat(document.getElementById('priceValueInput').value) || 0;
  const reference = await priceReference(item);
  const result = await judgePrice({ item, price, reference });
  document.getElementById('priceResult').innerHTML = `
    <div class="result-card">
      <div class="rc-verdict ${result.good?'good':'caution'}">${result.good?'妥当な範囲です':'やや低めです'}</div>
      <div class="rc-price">¥${price.toLocaleString()} ／ キロ</div>
      <div class="rc-desc">${result.message}</div>
    </div>`;
});

/* ---------- 販売分析 ---------- */
async function renderAnalysis(){
  const body = document.getElementById('analysisBody');
  body.innerHTML = '<div class="helper-note">読み込み中…</div>';
  const s = await summarize();
  if(!s){ body.innerHTML = emptyStateHtml(); return; }

  const custEntries = Object.entries(s.byCustomer).sort((a,b)=>b[1]-a[1]);
  const itemEntries = Object.entries(s.byItem).sort((a,b)=>b[1]-a[1]);
  const custMax = custEntries[0] ? custEntries[0][1] : 1;
  const itemMax = itemEntries[0] ? itemEntries[0][1] : 1;
  const topCust = custEntries[0];
  const custShare = topCust ? Math.round(topCust[1]/s.totalSales*100) : 0;

  body.innerHTML = `
    <div class="stat-row">
      <div class="stat-card dark"><div class="st-lbl">記録された売上</div><div class="st-num">¥${s.totalSales.toLocaleString()}</div></div>
      <div class="stat-card"><div class="st-lbl">未請求</div><div class="st-num">${s.unbilled}件</div></div>
    </div>
    <div class="insight-box"><div class="ib-lbl">AIの気づき</div>${topCust ? `直近のデータでは${topCust[0]}への売上が全体の${custShare}%を占めています。特定の販売先への依存度が高い場合、他の販売先との取引拡大も検討の余地があります。` : 'まだ十分なデータがありません。'}</div>
    <div class="section-title">販売先別</div>
    ${custEntries.map(([name,val])=>`
      <div class="bar-row"><div class="b-top"><span>${name}</span><span>¥${val.toLocaleString()}</span></div>
      <div class="bar-track"><div class="bar-fill gold" style="width:${Math.round(val/custMax*100)}%"></div></div></div>`).join('')}
    <div class="section-title">商品別</div>
    ${itemEntries.length ? itemEntries.map(([name,val])=>`
      <div class="bar-row"><div class="b-top"><span>${name}</span><span>¥${val.toLocaleString()}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(val/itemMax*100)}%"></div></div></div>`).join('') : '<div class="helper-note">商品別の内訳はまだ表示できません。</div>'}
  `;
}
function emptyStateHtml(){
  return `<div class="empty-state">
    <svg class="icon" viewBox="0 0 24 24"><path d="M4 20V11M11 20V4M18 20v-7"/></svg>
    <p>まだ分析できるデータがありません。<br>「農家の伝票」で納品書を作成すると、ここに分析が表示されます。</p>
    <a href="../denpyo/index.html" class="btn btn-secondary btn-lg" style="text-decoration:none;">農家の伝票を開く</a>
  </div>`;
}

/* ---------- 販売提案 ---------- */
const PROPOSALS = [
  { tag:'価格提案', title:'きゅうりの単価見直し', desc:'直近の取引が近隣相場よりやや低めです。¥260前後への見直しを提案します。' },
  { tag:'販売先提案', title:'取引先の分散', desc:'特定の販売先への依存度が高まっています。他の販売先への出荷頻度を増やす余地がありそうです。' },
  { tag:'在庫提案', title:'出荷ペースの確認', desc:'一部の商品で出荷量が先月よりやや減少しています。収穫状況をご確認ください。' },
];
function renderProposals(){
  const wrap = document.getElementById('proposalsList'); wrap.innerHTML = '';
  PROPOSALS.forEach((p,i)=>{
    const status = aiState.proposalStatus[i];
    const el = document.createElement('div');
    el.className = 'proposal-card' + (status ? ' done' : '');
    el.innerHTML = `<div class="pc-tag">${p.tag}</div><div class="pc-title">${p.title}</div><div class="pc-desc">${p.desc}</div>
      <div class="pc-actions">
        <button class="accept" ${status?'disabled':''} data-act="accepted" data-i="${i}">${status==='accepted'?'採用済み':'採用する'}</button>
        <button class="dismiss" ${status?'disabled':''} data-act="dismissed" data-i="${i}">${status==='dismissed'?'見送り済み':'見送る'}</button>
      </div>`;
    wrap.appendChild(el);
  });
  wrap.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const i = parseInt(btn.dataset.i, 10);
      aiState.proposalStatus[i] = btn.dataset.act;
      persistAi();
      renderProposals();
      toast(btn.dataset.act==='accepted' ? '提案を採用しました' : '見送りにしました');
    });
  });
}

/* ---------- 通知 ---------- */
const NOTIFICATIONS = [
  { icon:'bell', title:'価格提案があります', desc:'きゅうりの単価見直しについて提案があります。', time:'今日' },
  { icon:'chart', title:'売上の分析が更新されました', desc:'「分析」タブから最新の内容をご確認いただけます。', time:'昨日' },
  { icon:'chat', title:'返信文の下書きを確認してください', desc:'チャットで作成した下書きが残っています。', time:'2日前' },
];
const ICON_PATHS = {
  bell:'<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  chart:'<path d="M4 20V11M11 20V4M18 20v-7"/>',
  chat:'<path d="M4 5h16v10H8l-4 4V5Z"/>',
};
function renderNotifications(){
  const wrap = document.getElementById('notifList'); wrap.innerHTML = '';
  NOTIFICATIONS.forEach(n=>{
    const el = document.createElement('div'); el.className = 'notif-row';
    el.innerHTML = `<div class="nr-icon"><svg class="icon" viewBox="0 0 24 24">${ICON_PATHS[n.icon]}</svg></div>
      <div><div class="nr-title">${n.title}</div><div class="nr-desc">${n.desc}</div><div class="nr-time">${n.time}</div></div>`;
    wrap.appendChild(el);
  });
}

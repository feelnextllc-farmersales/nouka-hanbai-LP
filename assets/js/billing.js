/*
  billing.js（モック実装）
  「売上分析（KPI）」「農家の販売担当AI」などの有料オプション加入状態を管理する。
  現時点では決済処理を行わず、ローカルにフラグを保存するだけ。

  将来 Square のサブスクリプション機能（Square Subscriptions API）を導入する際は、
  以下のように差し替える想定：
   - subscribe(plan) → Square Checkout（またはCustom Web Payment SDK）でサブスクリプションを作成し、
     成功時にサーバー（or Square側Webhook）から加入状態を受け取ってstateに反映する
   - isSubscribed(plan) → 起動時にサーバー（Squareのサブスクリプション状態を保持するAPI）へ問い合わせる形に変更
  呼び出し側（app.js）は subscribe()/isSubscribed() のインターフェースのみに依存するため、
  中身をSquare連携に差し替えても呼び出し側の変更は不要という設計にしている。
*/
import { loadJSON, saveJSON } from './storage.js';

const KEY = 'nouka-billing:v1';

function readState(){
  return loadJSON(KEY, { kpi:false, ai:false });
}
function writeState(state){
  saveJSON(KEY, state);
}

export function isSubscribed(plan){
  const state = readState();
  return !!state[plan];
}

export function subscribe(plan){
  // TODO: Square Subscriptions API に置き換える（Checkout作成→Webhook受信→ここのstateを更新）
  const state = readState();
  state[plan] = true;
  writeState(state);
  return Promise.resolve({ ok:true });
}

export function unsubscribe(plan){
  // TODO: Square側のサブスクリプションをキャンセルするAPI呼び出しに置き換える
  const state = readState();
  state[plan] = false;
  writeState(state);
}

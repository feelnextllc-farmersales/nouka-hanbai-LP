/*
  sheetsSync.js
  Googleスプレッドシート（Apps Script Webアプリ）への書き込み専用の同期クライアント。

  設計方針：
  ・このアプリの「正のデータ」はあくまでブラウザ内（localStorage／data.js）。
    Googleスプレッドシートは「簡易データベース・バックアップ・CSV代替」という
    位置づけなので、書き込みのみの一方向同期（アプリ→スプレッドシート）にしている。
  ・将来 Supabase 等の本格的なDBへ移行する場合は、このファイルの pushRecord() の
    中身をSupabaseへのinsert呼び出しに差し替えるだけでよい設計にしている。
    呼び出し側（data.js）は pushRecord(type, record) のインターフェースのみに依存する。

  Apps Script側の実装（Code.gs）は /app/gas/Code.gs を参照。
  Content-Type を text/plain にしているのは、Apps Script のWebアプリ（doPost）で
  CORSのプリフライトリクエスト（OPTIONS）を避けるための一般的な回避策。
*/
import { loadJSON, saveJSON } from '../../assets/js/storage.js';

const CONFIG_KEY = 'nouka-sheets-config:v1';

export function getSyncConfig(){
  return loadJSON(CONFIG_KEY, { url:'', enabled:false, lastSyncAt:null, lastError:null });
}
export function setSyncConfig(patch){
  const cfg = { ...getSyncConfig(), ...patch };
  saveJSON(CONFIG_KEY, cfg);
  return cfg;
}

/*
  pushRecord(type, record)
  type: '見積書' | '納品書' | '請求書' | '領収書' | '顧客' | '商品'
  record: プレーンオブジェクト（そのままスプレッドシートの1行になる）
  戻り値は常に解決するPromise（同期に失敗してもアプリ本体の動作は止めない設計）。
*/
export async function pushRecord(type, record){
  const cfg = getSyncConfig();
  if(!cfg.enabled || !cfg.url){
    return { skipped:true, reason:'sync-disabled' };
  }
  try{
    const res = await fetch(cfg.url, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify({ type, record, sentAt: new Date().toISOString() }),
    });
    const data = await res.json().catch(()=>({ ok:res.ok }));
    if(data && data.ok){
      setSyncConfig({ lastSyncAt: new Date().toISOString(), lastError:null });
    } else {
      setSyncConfig({ lastError: (data && data.error) || 'unknown-error' });
    }
    return data;
  }catch(err){
    console.warn('[sheetsSync] pushRecord failed', err);
    setSyncConfig({ lastError: String(err) });
    return { ok:false, error:String(err) };
  }
}

/* 接続テスト用：設定画面の「テスト送信」ボタンから呼び出す */
export async function testConnection(url){
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify({ type:'__test__', record:{ message:'農家の伝票からの接続テストです', sentAt: new Date().toISOString() } }),
    });
    const data = await res.json().catch(()=>null);
    return data && data.ok ? { ok:true } : { ok:false, error:'応答が正しくありません' };
  }catch(err){
    return { ok:false, error:String(err) };
  }
}

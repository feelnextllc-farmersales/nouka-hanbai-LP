/*
  storage.js
  汎用のlocalStorage読み書きヘルパー。
  各アプリのdata.jsから利用し、入力データ（学習用の候補データ含む）を
  ブラウザに永続化するために使う。
  将来サーバーサイドDBへ置き換える際は、この関数群の中身だけを
  fetch()呼び出しに差し替えれば、呼び出し側（data.js）は変更不要な設計にしている。
*/

export function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    return JSON.parse(raw);
  }catch(e){
    console.warn('[storage] failed to load', key, e);
    return fallback;
  }
}

export function saveJSON(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }catch(e){
    console.warn('[storage] failed to save', key, e);
    return false;
  }
}

export function clearKey(key){
  try{ localStorage.removeItem(key); }catch(e){ /* noop */ }
}

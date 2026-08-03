/*
  auth.js（モック実装）
  現時点ではバックエンドがないため、実際の認証は行わずダミーでログイン状態を管理する。
  将来的にサーバーサイド認証（例：Supabase Auth, Firebase Auth など）を導入する際は、
  この2つの関数の中身だけを差し替えれば、呼び出し側（各アプリのapp.js）は変更不要。
*/

const SESSION_KEY = 'nouka-session:v1';

export function login(email, password){
  // TODO: 実際の認証APIに置き換える
  return new Promise((resolve)=>{
    setTimeout(()=>{
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: email || 'guest', loggedInAt: Date.now() }));
      resolve({ ok:true });
    }, 200);
  });
}

export function isLoggedIn(){
  return !!sessionStorage.getItem(SESSION_KEY);
}

export function logout(){
  sessionStorage.removeItem(SESSION_KEY);
}

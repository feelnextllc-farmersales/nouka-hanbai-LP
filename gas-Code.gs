/**
 * Code.gs
 * 「農家の伝票」から送られてきたデータを、Googleスプレッドシートに自動保存するための
 * Apps Script Webアプリです。
 *
 * ── 使い方（詳細は README-google-sheets.md を参照）──
 * 1. 新しいGoogleスプレッドシートを作成する
 * 2. 「拡張機能」→「Apps Script」を開く
 * 3. デフォルトのコードを全部削除し、このファイルの中身を丸ごと貼り付ける
 * 4. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」
 *      - 実行するユーザー：自分
 *      - アクセスできるユーザー：全員
 * 5. 発行されたWebアプリのURLを、「農家の伝票」の設定画面に貼り付ける
 *
 * ── 設計方針 ──
 * ・このスクリプトは「書き込み専用」です（アプリ側からのデータを追記するだけ）。
 * ・スプレッドシートを「簡易データベース・バックアップ・CSV代替」として使う想定のため、
 *   複雑な更新・削除・双方向同期は行わず、常に新しい行を追記する設計にしています。
 * ・シートが存在しない場合は自動的に作成し、見出し行も自動で用意します。
 */

/* ---------- 種類ごとの列定義 ---------- */
/* key はアプリ側（sheetsSync.js）から送られてくるオブジェクトのキー名と対応させる */
const SHEET_SCHEMAS = {
  '見積書': [
    { header:'受信日時', key:'__receivedAt' },
    { header:'ID', key:'id' },
    { header:'見積日', key:'date' },
    { header:'顧客', key:'customer' },
    { header:'明細', key:'detail' },
    { header:'明細JSON', key:'items' },
    { header:'合計金額', key:'total' },
    { header:'有効期限(日)', key:'validDays' },
    { header:'変換済み', key:'converted' },
  ],
  '納品書': [
    { header:'受信日時', key:'__receivedAt' },
    { header:'ID', key:'id' },
    { header:'納品日', key:'date' },
    { header:'顧客', key:'customer' },
    { header:'明細', key:'detail' },
    { header:'明細JSON', key:'items' },
    { header:'合計金額', key:'total' },
    { header:'請求済み', key:'invoiced' },
    { header:'予約', key:'reservation' },
    { header:'変換元見積ID', key:'fromQuoteId' },
  ],
  '請求書': [
    { header:'受信日時', key:'__receivedAt' },
    { header:'ID', key:'id' },
    { header:'発行日', key:'date' },
    { header:'顧客', key:'customer' },
    { header:'合計金額', key:'total' },
    { header:'納品書件数', key:'noteCount' },
    { header:'入金済み', key:'paid' },
  ],
  '領収書': [
    { header:'受信日時', key:'__receivedAt' },
    { header:'ID', key:'id' },
    { header:'発行日', key:'date' },
    { header:'顧客', key:'customer' },
    { header:'金額', key:'amount' },
    { header:'受領方法', key:'method' },
    { header:'紐づく請求書ID', key:'refInvoiceId' },
    { header:'但し書き', key:'memo' },
  ],
  '顧客': [
    { header:'受信日時', key:'__receivedAt' },
    { header:'顧客名', key:'name' },
  ],
  '商品': [
    { header:'受信日時', key:'__receivedAt' },
    { header:'商品名', key:'name' },
    { header:'規格', key:'unit' },
    { header:'標準価格', key:'price' },
    { header:'原価', key:'cost' },
  ],
};

/* ---------- Webアプリのエントリポイント ---------- */

function doGet(e){
  const type = e.parameter && e.parameter.type;
  if(!type){
    return ContentService
      .createTextOutput('OK - 農家の伝票 Sheets Sync は正常に稼働しています。')
      .setMimeType(ContentService.MimeType.TEXT);
  }
  try{
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(type);
    if(!sheet || sheet.getLastRow() < 2){
      return jsonResponse({ ok:true, rows:[] });
    }
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const rows = values.slice(1).map(row=>{
      const obj = {};
      headers.forEach((h, i)=> obj[h] = row[i]);
      return obj;
    });
    return jsonResponse({ ok:true, rows });
  }catch(err){
    return jsonResponse({ ok:false, error:String(err) });
  }
}

function doPost(e){
  try{
    const payload = JSON.parse(e.postData.contents);
    const type = payload.type;
    const record = payload.record || {};

    if(type === '__test__'){
      return jsonResponse({ ok:true, message:'接続テストを受信しました', received:record });
    }

    const schema = SHEET_SCHEMAS[type];
    if(!schema){
      return jsonResponse({ ok:false, error:'未対応の種類です: ' + type });
    }

    record.__receivedAt = new Date().toISOString();
    appendRow(type, schema, record);

    return jsonResponse({ ok:true });
  }catch(err){
    return jsonResponse({ ok:false, error:String(err) });
  }
}

/* ---------- 内部処理 ---------- */

function appendRow(sheetName, schema, record){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if(!sheet){
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(schema.map(col => col.header));
    sheet.setFrozenRows(1);
  } else if(sheet.getLastRow() === 0){
    sheet.appendRow(schema.map(col => col.header));
    sheet.setFrozenRows(1);
  }

  const row = schema.map(col => {
    const v = record[col.key];
    if(v === undefined || v === null) return '';
    if(typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  sheet.appendRow(row);
}

function jsonResponse(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

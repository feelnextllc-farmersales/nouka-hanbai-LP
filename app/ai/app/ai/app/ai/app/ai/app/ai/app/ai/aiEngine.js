/*
  aiEngine.js
  「農家の販売担当AI」の応答生成を担当するモジュール。

  現時点ではルールベース（あらかじめ用意した回答パターン＋集計データの埋め込み）で応答している。
  将来 OpenAI API（またはその他のLLM API）に差し替える場合は、
  answer() 関数の中身だけを実際のAPI呼び出しに置き換えればよい設計にしている。
  呼び出し側（app.js）は answer({ question, context }) というインターフェースのみに依存する。

  ─ 将来のOpenAI API差し替えイメージ（コメントのみ・未実装） ─
  export async function answer({ question, context }){
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model:'gpt-4o-mini',
        messages:[
          { role:'system', content:'あなたは農家専属の販売担当AIです。以下のデータをもとに答えてください。' + JSON.stringify(context) },
          { role:'user', content: question },
        ],
      }),
    });
    const data = await res.json();
    return data.choices[0].message.content;
  }
  ※ APIキーをクライアント（ブラウザ）に直接埋め込むのは安全ではないため、
    実装時はサーバーレス関数（例：Cloud Functions, Vercel Functions等）を
    経由させる構成にすることを推奨する。
*/

export async function answer({ question, context }){
  const s = context.summary;

  if(question === '今日の注文は？'){
    if(!s) return 'まだ「農家の伝票」のデータがありません。まずは伝票アプリで納品書を作成してみてください。';
    return s.latest
      ? `直近の記録は${s.latest.customer}へ${s.latest.detail}（¥${s.latest.total.toLocaleString()}）です。未請求の納品書は${s.unbilled}件あります。`
      : '直近の記録がまだありません。';
  }
  if(question === 'この価格で売っていい？'){
    return '品目を指定していただければ「価格相談」タブでより詳しく判定できます。';
  }
  if(question === '去年の実績は？'){
    return '前年データは現在プレースホルダの参考値のみです。実績が1年分蓄積されると、より正確な比較ができるようになります。';
  }
  if(question === '売上分析'){
    if(!s) return 'まだ売上データがありません。';
    const top = Object.entries(s.byCustomer).sort((a,b)=>b[1]-a[1])[0];
    return top
      ? `直近の記録では${top[0]}への売上が¥${top[1].toLocaleString()}と最も多くなっています。「分析」タブでグラフも確認できます。`
      : 'まだ売上データがありません。';
  }
  if(question === '価格提案'){
    if(!s) return 'まだご提案できるデータがありません。';
    const topItem = Object.entries(s.byItem).sort((a,b)=>b[1]-a[1])[0];
    return topItem
      ? `${topItem[0]}の売上が最も大きく計上されています。単価の見直しは「提案」タブもご覧ください。`
      : 'まだご提案できるデータがありません。';
  }
  if(question === 'この分析についてもっと相談したい'){
    return '特定の販売先への依存を減らす方向で考えるなら、他の販売先への出荷頻度を少しずつ増やすところから試すのはいかがでしょうか。';
  }
  return 'すみません、まだお答えできる範囲を超えています。もう少し具体的に教えていただけますか？';
}

export async function draftReplyText(customerName){
  return `いつもお世話になっております。来週分の納品につきまして、通常より+5%ほどの価格でのご提供が可能です。ご検討のほど、よろしくお願いいたします。`;
}

export async function judgePrice({ item, price, reference }){
  const marketAvg = reference || 300;
  const diffPct = Math.round((price - marketAvg) / marketAvg * 100);
  const good = price >= marketAvg * 0.9;
  return {
    good,
    marketAvg,
    diffPct,
    message: `${item}の直近の取引実績は¥${marketAvg}／キロです。ご希望の価格は実績より${diffPct>=0?diffPct+'%高め':Math.abs(diffPct)+'%低め'}です。${good?'この価格でのご提案は問題ないかと思います。':'可能であれば¥'+Math.round(marketAvg*0.95)+'前後への見直しもご検討ください。'}`,
  };
}

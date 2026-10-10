/* ══════════════════════════════════════════════
   やどかりんAI（ブラウザの中で動く、住まいの悩みから条件を読み取るAI）
   ・学習は yk-ai/train.py（Python）。できた yk-model.json をここで読み込んで使う
   ・計算はこの端末の中だけで行う（サーバー代・AI代は0円、1回1ミリ秒くらい）
   使い方:
     await YkAI.load();
     YkAI.predict('猫と住みたい')  → [{ label:'pet', p:0.97, ja:'ペットと住める', en:'pets allowed' }, ...]
══════════════════════════════════════════════ */
(function () {
  let model = null, loading = null, known = null;

  // train.py の normalize() と同じ処理（ここがずれると答えが変わるので注意）
  function normalize(text) {
    let t = String(text || '').normalize('NFKC').toLowerCase();
    t = t.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));   // カタカナ → ひらがな
    return t.replace(/\s+/g, ' ').trim();
  }
  // Python の文字の数え方（サロゲートペアの絵文字なども1文字）に合わせる
  function chars(s) { return Array.from(s); }
  function ngramsPy(text) {
    const t = chars('^' + normalize(text) + '$');
    const out = new Set();
    for (let n = model.ngram[0]; n <= model.ngram[1]; n++) {
      for (let i = 0; i + n <= t.length; i++) {
        const g = t.slice(i, i + n).join('');
        if (g.trim() && g !== '^' && g !== '$') out.add(g);
      }
    }
    return out;
  }

  async function load(url) {
    if (model) return model;
    if (!loading) {
      loading = fetch(url || 'yk-model.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(m => { model = m; known = new Set(Object.keys(m.w).concat(m.zero || [])); return m; })
        .catch(e => { loading = null; throw e; });
    }
    return loading;
  }

  function scores(text) {
    if (!model) return null;
    const grams = [...ngramsPy(text)].filter(g => known.has(g));
    const k = model.labels.length;
    const z = model.bias.slice();
    if (grams.length) {
      const s = 1 / Math.sqrt(grams.length);
      grams.forEach(g => { const row = model.w[g]; if (row) row.forEach(([j, w]) => { z[j] += w * s; }); });
    }
    const p = new Array(k);
    for (let j = 0; j < k; j++) p[j] = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z[j]))));
    return p;
  }

  function predict(text, threshold) {
    const p = scores(text); if (!p) return null;
    const th = threshold == null ? model.threshold : threshold;
    return model.labels.map((label, j) => ({ label, p: p[j], ja: (model.labelNames[label] || [])[0], en: (model.labelNames[label] || [])[1] }))
      .filter(x => x.p >= th).sort((a, b) => b.p - a.p);
  }

  // 発表やデバッグ用: どの文字のかたまりが判断の決め手になったか
  function explain(text, label, top) {
    if (!model) return [];
    const j = model.labels.indexOf(label); if (j < 0) return [];
    const grams = [...ngramsPy(text)].filter(g => known.has(g));
    const s = grams.length ? 1 / Math.sqrt(grams.length) : 0;
    return grams.map(g => { const row = (model.w[g] || []).find(r => r[0] === j); return { gram: g, w: row ? row[1] * s : 0 }; })
      .filter(x => x.w > 0).sort((a, b) => b.w - a.w).slice(0, top || 5);
  }

  window.YkAI = { load, predict, scores, explain, get ready() { return !!model; }, get info() { return model && { labels: model.labels, testMicroF1: model.testMicroF1, trainedOn: model.trainedOn }; } };
})();

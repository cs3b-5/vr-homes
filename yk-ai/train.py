# -*- coding: utf-8 -*-
"""
やどかりんAI（住まいの悩みから条件を読み取るAI）の学習スクリプト

  python train.py

・data/train.tsv で学習して、data/dev.tsv（調整用）と data/test.tsv（最終テスト）で正解率を測る
  ※ test.tsv は最後の確認にだけ使う。test の結果を見て学習データや設定を直すと、成績が実力より良く見えてしまう
・できたモデルを yk-model.json に書き出す（サイトのフォルダに置くと、そのまま読む）
・結果を report.md に書く（ルール方式との比べも入る）

しくみ:
  文章 → 文字のかたまり（1〜3文字のN-gram）にばらす → 18個の「条件」それぞれについて
  ロジスティック回帰で「この条件が書かれている確率」を出す（1つの文に複数の条件があってもよい）
使うのは numpy だけ。
"""
import json, os, re, random, sys, unicodedata
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
# 書き出し先: 環境変数 OUT があればそこ、なければ ../site/yk-model.json（site フォルダがなければこのフォルダ）
OUT_MODEL = os.environ.get('OUT') or (os.path.join(HERE, '..', 'site', 'yk-model.json')
                                      if os.path.isdir(os.path.join(HERE, '..', 'site')) else os.path.join(HERE, 'yk-model.json'))
SEED = int(os.environ.get('SEED', 3))
NGRAM = (1, 3)
MIN_COUNT = int(os.environ.get('MIN_COUNT', 4))          # 2回以上出てきた文字のかたまりだけ使う
L2_GRID = [1e-4, 3e-4, 1e-3, 3e-3]   # 重みを大きくしすぎないためのペナルティ（交差検証で選ぶ）
TH_GRID = [0.35, 0.45, 0.55]          # 「ある」と判断する確率の境目（交差検証で選ぶ）
PRUNE = float(os.environ.get('PRUNE', 1.0))           # これより小さい重みは捨ててモデルを軽くする
FOLDS = 5
EPOCHS = 400
LR = 0.05
AUG3 = float(os.environ.get('AUG3', 0.35))
N_AUGMENT = int(os.environ.get('N_AUGMENT', 1500))       # 2つの文をつないだ「複数の条件がある文」を何個つくるか


# ───────── 文章の前処理（サイトの JavaScript と同じ処理にする） ─────────
def normalize(text):
    t = unicodedata.normalize('NFKC', str(text)).lower()
    # カタカナ → ひらがな（「ネコ」と「ねこ」を同じに扱う）
    t = ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def ngrams(text):
    t = '^' + normalize(text) + '$'
    out = set()
    for n in range(NGRAM[0], NGRAM[1] + 1):
        for i in range(len(t) - n + 1):
            g = t[i:i + n]
            if g.strip() and g not in ('^', '$'):
                out.add(g)
    return out


# ───────── データの読み込み ─────────
def read_labels():
    rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(DATA, 'labels.tsv'), encoding='utf-8')][1:]
    return [r[0] for r in rows if r and r[0]], {r[0]: (r[1], r[2]) for r in rows if r and r[0]}


def read_tsv(name, labels):
    items = []
    for i, line in enumerate(open(os.path.join(DATA, name), encoding='utf-8')):
        if i == 0 or not line.strip():
            continue
        lab, text = line.rstrip('\n').split('\t', 1)
        ls = [] if lab.strip() in ('', '-') else [x.strip() for x in lab.split(',')]
        for x in ls:
            if x not in labels:
                sys.exit('%s の %d 行目: 知らないラベル「%s」' % (name, i + 1, x))
        items.append((text, ls))
    return items


def augment(items, n, rng):
    """条件が1つの文を2〜3つつないで、条件が複数ある文をつくる（データを増やす工夫）"""
    singles = [it for it in items if len(it[1]) == 1]
    joins = ['。', '、', '。あと', '。それと', 'し、', '。できれば', '。それから']
    out = []
    for _ in range(n):
        k = 3 if rng.random() < AUG3 else 2        # 3つつなぐ文もまぜる（長い相談文に強くなる）
        parts = rng.sample(singles, k)
        if len(set(p[1][0] for p in parts)) < k:
            continue
        text = parts[0][0].rstrip('。！!')
        for p in parts[1:]:
            text += rng.choice(joins) + p[0].rstrip('。！!')
        out.append((text, sorted(set(x for p in parts for x in p[1]))))
    return out


# ───────── 特徴量 ─────────
def build_vocab(items):
    cnt = {}
    for text, _ in items:
        for g in ngrams(text):
            cnt[g] = cnt.get(g, 0) + 1
    vocab = sorted([g for g, c in cnt.items() if c >= MIN_COUNT])
    return {g: i for i, g in enumerate(vocab)}


def featurize(items, vocab):
    X = np.zeros((len(items), len(vocab)), dtype=np.float32)
    for r, (text, _) in enumerate(items):
        idx = [vocab[g] for g in ngrams(text) if g in vocab]
        if idx:
            X[r, idx] = 1.0 / np.sqrt(len(idx))     # 長い文でも点数がふくらみすぎないように
    return X


def targets(items, labels):
    Y = np.zeros((len(items), len(labels)), dtype=np.float32)
    for r, (_, ls) in enumerate(items):
        for x in ls:
            Y[r, labels.index(x)] = 1.0
    return Y


# ───────── ロジスティック回帰（Adamで学習） ─────────
def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def train(X, Y, l2, verbose=True):
    n, d = X.shape
    k = Y.shape[1]
    W = np.zeros((d, k), dtype=np.float32)
    b = np.zeros(k, dtype=np.float32)
    pos = Y.mean(axis=0)
    wpos = np.clip((1 - pos) / np.maximum(pos, 1e-3), 1, 8)   # 少ない条件ほど1件を重く数える
    m = [np.zeros_like(W), np.zeros_like(b)]
    v = [np.zeros_like(W), np.zeros_like(b)]
    b1, b2, eps = 0.9, 0.999, 1e-8
    for ep in range(1, EPOCHS + 1):
        P = sigmoid(X @ W + b)
        weight = np.where(Y > 0, wpos, 1.0)
        G = (P - Y) * weight / n
        gW = X.T @ G + l2 * W
        gb = G.sum(axis=0)
        for i, (p, g) in enumerate(((W, gW), (b, gb))):
            m[i] = b1 * m[i] + (1 - b1) * g
            v[i] = b2 * v[i] + (1 - b2) * g * g
            mh = m[i] / (1 - b1 ** ep)
            vh = v[i] / (1 - b2 ** ep)
            p -= LR * mh / (np.sqrt(vh) + eps)
        if verbose and ep % 100 == 0:
            loss = -np.mean(weight * (Y * np.log(P + 1e-9) + (1 - Y) * np.log(1 - P + 1e-9)))
            print('  学習 %d回目  損失 %.4f' % (ep, loss))
    return W, b


# ───────── 評価 ─────────
def evaluate(pred_sets, gold_sets, labels):
    per = {}
    tp_all = fp_all = fn_all = 0
    for lab in labels:
        tp = sum(1 for p, g in zip(pred_sets, gold_sets) if lab in p and lab in g)
        fp = sum(1 for p, g in zip(pred_sets, gold_sets) if lab in p and lab not in g)
        fn = sum(1 for p, g in zip(pred_sets, gold_sets) if lab not in p and lab in g)
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0.0
        per[lab] = {'precision': pr, 'recall': rc, 'f1': f1, 'support': tp + fn}
        tp_all += tp; fp_all += fp; fn_all += fn
    P = tp_all / (tp_all + fp_all) if tp_all + fp_all else 0.0
    R = tp_all / (tp_all + fn_all) if tp_all + fn_all else 0.0
    F = 2 * P * R / (P + R) if P + R else 0.0
    exact = sum(1 for p, g in zip(pred_sets, gold_sets) if set(p) == set(g)) / len(gold_sets)
    return {'micro_precision': P, 'micro_recall': R, 'micro_f1': F, 'exact_match': exact, 'per_label': per}


def rule_baseline(text):
    """比べる相手: キーワード（正規表現）で読み取る、いまの「かんたんモード」と同じ考え方のルール"""
    t = unicodedata.normalize('NFKC', text)
    R = {
        'pet': r'猫|ねこ|ネコ|犬|いぬ|イヌ|ペット|うさぎ|ウサギ|インコ|ハムスター',
        'cheap': r'(?<!不)安(い|く|め|さ|価)|抑え|節約|お金がな|金欠|予算が少|低予算|学生',
        'family': r'家族|子ども|子供|こども|ファミリー|赤ちゃん',
        'two': r'二人|ふたり|2人|カップル|同棲|夫婦|新婚|恋人',
        'single': r'一人|ひとり|1人|単身|新生活|上京|学生|社会人1年',
        'station': r'駅(から)?(近|ちか|チカ)|駅前|通勤|通学|電車',
        'security': r'オートロック|防犯|セキュリティ|女性|物騒|治安',
        'bath': r'バス.?トイレ別|風呂.{0,4}別|セパレート|ユニットバス(は|が)?(嫌|いや|イヤ)',
        'net': r'ネット|配信|オンラインゲーム|wi-?fi',
        'work': r'在宅|テレワーク|リモート|作業|仕事部屋|書斎',
        'wide': r'広|ゆったり|荷物が多',
        'parcel': r'宅配|通販|置き配|不在',
        'parking': r'車|駐車|バイク',
        'soon': r'すぐ|急ぎ|即入居|来月|今月',
        'sunny': r'日当たり|明るい|南向|洗濯物|日が入',
        'quiet': r'静か|騒音|うるさ|音が',
        'remote': r'VR|内見に行けない|遠方|遠く|行けない|地方から|上京|忙し',
        'worry': r'不安|心配|はじめて|初めて|わからな|分からな|迷|悩|困',
    }
    out = set(k for k, p in R.items() if re.search(p, t, re.I))
    # 家族・ふたり・ひとりは1つだけ（ルール方式は上から順に1つを選ぶ）
    for a, bs in (('family', ('two', 'single')), ('two', ('single',))):
        if a in out:
            out -= set(bs)
    return out


def main():
    rng = random.Random(SEED)
    np.random.seed(SEED)
    labels, names = read_labels()
    train_items = read_tsv('train.tsv', labels)
    extra = os.path.join(DATA, 'survey.tsv')            # アンケートで集めた文（あれば足す）
    if os.path.exists(extra):
        train_items += read_tsv('survey.tsv', labels)
    test_items = read_tsv('test.tsv', labels)
    dev_items = read_tsv('dev.tsv', labels)
    aug = augment(train_items, N_AUGMENT, rng)
    all_items = train_items + aug
    print('学習データ: 手書き %d 文 + つなぎ文 %d 文 / 調整用 %d 文 / テスト %d 文 / 条件 %d 種類'
          % (len(train_items), len(aug), len(dev_items), len(test_items), len(labels)))

    # ───── 交差検証: 学習データだけを5つに分けて、ペナルティの強さと境目を決める（テストデータは使わない） ─────
    idx = list(range(len(train_items))); rng.shuffle(idx)
    folds = [idx[f::FOLDS] for f in range(FOLDS)]
    cv = {}
    if os.environ.get('FIXED'):   # 実験用: 交差検証を飛ばして設定を固定する（例 FIXED=1e-4,0.45）
        a, c = os.environ['FIXED'].split(',')
        cv[(float(a), float(c))] = 0.0
    for l2 in ([] if cv else L2_GRID):
        probs, golds = [], []
        for f in range(FOLDS):
            hold = set(folds[f])
            tr = [train_items[i] for i in idx if i not in hold]
            va = [train_items[i] for i in folds[f]]
            tr_all = tr + augment(tr, N_AUGMENT, random.Random(SEED + f))
            voc = build_vocab(tr_all)
            Wf, bf = train(featurize(tr_all, voc), targets(tr_all, labels), l2, verbose=False)
            probs.append(sigmoid(featurize(va, voc) @ Wf + bf)); golds += [set(ls) for _, ls in va]
        P = np.vstack(probs)
        for th in TH_GRID:
            pred = [set(labels[j] for j in range(len(labels)) if P[i, j] >= th) for i in range(len(golds))]
            cv[(l2, th)] = evaluate(pred, golds, labels)['micro_f1']
            print('  交差検証  ペナルティ %.0e  境目 %.2f  → F1 %.1f%%' % (l2, th, cv[(l2, th)] * 100))
    L2, THRESHOLD = max(cv, key=cv.get)
    print('選んだ設定: ペナルティ %.0e / 境目 %.2f' % (L2, THRESHOLD))

    vocab = build_vocab(all_items)
    print('文字のかたまり（特徴）: %d 個' % len(vocab))
    X, Y = featurize(all_items, vocab), targets(all_items, labels)
    W, b = train(X, Y, L2)
    W = np.where(np.abs(W) >= PRUNE, W, 0).astype(np.float32)   # 小さい重みを捨てる（書き出すモデルと同じ状態で評価する）

    Xt = featurize(test_items, vocab)
    Pt = sigmoid(Xt @ W + b)
    model_pred = [set(labels[j] for j in range(len(labels)) if Pt[i, j] >= THRESHOLD) for i in range(len(test_items))]
    gold = [set(ls) for _, ls in test_items]
    rule_pred = [rule_baseline(t) for t, _ in test_items]
    m_model = evaluate(model_pred, gold, labels)
    m_rule = evaluate(rule_pred, gold, labels)
    Pd = sigmoid(featurize(dev_items, vocab) @ W + b)
    dev_pred = [set(labels[j] for j in range(len(labels)) if Pd[i, j] >= THRESHOLD) for i in range(len(dev_items))]
    dev_gold = [set(ls) for _, ls in dev_items]
    m_dev = evaluate(dev_pred, dev_gold, labels)
    dev_rule = [rule_baseline(t) for t, _ in dev_items]
    m_dev_rule = evaluate(dev_rule, dev_gold, labels)
    # ハイブリッド: やどかりんAI ＋ キーワード（調整用データで適合率90%以上だった条件だけ）を安全網として足す
    hyb_labels = [k for k in labels if m_dev_rule['per_label'][k]['support'] and m_dev_rule['per_label'][k]['precision'] >= 0.9]
    m_dev_hyb = evaluate([a | (b & set(hyb_labels)) for a, b in zip(dev_pred, dev_rule)], dev_gold, labels)
    m_hyb = evaluate([a | (b & set(hyb_labels)) for a, b in zip(model_pred, rule_pred)], gold, labels)

    # 学習データでの成績（覚えすぎていないかの目安）
    Ptr = sigmoid(featurize(train_items, vocab) @ W + b)
    tr_pred = [set(labels[j] for j in range(len(labels)) if Ptr[i, j] >= THRESHOLD) for i in range(len(train_items))]
    m_train = evaluate(tr_pred, [set(ls) for _, ls in train_items], labels)

    if os.environ.get('PARITY'):   # ブラウザ版（yk-ai.js）と答えが同じか確かめる用
        json.dump({'texts': [t for t, _ in dev_items], 'probs': [[round(float(x), 4) for x in row] for row in Pd]},
                  open(os.path.join(HERE, 'parity.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    if os.environ.get('DEV_ONLY'):   # 調整中はテストの成績を見ない
        print('調整用(dev)   ルール方式 F1 %.1f%% / やどかりんAI F1 %.1f%%  特徴 %d 個'
              % (m_dev_rule['micro_f1'] * 100, m_dev['micro_f1'] * 100, int((np.abs(W).sum(axis=1) > 0).sum())))
        return

    # ───── モデルを書き出す（小さい重みは捨てて軽くする） ─────
    inv = {i: g for g, i in vocab.items()}
    w_out = {}
    for i in range(W.shape[0]):
        row = [[j, round(float(W[i, j]), 2)] for j in range(W.shape[1]) if W[i, j] != 0]
        if row:
            w_out[inv[i]] = row
    model = {
        'v': 1, 'name': 'yadokarin-intent', 'labels': labels,
        'labelNames': {k: list(v) for k, v in names.items()},
        'ngram': list(NGRAM), 'threshold': THRESHOLD,
        'bias': [round(float(x), 3) for x in b], 'w': w_out,
        # 重みを捨てた文字のかたまりも「文の長さ」の計算には入るので、名前だけ残す（ブラウザでも同じ計算にするため）
        'zero': sorted(g for g in vocab if g not in w_out),
        'trainedOn': len(train_items), 'testMicroF1': round(m_model['micro_f1'], 3), 'hybridRuleLabels': hyb_labels
    }
    with open(OUT_MODEL, 'w', encoding='utf-8') as f:
        json.dump(model, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(OUT_MODEL)
    print('モデルを書き出しました: %s (%.0f KB, 特徴 %d 個)' % (OUT_MODEL, size / 1024, len(w_out)))

    # ───── まちがえた例 ─────
    misses = []
    for (t, ls), p in zip(test_items, model_pred):
        if set(ls) != p:
            misses.append((t, sorted(ls), sorted(p)))

    # ───── レポート ─────
    def pct(x): return '%.1f%%' % (x * 100)
    L = ['# やどかりんAI 学習レポート', '',
         '- 学習データ: 手書き %d 文（＋2〜3文をつないで作った %d 文）' % (len(train_items), len(aug)),
         '- 調整用データ（dev）: %d 文 / 最終テストデータ（test）: %d 文。どちらも学習には使っていない、別に書いた文' % (len(dev_items), len(test_items)),
         '- 特徴: 文字の1〜3文字のかたまり %d 個（重みが小さいものを捨てて %d 個）/ モデルの大きさ %.0f KB' % (len(vocab), len(w_out), size / 1024),
         '- 設定: 学習データだけの%d分割交差検証で、ペナルティ %.0e・境目 %.2f を選んだ（テストデータは設定選びに使っていない）' % (FOLDS, L2, THRESHOLD), '',
         '## 全体の成績（テストデータ）', '',
         '| 方式 | 適合率 | 再現率 | F1 | 条件が完全に一致した文 |', '|---|---|---|---|---|',
         '| ルール方式（キーワード） | %s | %s | %s | %s |' % (pct(m_rule['micro_precision']), pct(m_rule['micro_recall']), pct(m_rule['micro_f1']), pct(m_rule['exact_match'])),
         '| やどかりんAI（学習） | %s | %s | %s | %s |' % (pct(m_model['micro_precision']), pct(m_model['micro_recall']), pct(m_model['micro_f1']), pct(m_model['exact_match'])),
         '| **ハイブリッド（AI＋キーワードの安全網）※サイトで使う方式** | %s | %s | %s | %s |' % (pct(m_hyb['micro_precision']), pct(m_hyb['micro_recall']), pct(m_hyb['micro_f1']), pct(m_hyb['exact_match'])),
         '', 'ハイブリッドでキーワードも使う条件（調整用データでキーワードの適合率が90%%以上だったもの）: %s' % '・'.join(names[k][0] for k in hyb_labels),
         '', '| 参考 | F1 |', '|---|---|',
         '| 調整用データ（dev）ルール方式 | %s |' % pct(m_dev_rule['micro_f1']),
         '| 調整用データ（dev）やどかりんAI | %s |' % pct(m_dev['micro_f1']),
         '| 調整用データ（dev）ハイブリッド | %s |' % pct(m_dev_hyb['micro_f1']),
         '| 学習データ やどかりんAI（覚えすぎていないかの目安） | %s |' % pct(m_train['micro_f1']), '',
         '- 適合率: AIが「ある」と言った条件のうち、本当に合っていた割合',
         '- 再現率: 本当にある条件のうち、AIが見つけられた割合',
         '- F1: 適合率と再現率のバランス', '',
         '## 条件ごとのF1', '', '| 条件 | 件数 | ルール方式 | やどかりんAI |', '|---|---|---|---|']
    for lab in labels:
        L.append('| %s | %d | %s | %s |' % (names[lab][0], m_model['per_label'][lab]['support'],
                                           pct(m_rule['per_label'][lab]['f1']), pct(m_model['per_label'][lab]['f1'])))
    L += ['', '## AIがまちがえた文（%d 文）' % len(misses), '', '| 文 | 正解 | AIの答え |', '|---|---|---|']
    for t, g, p in misses:
        L.append('| %s | %s | %s |' % (t, '・'.join(names[x][0] for x in g) or '（なし）', '・'.join(names[x][0] for x in p) or '（なし）'))
    L += ['', '## 注意', '',
          '- テスト文は学習用の文とは別に書いたが、同じ人が書いているので、本物の利用者の文より簡単な可能性がある。',
          '- 開発の記録: 最初のテスト文を見ながら改良してしまったため、それを調整用（dev.tsv）に回し、新しいテスト文（test.tsv）を書き直した。新しいテスト文で成績を見たのは、学習データを増やした版・3文つなぎを足した版・ハイブリッドを足した最終版の3回（ハイブリッドを使うかどうかは調整用データだけで決めた）。',
          '- アンケートで集めた本物の悩みを data/survey.tsv に入れて学習し直し、別の人の文でテストすると、より正確に評価できる。']
    open(os.path.join(HERE, 'report.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    json.dump({'model': m_model, 'rule': m_rule, 'dev': {'model': m_dev['micro_f1'], 'rule': m_dev_rule['micro_f1']},
               'train': {'micro_f1': m_train['micro_f1']}, 'settings': {'l2': L2, 'threshold': THRESHOLD, 'cv': {'%g/%g' % k: v for k, v in cv.items()}}},
              open(os.path.join(HERE, 'metrics.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('調整用(dev)   ルール方式 F1 %s / やどかりんAI F1 %s / ハイブリッド F1 %s' % (pct(m_dev_rule['micro_f1']), pct(m_dev['micro_f1']), pct(m_dev_hyb['micro_f1'])))
    print('ハイブリッドでキーワードも使う条件: %s  ← サーバー(lambda_function.py)の YK_HYBRID と同じにしておく' % ','.join(hyb_labels))
    print('テストの成績  ハイブリッド F1 %s (完全一致 %s)' % (pct(m_hyb['micro_f1']), pct(m_hyb['exact_match'])))
    print('\nテストの成績  ルール方式 F1 %s / やどかりんAI F1 %s  (完全一致 %s → %s)'
          % (pct(m_rule['micro_f1']), pct(m_model['micro_f1']), pct(m_rule['exact_match']), pct(m_model['exact_match'])))
    print('くわしくは report.md を見てください')


if __name__ == '__main__':
    main()

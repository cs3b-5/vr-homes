# VR Homes — 引き継ぎメモ（Claude Code 用）

情報システム科3年B組 5班の卒業研究。**ブラウザだけで部屋の中を歩ける、不動産のVR内見サイト**。
担当者はしま。やりとりはくだけた日本語で、すぐ使える完成したコードを渡す。

## 大事な方針
- いらない機能は消して、**使いやすさとわかりやすさを一番**にする。
- VR内見は **Webだけ**（Babylon.js）。Unity（FloorPlayVR6）への受け渡しはもう使わない。
- スマホ対応は必須。PC・スマホ・Meta Quest・スマホ用VRゴーグルで動くこと。
- 秘密の値（SESSION_SECRET・SETUP_KEY・ADMIN_CODE・MASTER_CODE）は **Lambda の環境変数だけ**。コードやチャットに書かない。
- 管理者のパスワードを Claude が入力することはしない。ログインと「登録する」はしまが押す。

## 公開・リポジトリ
- GitHub: `cs3b-5/vr-homes`（**公開リポジトリ**。秘密は入れない）
- 公開サイト: https://cs3b-5.github.io/vr-homes/ （main から GitHub Pages で自動公開）
- 進め方: ブランチを作る → PR → main にマージ（しまの了承済み）。
- **サイトのファイルを変えたら `sw.js` の `CACHE_NAME` の数字を1つ上げる**（今は `vr-homes-v46`）。上げないと古い画面が出る。
- Lambda（`lambda_function.py`, Python）は **このリポジトリに入っていない**。最新版は AWS のコンソールにある。学校のAWSルートアカウントしかない。

## ファイル
| ファイル | 中身 |
|---|---|
| `index.html` | サイト本体（画面の骨組み） |
| `app.js` | 本体の処理（物件・ログイン・地図・物件フォーム・実写データの下ごしらえ `processSpz` / `plyToSpz`） |
| `features.js` | 追加機能（予約・一緒に内見・間取りから探す・物件フォームの使いやすさ・学校デモ `?demo=school` など） |
| `theme.css` / `site.css` | 見た目 |
| `vr-viewer.html` | VRビューア（Babylon.js 9.29）。歩く・模型・測る・家具・日当たり・ツアー・一緒に内見・実写・位置合わせ・スマホVR・WebXR |
| `floor-editor.html` | 間取りエディタ（間取り図の画像から自動で作る、OCRは tesseract.js） |
| `mascot.js` | キャラ「やどかりん」の SVG |
| `demo/` | 学校のデモ（1号館3階の間取り `1gokan_3F.json`、ホールの実写 `1gokan_hall.spz`） |
| `poster/` | 卒研ポスター（A1）。下に説明 |

間取りデータ: 50px = 1m。部屋は `wx,wy,ww,wh`（長方形）か `vertices`（多角形、斜めの壁OK）。開口は `wall`（North/East/South/West）か `edgeIndex`。

## 実写（ガウシアンスプラット）
- 入れられる形式: **.spz**（Scaniverse で「Splat」を選んで撮る）と **.ply**（PCソフトで作った3DGS形式）。.ply はブラウザで .spz に変換してから登録。
- .usdz（Mesh）や SPZ v4（Postshot の新形式）は不可。PCソフトからは .ply で書き出す。
- 位置合わせは自動（床の高さ → 壁の向き → 間取りの壁と一番重なる位置）。「撮った部屋」を選ぶとその部屋の中だけで合わせる。
- Scaniverse のスキャンはモヤが出やすい。きれいにするなら、スマホで動画（2〜3分）→ PCの GPU（しまのPCは RTX 3060）で Spirula Studio か RealityScan→Brush → .ply。

## ポスター（`poster/`）
- `poster.html` → `VR_Homes_ポスター_A1.pdf`。A1縦（594×841mm）、提出はPDF。載せるのはシステム名・概要・クラス名と班番号だけ（氏名は載せない）。
- 画像はすべて印刷で 300dpi 以上（`assets/`）。影（box-shadow）はPDFで粗い画像になるので使わない。
- はみ出す飾りがあると Chrome が中身を縮めるので、`html, body { overflow: hidden }` は消さない。
- PDFを作る: `cd poster/tools` → `npm i playwright` → `npx playwright install chromium` → `node make_pdf.js`
- 画面を撮り直す: `python demo_plan.py` → `python draw_madori.py` → `node capture.js vr`（`ed` `phone` `yk` `feat` も）。サイトをローカルで動かさなくても、リポジトリの中のファイルを直接開いて撮る。

## 予定（2026年度）
- 11月末: ポスター提出・システム制作完了 / 12/4: プレ展示 / 12月中: 紹介動画提出（1分の動画は作成済み）
- 1/22: 中間発表（システム・ポスター・動画・アンケート） / 2/4: 展示会
- アンケートはまだ作っていない。

## これからやること
- ホールの実写を撮り直す（PCで .ply を作る）→ 学校デモに入れ直す
- スマホVR・iPhone・Android・Quest を実機で確認
- 展示会用のアンケート

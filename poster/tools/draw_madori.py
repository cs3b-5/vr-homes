import json, os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
from PIL import Image, ImageDraw, ImageFont
p = json.load(open(os.path.join(HERE, '..', '..', 'demo', '_p2ldk.json'), encoding='utf-8'))
K = 3; S = 1.9 * K; M = 70 * K
W, H = int(500 * S + 2 * M), int(375 * S + 2 * M + 40 * K)
im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
FP = ([f for f in ['C:/Windows/Fonts/YuGothM.ttc', 'C:/Windows/Fonts/meiryo.ttc', 'C:/Windows/Fonts/msgothic.ttc'] if os.path.exists(f)] + glob.glob('/usr/share/fonts/**/NotoSansCJK-Regular.ttc', recursive=True))[0]
F = lambda s: ImageFont.truetype(FP, s * K)
X = lambda x: M + x * S; Y = lambda y: M + 40 * K + y * S
T = 9 * K
d.text((M, 20 * K), '2LDK　約70㎡', font=F(26), fill='black')
for r in p['rooms']:
    x, y, w, h = r['wx'], r['wy'], r['ww'], r['wh']
    d.rectangle([X(x), Y(y), X(x + w), Y(y + h)], outline='black', width=T)
for r in p['rooms']:
    x, y, w, h = r['wx'], r['wy'], r['ww'], r['wh']
    for o in r['openings']:
        L = o['width'] * 50 * S; a = o['offsetAlongWall']
        if o['wall'] in ('North', 'South'):
            cx = X(x + w * a); yy = Y(y) if o['wall'] == 'North' else Y(y + h)
            if o['type'] == 'window':
                d.rectangle([cx - L / 2, yy - T / 2, cx + L / 2, yy + T / 2], fill='white', outline='black', width=2 * K); d.line([cx - L / 2, yy, cx + L / 2, yy], fill='black', width=2 * K)
            else:
                d.rectangle([cx - L / 2, yy - T / 2 - K, cx + L / 2, yy + T / 2 + K], fill='white')
                d.arc([cx - L / 2 - L, yy - L, cx - L / 2 + L, yy + L], 270 if o['wall'] == 'North' else 0, 360 if o['wall'] == 'North' else 90, fill='black', width=2 * K)
        else:
            cy = Y(y + h * a); xx = X(x) if o['wall'] == 'West' else X(x + w)
            if o['type'] == 'window':
                d.rectangle([xx - T / 2, cy - L / 2, xx + T / 2, cy + L / 2], fill='white', outline='black', width=2 * K); d.line([xx, cy - L / 2, xx, cy + L / 2], fill='black', width=2 * K)
            else:
                d.rectangle([xx - T / 2 - K, cy - L / 2, xx + T / 2 + K, cy + L / 2], fill='white')
                d.arc([xx - L, cy - L / 2 - L, xx + L, cy - L / 2 + L], 0, 90, fill='black', width=2 * K)
lab = {'LDK': 'LDK 約16帖', '洋室1': '洋室 約6帖', '洋室2': '洋室 約4.5帖', '玄関': '玄関', '浴室': '浴室', '洗面所': '洗面', 'トイレ': 'WC', '収納': '収納'}
for r in p['rooms']:
    t = lab.get(r['name'], r['name']); f = F(30 if r['ww'] > 120 else 20)
    bb = d.textbbox((0, 0), t, font=f); cx = X(r['wx'] + r['ww'] / 2); cy = Y(r['wy'] + r['wh'] / 2)
    d.text((cx - (bb[2] - bb[0]) / 2, cy - (bb[3] - bb[1]) / 2 - 6 * K), t, font=f, fill='black')
im.save(os.path.join(HERE, '..', 'assets', 'madori.png')); print(im.size, FP)

import json, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "demo", "_p2ldk.json")  # 撮影用の見本の間取り（撮り終わったら消してOK）
def R(name, x, y, w, h, ops, color, kind=None):
    r = {"name": name, "wx": x, "wy": y, "ww": w, "wh": h, "openings": ops, "color": color}
    if kind: r["kind"] = kind
    return r
D = lambda wall, at, w=0.8, t="swing_left": {"type": "door", "wall": wall, "offsetAlongWall": at, "width": w, "height": 2.0, "doorType": t}
W = lambda wall, at, w, h=1.2: {"type": "window", "wall": wall, "offsetAlongWall": at, "width": w, "height": h}
rooms = [
  R("LDK", 175, 0, 325, 225, [W("North", .3, 2.4, 2.0), W("North", .78, 1.8, 2.0), W("East", .45, 1.6, 1.2)], "#1D9E75"),
  R("洋室1", 0, 0, 175, 225, [D("East", .78), W("North", .5, 1.6), W("West", .4, 1.2)], "#185FA5"),
  R("洋室2", 0, 225, 175, 150, [W("West", .5, 1.2), W("South", .5, 1.4)], "#185FA5"),
  R("玄関", 175, 225, 100, 150, [D("North", .5, 0.9), D("West", .4), D("South", .5, 0.9)], "#B45309", "entry"),
  R("浴室", 275, 265, 100, 110, [D("East", .4, 0.7, "slide")], "#64748B", "bath"),
  R("洗面所", 375, 265, 75, 110, [D("North", .5, 0.75, "slide")], "#64748B", "wash"),
  R("トイレ", 450, 265, 50, 110, [D("North", .5, 0.7)], "#64748B", "wc"),
  R("収納", 275, 225, 225, 40, [], "#94A3B8"),
]
F = lambda t, n, cx, cy, w, d, h, rot=0, col="#8B6914": {"type": t, "name": n, "cx": cx, "cy": cy, "w": w, "d": d, "h": h, "rotation": rot, "color": col}
furn = [
  F("kitchen", "キッチン", 380, 205, 2.4, 0.65, 0.9, 0, "#E5E7EB"),
  F("fridge", "冷蔵庫", 465, 205, 0.65, 0.65, 1.8, 0, "#D1D5DB"),
  F("table", "ダイニングテーブル", 250, 95, 1.4, 0.8, 0.72, 0, "#A0522D"),
  F("chair", "チェア", 230, 67, 0.45, 0.45, 0.85, 0, "#6B4423"), F("chair", "チェア", 270, 67, 0.45, 0.45, 0.85, 0, "#6B4423"),
  F("chair", "チェア", 230, 123, 0.45, 0.45, 0.85, 180, "#6B4423"), F("chair", "チェア", 270, 123, 0.45, 0.45, 0.85, 180, "#6B4423"),
  F("sofa", "ソファ", 472, 100, 2.0, 0.85, 0.8, 90, "#3F6E8C"),
  F("lowtable", "ローテーブル", 418, 100, 1.0, 0.55, 0.4, 90, "#C8A16E"),
  F("tv", "テレビ台", 362, 100, 1.6, 0.4, 0.5, 270, "#374151"),
  F("plant", "観葉植物", 490, 20, 0.4, 0.4, 1.2, 0, "#3F7D3A"),
  F("bed", "ベッド", 60, 120, 1.4, 2.0, 0.5, 0, "#E8D5B5"),
  F("desk", "デスク", 140, 25, 1.0, 0.5, 0.72, 0, "#A0522D"), F("chair", "チェア", 140, 55, 0.45, 0.45, 0.85, 180, "#374151"),
  F("closet", "クローゼット", 87, 213, 1.6, 0.5, 2.0, 0, "#D6C7A8"),
  F("bed", "ベッド", 55, 300, 1.0, 2.0, 0.5, 90, "#B5C7E8"),
  F("desk", "デスク", 150, 340, 0.9, 0.5, 0.72, 0, "#A0522D"),
  F("shoebox", "下駄箱", 262, 330, 0.4, 1.0, 1.0, 0, "#D6C7A8"),
  F("bathtub", "浴槽", 325, 335, 1.6, 0.75, 0.6, 0, "#F3F4F6"),
  F("washstand", "洗面台", 412, 355, 0.75, 0.5, 0.85, 0, "#F3F4F6"),
  F("washpan", "洗濯機置場", 412, 300, 0.64, 0.64, 0.1, 0, "#F3F4F6"),
  F("toilet", "トイレ", 475, 350, 0.4, 0.7, 0.75, 0, "#FFFFFF"),
]
tags = [{"x": 340, "y": 8, "h": 1.6, "title": "南向きの大きな窓", "text": "日当たりのいいリビングです。"}]
json.dump({"rooms": rooms, "furnitures": furn, "walls": [], "tags": tags, "north": 180}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

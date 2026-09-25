# 曲库资产（清洗于 2026-09-25）

扫描 343 → 入库 172（abcjs 权威解析，音符序列已预编译随曲打包）
淘汰：解析失败 0、过短 36、过长 18、重名 2、超类别上限 115
分布：儿歌童谣 32、古典名曲 70、民谣传统 70、基础练习 3，打包体积约 1595 KB

来源与授权：
- thesession.org — 传统曲调（旋律公有领域），站点内容 CC BY-SA
- mutopiaproject.org — Public Domain 93 首 / CC BY-SA 6 首（由官方 MIDI 转换为 ABC）
- trillian.mit.edu（John Chambers）与 abcnotation.com — 传统曲目合集

清洗规则：X:/K: 头齐全；abcjs 解析 ≥4 音符；时长 6–240s；跨源按曲名去重。
预编译序列含 [midi, hand]，练习引擎直接消费；曲谱原文保留用于 H5 渲染。
商业分发提示：传统/公有领域旋律可安全内置；现代编配版需逐曲核对。

## 自制补充曲目（custom/）

| id | 曲名 | 来源 | 入库日期 |
|----|------|------|----------|
| cu-s1 | 菊次郎的夏天 Summer（古典名曲包） | bitmidi.com 公开 MIDI（quantized 转谱，`add_summer.js` 管线：量化→双声部 ABC→fromABC 预编译） | 2026-09-25 |

⚠️ cu-s1 为久石让受版权保护作品（©1999），仅限个人练习使用；商业化分发前需取得授权。

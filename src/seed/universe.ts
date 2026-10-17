// 评测标的范围。基金风险等级为“适当性主数据”的构造样例（非任何销售机构的真实评级）。
import type { Entity } from '../core/types';

export const STOCK_UNIVERSE: Entity[] = [
  { thscode: '600519.SH', name: '贵州茅台', aliases: ['茅台'], type: 'stock', sector: '白酒' },
  { thscode: '300750.SZ', name: '宁德时代', aliases: ['宁王'], type: 'stock', sector: '动力电池' },
  { thscode: '600036.SH', name: '招商银行', aliases: ['招行'], type: 'stock', sector: '银行' },
  { thscode: '002594.SZ', name: '比亚迪', aliases: [], type: 'stock', sector: '汽车' },
  { thscode: '300033.SZ', name: '同花顺', aliases: [], type: 'stock', sector: '金融科技' },
  { thscode: '688981.SH', name: '中芯国际', aliases: [], type: 'stock', sector: '半导体' },
];

export const FUND_MASTER: (Entity & { risk_level: 1 | 2 | 3 | 4 | 5 })[] = [
  { thscode: '000198.OF', name: '天弘余额宝货币', aliases: ['余额宝', '天弘余额宝'], type: 'fund', risk_level: 1, category: '货币基金' },
  { thscode: '217022.OF', name: '招商产业债券A', aliases: ['招商产业债', '产业债A'], type: 'fund', risk_level: 2, category: '债券基金' },
  { thscode: '510300.SH', name: '沪深300ETF', aliases: ['华泰柏瑞沪深300ETF', '沪深300ETF华泰柏瑞', '300ETF'], type: 'fund', risk_level: 3, category: '宽基指数ETF' },
  { thscode: '005827.OF', name: '易方达蓝筹精选混合', aliases: ['易方达蓝筹精选', '易方达蓝筹', '蓝筹精选'], type: 'fund', risk_level: 4, category: '偏股混合基金' },
  { thscode: '161725.SZ', name: '招商中证白酒指数', aliases: ['招商中证白酒', '白酒指数基金', '中证白酒基金', '白酒基金LOF', '白酒基金'], type: 'fund', risk_level: 4, category: '行业主题指数基金' },
];

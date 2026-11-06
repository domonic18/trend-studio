/**
 * 学员端 K 线：复用 @trend/widgets/kline 的图表类与类型。
 * 本地保留历史入口，避免 coach 其他文件改 import。
 */

export { KlineChart, type KlineBar, type KlineEvent, type KlineChartOptions } from '@trend/widgets/kline'

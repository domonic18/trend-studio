/**
 * 浏览器半的打包：产出 lib/client.js——dsh 客户端模块系统装载的形态。
 *
 * 产物不是普通 UMD，而是一个「注册 factory」的脚本：模块体（连同它的样式注入）
 * 都在 factory 闭包里，只有被物化时才执行。宿主侧 client-modules 按包清单
 * 扫描本文件，缺失即启动失败。
 *
 * 外部依赖只留平台基座里的那几个（react 系与 dsh 客户端基座包）——它们由
 * 浏览器模块表提供，运行时从模块表取，不打进本包。
 */
import { build } from 'esbuild'

const pkg = 'dsh-plugin-trend-producer'

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  minify: true,
  legalComments: 'eof',
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    'zod',
    '@tanstack/react-virtual',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-dockkit',
  ],
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

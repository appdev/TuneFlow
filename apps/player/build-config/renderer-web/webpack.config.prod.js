const path = require('node:path')
const webpack = require('webpack')
const HTMLPlugin = require('html-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const base = require('../renderer/webpack.config.base')
const web = path.resolve(__dirname, '../../src/web-runtime')
module.exports = {
  ...base,
  mode: 'production',
  target: 'web',
  devtool: false,
  entry: { renderer: path.join(web, 'entry.ts') },
  output: { filename: '[name].[contenthash:8].js', path: process.env.Q_WEB_OUTPUT || path.resolve(__dirname, '../../dist/web-client'), publicPath: 'auto', clean: true },
  resolve: {
    ...base.resolve,
    alias: {
      '@web-runtime': web,
      '@common/rendererIpc$': path.join(web, 'rendererIpc.ts'),
      'electron$': path.join(web, 'electron.ts'),
      'electron-log/node$': path.join(web, 'log.ts'),
      '@common/utils/nodejs$': path.join(web, 'files.ts'),
      '@renderer/worker$': path.join(web, 'workers.ts'),
      '@renderer/worker/utils$': path.join(web, 'workers.ts'),
      '@renderer/utils/musicSdk$': path.join(web, 'catalog.ts'),
      '@renderer/service/accounts$': path.join(web, 'accounts.ts'),
      crypto: path.join(web, 'crypto.ts'),
      zlib: path.join(web, 'zlib.ts'),
      ...base.resolve.alias,
    },
    fallback: Object.fromEntries(['fs', 'child_process', 'dns', 'net', 'tls', 'http', 'https', 'stream', 'util', 'url', 'assert', 'querystring', 'events'].map(name => [name, false])),
  },
  module: { rules: base.module.rules.filter(rule => String(rule.test) !== String(/\.node$/)).map(rule => String(rule.test) === String(/\.tsx?$/) ? { ...rule, use: { ...rule.use, options: { ...rule.use.options, transpileOnly: true } } } : rule) },
  plugins: [
    ...base.plugins.filter(plugin => !['HtmlWebpackPlugin', 'ESLintWebpackPlugin'].includes(plugin.constructor.name)),
    new HTMLPlugin({ template: path.join(web, 'index.html'), title: 'Q-music Web' }),
    new CopyWebpackPlugin({ patterns: [{ from: path.resolve(__dirname, '../../src/static'), to: 'static' }, { from: path.resolve(__dirname, '../../src/common/theme/images'), to: 'theme_images' }] }),
    new webpack.DefinePlugin({ 'process.env.NODE_ENV': JSON.stringify('production'), __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false', COMMIT_ID: '""', COMMIT_DATE: '""' }),
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'], process: [path.join(web, 'process.ts'), 'default'] }),
    new webpack.NormalModuleReplacementPlugin(/^node:(?:path|os)$/, path.join(web, 'paths.ts')),
    new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, path.join(web, 'crypto.ts')),
    new webpack.NormalModuleReplacementPlugin(/^node:fs(?:\/promises)?$/, path.join(web, 'unavailable.ts')),
    new webpack.NormalModuleReplacementPlugin(/renderer[\\/]worker[\\/](?:utils[\\/])?index\.ts$/, path.join(web, 'workers.ts')),
    new webpack.NormalModuleReplacementPlugin(/renderer[\\/]utils[\\/]request\.js$/, path.join(web, 'request.ts')),
    new webpack.NormalModuleReplacementPlugin(/common[\\/]utils[\\/]request(?:_node16)?\.ts$/, path.join(web, 'request.ts')),
    new webpack.NormalModuleReplacementPlugin(/renderer[\\/]service[\\/]accounts\.ts$/, path.join(web, 'accounts.ts')),
  ],
  performance: { hints: false },
}

const path = require('path')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('vue-loader')
const HTMLPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const ESLintPlugin = require('eslint-webpack-plugin')

const vueLoaderConfig = require('../vue-loader.config')
const { mergeCSSLoader } = require('../utils')

const isDev = process.env.NODE_ENV === 'development'
const webRuntime = path.join(__dirname, '../../src/web-runtime')

module.exports = {
  target: 'web',
  entry: {
    renderer: path.join(webRuntime, 'entry.ts'),
  },
  output: {
    filename: '[name].js',
    path: path.join(__dirname, '../../dist/web'),
    publicPath: '',
  },
  resolve: {
    alias: {
      '@web-runtime': webRuntime,
      '@common/rendererIpc': path.join(webRuntime, 'rendererIpc.ts'),
      '@common/defaultSetting': path.join(webRuntime, 'rendererIpc.ts'),
      '@root': path.join(__dirname, '../../src'),
      '@renderer': path.join(__dirname, '../../src/renderer'),
      '@common': path.join(__dirname, '../../src/common'),
    },
    extensions: ['.tsx', '.ts', '.js', '.json', '.node'],
    fallback: {
      assert: false,
      child_process: false,
      crypto: false,
      dns: false,
      fs: false,
      http: false,
      https: false,
      net: false,
      os: false,
      path: false,
      perf_hooks: false,
      stream: false,
      tls: false,
      url: false,
      util: false,
      zlib: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            appendTsSuffixTo: [/\.vue$/],
            transpileOnly: true,
          },
        },
        parser: {
          worker: [
            '*audioContext.audioWorklet.addModule()',
            '...',
          ],
        },
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: vueLoaderConfig,
      },
      {
        test: /\.pug$/,
        loader: 'pug-plain-loader',
      },
      {
        test: /\.css$/,
        oneOf: mergeCSSLoader(),
      },
      {
        test: /\.less$/,
        oneOf: mergeCSSLoader({
          loader: 'less-loader',
          options: {
            sourceMap: true,
          },
        }),
      },
      {
        test: /\.(png|jpe?g|gif|svg)(\?.*)?$/,
        exclude: path.join(__dirname, '../../src/renderer/assets/svgs'),
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 10000,
          },
        },
        generator: {
          filename: 'imgs/[name]-[contenthash:8][ext]',
        },
      },
      {
        test: /\.svg$/,
        include: path.join(__dirname, '../../src/renderer/assets/svgs'),
        use: [
          {
            loader: 'svg-sprite-loader',
            options: {
              symbolId: 'icon-[name]',
            },
          },
          'svg-transform-loader',
          'svgo-loader',
        ],
      },
      {
        test: /\.(mp4|webm|ogg|mp3|wav|flac|aac)$/,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 10000,
          },
        },
        generator: {
          filename: 'media/[name]-[contenthash:8][ext]',
        },
      },
      {
        test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 10000,
          },
        },
        generator: {
          filename: 'fonts/[name]-[contenthash:8][ext]',
        },
      },
    ],
  },
  plugins: [
    new HTMLPlugin({
      filename: 'index.html',
      template: path.join(webRuntime, 'index.html'),
      favicon: path.join(__dirname, '../../TuneFlow.png'),
      isProd: process.env.NODE_ENV == 'production',
      browser: process.browser,
      __dirname,
    }),
    new VueLoaderPlugin(),
    new MiniCssExtractPlugin({
      filename: isDev ? '[name].css' : '[name].[contenthash:8].css',
      chunkFilename: isDev ? '[id].css' : '[id].[contenthash:8].css',
    }),
    new ESLintPlugin({
      extensions: ['js', 'vue'],
      formatter: 'stylish',
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.NormalModuleReplacementPlugin(
      /^node:crypto$/,
      path.join(webRuntime, 'browser.ts'),
    ),
    new webpack.NormalModuleReplacementPlugin(
      /^node:(?:os|path)$/,
      path.join(webRuntime, 'node.ts'),
    ),
    new webpack.NormalModuleReplacementPlugin(
      /src[\\/]renderer[\\/]utils[\\/]request\.js$/,
      path.join(webRuntime, 'request.ts'),
    ),
  ],
}

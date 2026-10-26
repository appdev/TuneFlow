const webpack = require('webpack')
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin')
const { merge } = require('webpack-merge')

const baseConfig = require('./webpack.config.base')
const buildConfig = require('../webpack-build-config')

module.exports = merge(baseConfig, {
  mode: 'production',
  devtool: 'source-map',
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: '"production"',
      },
      'process.platform': '"web"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      COMMIT_ID: '""',
      COMMIT_DATE: '""',
    }),
  ],
  optimization: {
    minimize: buildConfig.minimize,
    minimizer: [
      new TerserPlugin(),
      new CssMinimizerPlugin(),
    ],
    splitChunks: {
      chunks: 'initial',
      minChunks: 2,
    },
  },
  performance: {
    maxEntrypointSize: 1024 * 1024 * 10,
    maxAssetSize: 1024 * 1024 * 20,
    hints: 'warning',
  },
})

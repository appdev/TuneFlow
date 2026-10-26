const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const path = require('node:path')
const fs = require('node:fs')
const appModules = fs.realpathSync(path.join(__dirname, 'node_modules'))

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '../../packages'), appModules],
  resolver: {
    nodeModulesPaths: [appModules],
    disableHierarchicalLookup: true,
    extraNodeModules: {
      // crypto: require.resolve('react-native-quick-crypto'),
      // stream: require.resolve('stream-browserify'),
      buffer: path.dirname(require.resolve('@craftzdog/react-native-buffer/package.json')),
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)

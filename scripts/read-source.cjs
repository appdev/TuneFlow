const fs = require('node:fs')
const path = require('node:path')
// Test VM loaders retain their dependency injection while following shared facades.
module.exports = function readSource(filename) {
  const visited = new Set()
  while (true) {
    if (visited.has(filename)) throw Error('Circular source facade')
    visited.add(filename)
    const source = fs.readFileSync(filename, 'utf8')
    const redirect = /^export \* from ['"]([^'"]+)['"]/m.exec(source)
    if (!redirect) return source
    filename = path.resolve(path.dirname(filename), redirect[1] + '.ts')
  }
}

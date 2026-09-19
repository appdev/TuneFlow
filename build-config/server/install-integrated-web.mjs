import { cpSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const validateIntegratedWeb = (source) => {
  for (const name of ['index.html', 'flutter_bootstrap.js', 'main.dart.js', 'V2/index.html', 'V2/renderer.js']) {
    const file = path.join(source, name)
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).size === 0) {
      throw new Error(`Missing integrated Web asset: ${name}. Run npm run build:web:integrated -- /path/to/flutter-client first.`)
    }
  }
  if (!/<base\s+href=["']\/["']/i.test(readFileSync(path.join(source, 'index.html'), 'utf8'))) {
    throw new Error('Flutter Web must be built with --base-href /')
  }
  const visit = (directory) => {
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Integrated Web must not contain symbolic links')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Integrated Web must not contain symbolic links')
      if (entry.isDirectory()) visit(path.join(directory, entry.name))
    }
  }
  visit(source)
}

// The Docker build stage has no dist/web yet. Refuse to overwrite an existing
// directory when this utility is accidentally invoked in a developer checkout.
export const installIntegratedWeb = (root) => {
  const source = path.join(root, 'dist/web-integrated')
  const destination = path.join(root, 'dist/web')
  validateIntegratedWeb(source)
  if (existsSync(destination)) throw new Error('Refusing to overwrite existing dist/web')
  cpSync(source, destination, { recursive: true })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  installIntegratedWeb(process.cwd())
}

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import ts from 'typescript'

// Keep transport behavior identical to the other clients without changing
// their module format or requiring a TypeScript loader at runtime.
const source = await readFile(new URL('../../../packages/service-client/src/client.ts', import.meta.url), 'utf8')
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
await writeFile(new URL('../dist/client.mjs', import.meta.url), result.outputText)

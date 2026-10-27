import { expect, it, vi } from 'vitest'
import { buildNeteaseWeapiForm } from '../../../../../packages/platform-accounts/src/neteaseWeapi'

vi.mock('node:crypto', async importOriginal => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomBytes: () => Buffer.alloc(16),
}))

it('matches the official Web asrsea output byte for byte for the same payload and random key', () => {
  // Captured from the public official Web script with synthetic inputs and
  // Math.random=0 (sixteen "a" characters). No real account data is involved.
  const form = buildNeteaseWeapiForm({ type: 1, key: 'synthetic-qr-key', csrf_token: 'synthetic-csrf' })
  expect(form.get('params')).toBe('FSLzIa4qem8d53Zk8LqWDdF1XhosYim9TmDynSsT7xVNilu6QF03fc0OBJDDxIjBQXDHMg8fQMZRzgiL0923t0/w1lsye7mX49aZA8Hx7lcEzwr4GRYOR/rFe1lQ6/z3ZsPbqHcXplzVMY/gHoPStA==')
  expect(form.get('encSecKey')).toBe('d473b9eca232f1b4090dd606b0df86de318748dd2eec307e4ed4345030fc4ee30331e598f41d5a6f5befaab94630ea1a1eda7cfade84fbec1a907913d2e4d2c8744bc572b99a050075e075b4537f645ecfa994f95906c32818e076aeda6bdb906bfa0bb96c4cf4bc3ed6d9ab76cf08441153d9d85e1ea3d78fa8d9210d581cee')
})

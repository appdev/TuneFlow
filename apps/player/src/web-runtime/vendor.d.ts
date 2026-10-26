// Narrow declarations for existing JavaScript dependencies; no runtime polyfills.
declare module 'crypto-js' {
  const CryptoJS: any
  export default CryptoJS
}
declare module 'pako' {
  const pako: {
    gzip: (value: string | Uint8Array) => Uint8Array
    ungzip: { (value: Uint8Array): Uint8Array, (value: Uint8Array, options: { to: 'string' }): string }
    inflate: (value: Uint8Array) => Uint8Array
    deflateRaw: (value: Uint8Array) => Uint8Array
  }
  export default pako
}

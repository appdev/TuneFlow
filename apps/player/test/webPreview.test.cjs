const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createPreview } = require('../scripts/serve-web-service.cjs')
const listen = server => new Promise(resolve => server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})

test('live preview serves only its frozen root and preserves Service POST, identity and Range responses', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'tuneflow-web-preview-'))
  const web = path.join(root,'web'); fs.mkdirSync(web)
  fs.writeFileSync(path.join(web,'index.html'),'<h1>Frozen UI</h1>')
  fs.writeFileSync(path.join(root,'outside.txt'),'not public')
  fs.symlinkSync(path.join(root,'outside.txt'),path.join(web,'link.txt'))
  const backend = http.createServer(async(req,res)=>{
    if(req.url==='/api/v1/streams/test') {
      assert.equal(req.headers.range,'bytes=1-3')
      res.writeHead(206,{'Content-Type':'audio/mpeg','Content-Range':'bytes 1-3/5','Accept-Ranges':'bytes'})
      res.end(Buffer.from([1,2,3])); return
    }
    let raw=''; for await(const chunk of req)raw+=chunk
    res.setHeader('Content-Type','application/json')
    res.end(JSON.stringify({method:req.method,body:JSON.parse(raw),identity:req.headers['x-tuneflow-client-id']}))
  })
  let preview
  try {
    const backendOrigin = await listen(backend)
    preview = createPreview({webRoot:web,serviceOrigin:backendOrigin})
    const origin = await listen(preview)
    assert.equal(await (await fetch(origin)).text(),'<h1>Frozen UI</h1>')
    assert.equal((await fetch(origin+'/link.txt')).status,404)
    assert.equal((await fetch(origin+'/%2e%2e%2foutside.txt')).status,404)
    assert.equal((await fetch(origin,{method:'POST'})).status,405)
    const response = await fetch(origin+'/api/v1/catalog/tracks/search',{method:'POST',headers:{'Content-Type':'application/json','X-TuneFlow-Client-Id':'preview-test-client'},body:JSON.stringify({source:'tx',text:'sample'})})
    assert.deepEqual(await response.json(),{method:'POST',body:{source:'tx',text:'sample'},identity:'preview-test-client'})
    const range = await fetch(origin+'/api/v1/streams/test',{headers:{Range:'bytes=1-3'}})
    assert.equal(range.status,206); assert.equal(range.headers.get('content-range'),'bytes 1-3/5')
    assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.from([1,2,3]))
    assert.throws(()=>createPreview({webRoot:web,serviceOrigin:'http://user:password@localhost'}),/credential-free/)
  } finally { if(preview)await close(preview);await close(backend);fs.rmSync(root,{recursive:true,force:true}) }
})

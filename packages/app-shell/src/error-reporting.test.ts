import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { startErrorReporting, reportError } from './error-reporting'
let stop = () => {}
const originalFetch = globalThis.fetch
const originalBeacon = navigator.sendBeacon
afterEach(() => { stop();globalThis.fetch=originalFetch; navigator.sendBeacon=originalBeacon })
it('does not send under the dev server',async () => {
 let sent = 0
 globalThis.fetch = Object.assign(async () => {sent++;return new Response(null,{status:204})}, {preconnect:originalFetch.preconnect})
 stop=startErrorReporting('web',null,false)
 reportError(new Error('failed'))
 window.dispatchEvent(new Event('pagehide'))
 await Promise.resolve()
 expect(sent).toBe(0)
})
it('deduplicates errors and caps each page at twenty reports sent with keepalive',async () => {
 const bodies:string[]=[]
 globalThis.fetch = Object.assign(async (_input:unknown,init?:RequestInit) => {expect(init?.keepalive).toBe(true);bodies.push(String(init?.body));return new Response(null,{status:204})},{preconnect:originalFetch.preconnect})
 navigator.sendBeacon=()=>false
 stop=startErrorReporting('web',null,true)
 for(let i=0;i<30;i++){const error = new Error('failed');error.name='Error'+i;reportError(error);reportError(error)}
 window.dispatchEvent(new Event('pagehide'))
 await Promise.resolve()
 expect(bodies).toHaveLength(1)
 expect(JSON.parse(bodies[0] ?? '{}').reports).toHaveLength(20)
})
it('uses sendBeacon on page hide when available',() => {
 let body:Blob | undefined
 navigator.sendBeacon=(_url,data)=>{if(data instanceof Blob) body=data;return true}
 stop=startErrorReporting('web',null,true)
 reportError(new Error('failed'))
 window.dispatchEvent(new Event('pagehide'))
 expect(body?.type).toBe('application/json')
})

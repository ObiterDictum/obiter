// Wires the SSR request into @obiter/app-shell so apiFetch can forward
// the session cookie during server rendering. This file must be imported
// on both client and server — the `typeof window` guard ensures it only
// registers the getter on the server. The dynamic indirection (app-shell
// does not directly import from '@tanstack/react-start/server') avoids
// Vite static-analysis workarounds in app-shell's tests and keeps the
// dependency where it belongs (web, which has @tanstack/react-start).
import { getRequest } from '@tanstack/react-start/server'
import { setServerRequestGetter } from '@obiter/app-shell'

if (typeof window === 'undefined') {
  setServerRequestGetter(getRequest)
}

// Wires the incoming SSR request into @obiter/app-shell so apiFetch can forward
// the session cookie during server rendering.
//
// createIsomorphicFn has only a server branch here, so the start compiler
// replaces the call with `() => {}` in the client build and the
// '@tanstack/react-start/server' import is dropped with it. A `typeof window`
// guard does not work: the import stays statically visible to the client graph
// and the import-protection plugin fails the production build on it (#121).
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { setServerRequestGetter } from '@obiter/app-shell'

export const initServerRequest = createIsomorphicFn().server(() => {
  setServerRequestGetter(getRequest)
})

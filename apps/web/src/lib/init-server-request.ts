import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { setServerRequestGetter } from '@obiter/app-shell'

export const initServerRequest = createIsomorphicFn().server(() => {
  setServerRequestGetter(getRequest)
})

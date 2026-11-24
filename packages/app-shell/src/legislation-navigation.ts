export type ProvisionResultLocation = {
  to: '/ln/$'
  params: { _splat: string }
}

export function provisionResultLocation(result: {
  documentIdentity: string
  labelPath: string
}): ProvisionResultLocation {
  const splat = result.labelPath
    ? `${result.documentIdentity}/${result.labelPath}`
    : result.documentIdentity
  return {
    to: '/ln/$',
    params: { _splat: splat },
  }
}

import type { SVGProps } from 'react'

export type IconWeight = 'regular' | 'bold' | 'fill'

export interface IconProps<Weight extends IconWeight = IconWeight> extends Omit<
  SVGProps<SVGSVGElement>,
  'children' | 'color'
> {
  size?: number | string
  weight?: Weight
  color?: string
  mirrored?: boolean
  alt?: string
}

export function createIcon<Weight extends IconWeight>(
  paths: Readonly<Record<'regular' | Weight, string>>,
) {
  return function Icon({
    size,
    weight = 'regular',
    color = 'currentColor',
    mirrored,
    alt,
    ...rest
  }: IconProps<'regular' | Weight>) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        fill={color}
        viewBox="0 0 256 256"
        transform={mirrored ? 'scale(-1, 1)' : undefined}
        {...rest}
      >
        {alt ? <title>{alt}</title> : null}
        <path d={paths[weight]} />
      </svg>
    )
  }
}

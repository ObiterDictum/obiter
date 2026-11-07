import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  useToast,
} from '@obiter/ui'
import { formatJudgmentCitation } from './judgment-citation'

export function JudgmentParagraphActions({
  number,
  text,
  name,
  citation,
  page,
}: {
  page?: number
  number: number
  text: string
  name: string
  citation: string | null
}) {
  const { toast } = useToast()
  async function copy(kind: 'quote' | 'citation' | 'link') {
    const formatted = formatJudgmentCitation(
      name,
      citation,
      number,
      number,
      page,
    ).text
    const url = new URL(window.location.href)
    url.hash = `para-${number}`
    try {
      await navigator.clipboard.writeText(
        kind === 'link'
          ? url.href
          : kind === 'quote'
            ? `${text}\n${formatted}`
            : formatted,
      )
      toast({ title: 'Copied' })
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Check clipboard permissions and try again.',
      })
    }
  }
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={<MenuTrigger />}
          aria-label={`Paragraph ${number} actions`}
          className="group/number relative after:absolute after:-left-3 after:opacity-0 after:content-['⋮'] hover:after:opacity-100 focus:after:opacity-100 min-h-8 w-full rounded text-right outline-offset-2"
        >
          <span>{number}</span>
        </TooltipTrigger>
        <TooltipContent>Paragraph actions</TooltipContent>
      </Tooltip>
      <MenuContent align="start">
        <MenuItem onClick={() => void copy('quote')}>
          Copy with citation
        </MenuItem>
        <MenuItem onClick={() => void copy('citation')}>Copy citation</MenuItem>
        <MenuItem onClick={() => void copy('link')}>Copy link</MenuItem>
      </MenuContent>
    </Menu>
  )
}

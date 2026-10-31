import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  useToast,
} from '@obiter/ui'
import { Plus } from '@obiter/ui/icons'
import { useState, type FormEvent } from 'react'
import { useCreateMatter, type CreateMatterInput } from '../matters'

export function CreateMatterDialog({
  trigger = 'Create matter',
  variant = 'primary',
  size = 'sm',
}: {
  trigger?: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const createMatter = useCreateMatter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [clientReference, setClientReference] = useState('')
  const [primaryJurisdiction, setPrimaryJurisdiction] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!name.trim() || !primaryJurisdiction.trim()) {
      setError('Matter name and primary jurisdiction are required.')
      return
    }

    const input: CreateMatterInput = {
      name: name.trim(),
      primaryJurisdiction: primaryJurisdiction.trim(),
      clientReference: clientReference.trim() || undefined,
    }

    try {
      const matter = await createMatter.mutateAsync(input)
      toast({
        title: 'Matter created',
        description: `"${matter.name}" is ready.`,
        tone: 'success',
      })
      setName('')
      setClientReference('')
      setPrimaryJurisdiction('')
      setOpen(false)
      await navigate({
        to: '/matters/$matterId',
        params: { matterId: matter.id },
      })
    } catch {
      setError('Could not create the matter. Please try again.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={variant}
            size={size}
            iconStart={<Plus size={14} weight="bold" aria-hidden="true" />}
          >
            {trigger}
          </Button>
        }
      />
      <DialogContent size="md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <DialogTitle>Create a matter</DialogTitle>
            <DialogDescription>
              Matters are private workspaces scoped to your organisation.
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <Input
            label="Matter name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Acme Ltd v Beta Corp"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Client reference"
              value={clientReference}
              onChange={(event) => setClientReference(event.target.value)}
              placeholder="e.g. ACME-2026-001"
            />
            <Input
              label="Primary jurisdiction"
              required
              value={primaryJurisdiction}
              onChange={(event) => setPrimaryJurisdiction(event.target.value)}
              placeholder="e.g. England & Wales"
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <DialogClose
              render={
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" loading={createMatter.isPending}>
              Create matter
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

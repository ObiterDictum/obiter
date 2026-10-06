import { useState } from 'react'
import {
  DOCUMENT_EDIT_TABLE_MAX_COLUMNS,
  DOCUMENT_EDIT_TABLE_MAX_ROWS,
} from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@obiter/ui'

export function InsertTableDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (rows: number, columns: number) => void
}) {
  const [rows, setRows] = useState('2')
  const [columns, setColumns] = useState('2')
  const rowCount = Number(rows)
  const columnCount = Number(columns)
  const valid =
    Number.isInteger(rowCount) &&
    rowCount >= 1 &&
    rowCount <= DOCUMENT_EDIT_TABLE_MAX_ROWS &&
    Number.isInteger(columnCount) &&
    columnCount >= 1 &&
    columnCount <= DOCUMENT_EDIT_TABLE_MAX_COLUMNS
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogTitle>Insert table</DialogTitle>
        <DialogDescription>
          Inserts an empty bordered table after the current paragraph.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid) return
            onInsert(rowCount, columnCount)
            onOpenChange(false)
          }}
        >
          <div className="flex gap-3">
            <Input
              label="Rows"
              type="number"
              min={1}
              max={DOCUMENT_EDIT_TABLE_MAX_ROWS}
              value={rows}
              onChange={(event) => setRows(event.target.value)}
            />
            <Input
              label="Columns"
              type="number"
              min={1}
              max={DOCUMENT_EDIT_TABLE_MAX_COLUMNS}
              value={columns}
              onChange={(event) => setColumns(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              Cancel
            </DialogClose>
            <Button type="submit" size="sm" disabled={!valid}>
              Insert
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

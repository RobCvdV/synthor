import { memo, useCallback, useRef, type ReactNode } from 'react'

export interface FilePickerButtonProps {
  accept: string
  multiple?: boolean
  className?: string
  children: ReactNode
  onFiles: (files: FileList) => void
}

/** Hidden file input + button. Caller handles the picked files. */
export const FilePickerButton = memo(function FilePickerButton({
  accept, multiple, className, children, onFiles,
}: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const click = useCallback(() => inputRef.current?.click(), [])
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onFiles(e.target.files)
    // Reset so re-picking the same file fires onChange again.
    e.target.value = ''
  }, [onFiles])

  return (
    <>
      <button className={className} onClick={click}>{children}</button>
      <input ref={inputRef} type="file" hidden accept={accept} multiple={multiple} onChange={handleChange} />
    </>
  )
})
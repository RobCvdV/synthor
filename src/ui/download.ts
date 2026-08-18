/** Trigger a browser download, then release the object URL. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadBytes(bytes: ArrayBuffer, filename: string) {
  downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), filename)
}

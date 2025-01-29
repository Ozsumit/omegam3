import JSZip from "jszip"

export async function zipFiles(files: File[]): Promise<Blob> {
  const zip = new JSZip()

  for (const file of files) {
    if (file.webkitRelativePath) {
      // This is a file within a folder
      zip.file(file.webkitRelativePath, file)
    } else {
      zip.file(file.name, file)
    }
  }

  return await zip.generateAsync({ type: "blob", compression: "STORE" })
}

export async function unzipFiles(zipBlob: Blob): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipBlob)
  const files: File[] = []

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (!zipEntry.dir) {
      const blob = await zipEntry.async("blob")
      files.push(new File([blob], relativePath.split("/").pop() || "unknown", { type: blob.type }))
    }
  }

  return files
}


export const MAX_IMPULSE_BYTES = 8 * 1024 * 1024;

export async function prepareImpulseImage(file: Blob, contrast: number) {
  if (!Number.isFinite(contrast) || contrast < 0.25 || contrast > 3)
    throw new Error("Image contrast must be between 0.25 and 3.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 3840 / image.width, 2160 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Pixel processing also works in Safari versions without canvas filters.
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4)
      for (let channel = 0; channel < 3; channel++)
        pixels.data[i + channel] =
          127.5 + (pixels.data[i + channel] - 127.5) * contrast;
    ctx.putImageData(pixels, 0, 0);
    for (const quality of [0.94, 0.88, 0.8]) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not prepare this image.")),
          "image/jpeg",
          quality,
        ),
      );
      if (blob.size <= MAX_IMPULSE_BYTES) return blob;
    }
    throw new Error("This image is too large to send. Choose a smaller photo.");
  } finally {
    image.close();
  }
}

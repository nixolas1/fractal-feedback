import { mediaDevices } from "./devices";

// Ask the sensor for a native landscape mode. Browsers may offer less than
// 4K/60; never use a canvas crop or an upscaled portrait stream as a substitute.
export async function landscapeCamera(): Promise<MediaStream> {
  if (matchMedia("(orientation: portrait)").matches)
    throw new Error(
      "Turn your phone sideways, then enable the camera again. Landscape capture keeps the full picture.",
    );
  const devices = mediaDevices();
  const native = (
    devices.getSupportedConstraints() as MediaTrackSupportedConstraints & {
      resizeMode?: boolean;
    }
  ).resizeMode
    ? { resizeMode: { exact: "none" } }
    : {};
  for (const [width, height, fps] of [
    [3840, 2160, 60],
    [3840, 2160, 30],
    [1920, 1080, 60],
    [1920, 1080, 30],
    [1280, 720, 30],
    [0, 0, 30],
  ]) {
    try {
      return await devices.getUserMedia({
        audio: false,
        video: {
          ...native,
          facingMode: { ideal: "environment" },
          ...(width
            ? {
                width: { exact: width },
                height: { exact: height },
                frameRate: { min: fps, ideal: fps, max: fps },
              }
            : {
                width: { ideal: 3840 },
                height: { ideal: 2160 },
                frameRate: { ideal: 30, max: 60 },
              }),
        },
      });
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== "OverconstrainedError" ||
        !width
      )
        throw error;
    }
  }
  throw new Error("No camera mode is available.");
}

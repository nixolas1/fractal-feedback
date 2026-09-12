export function mediaDevices(): MediaDevices {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera and microphone access need HTTPS (or localhost) and a browser that supports media devices. Touch controls remain available.",
    );
  }
  return navigator.mediaDevices;
}

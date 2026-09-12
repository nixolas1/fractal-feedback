import { useEffect, useRef, useState } from "react";
import { Camera, Images } from "lucide-react";
import { Slider } from "../components/Controls";
import { prepareImpulseImage } from "../services/impulse-image";
import type { PhoneConnection } from "./session";

export function ImpulseImage({
  connection,
  onReady,
}: {
  connection: PhoneConnection;
  onReady: (id: string | undefined) => void;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const [file, setFile] = useState<File>();
  const [contrast, setContrast] = useState(1);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("Choose the image a shake will send.");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    ready.current(undefined);
    if (!file) return;
    let cancelled = false;
    setError("");
    setStatus("Preparing image…");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const image = await prepareImpulseImage(file, contrast);
          if (cancelled) return;
          setStatus("Sending image to the studio…");
          const id = await connection.prepareImage(image);
          if (cancelled) return;
          ready.current(id);
          setStatus("Image ready · Enable Impulse, then shake to send it.");
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setStatus("Image is not ready yet.");
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [file, contrast, connection, retry]);
  function select(value: File | undefined) {
    if (!value) return;
    ready.current(undefined);
    setFile(value);
  }
  return (
    <section className="impulse-image" aria-label="Impulse image">
      <h2>Image on shake</h2>
      <p>
        Choose a photo and adjust its contrast. Each shake overrides the current
        source and injects this image into the feedback loop. The loop keeps
        evolving between shakes.
      </p>
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Impulse image from gallery"
        onChange={(e) => {
          select(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Impulse image from camera"
        onChange={(e) => {
          select(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="sensor-buttons">
        <button className="button" onClick={() => gallery.current?.click()}>
          <Images size={17} /> Choose from gallery
        </button>
        <button className="button" onClick={() => photo.current?.click()}>
          <Camera size={17} /> Take a photo
        </button>
      </div>
      <p className="muted small">
        Hold the camera sideways for a landscape photo. The entire image is
        kept, including portrait uploads.
      </p>
      {preview && (
        <>
          <img
            className="impulse-preview"
            src={preview}
            alt="Impulse image contrast preview"
            style={{ filter: `contrast(${contrast})` }}
          />
          <Slider
            label="Image contrast"
            min={0.25}
            max={3}
            step={0.01}
            value={contrast}
            resetValue={1}
            unit="×"
            touchHelp
            hint="Preview the contrast of the photo sent on every shake. Higher values deepen blacks and emphasize bright edges; 1 preserves the original contrast. Screen Contrast separately controls how it survives in the loop"
            onChange={(value) => {
              ready.current(undefined);
              setContrast(value);
            }}
          />
        </>
      )}
      <p role="status">{status}</p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button className="button" onClick={() => setRetry((v) => v + 1)}>
            Prepare image again
          </button>
        </>
      )}
    </section>
  );
}

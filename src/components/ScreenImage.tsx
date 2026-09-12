import { useEffect, useRef, useState } from "react";
import { ImagePlus, Camera } from "lucide-react";
import { attempt, studio, useStudio } from "../core/studio";
import { Slider } from "./Controls";

export function ScreenImage() {
  const state = useStudio();
  const image = state.scene.screenImage ?? {
    source: state.scene.source,
    target: "all",
    contrast: 1,
  };
  const gallery = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const asset = state.assets.find((a) => a.id === image.source);
  useEffect(() => {
    const blob = asset?.blob;
    if (blob && (asset.kind === "image" || asset.kind === "gif")) {
      const url = URL.createObjectURL(blob);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(
      studio.sources.items.get(image.source)?.canvas.toDataURL() ??
        studio.sources.seedCanvas.toDataURL(),
    );
  }, [image.source, asset]);
  function load(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (file) attempt(() => studio.loadScreenImage(file));
    input.value = "";
  }
  return (
    <section
      className="screen-image-controls"
      aria-label="Screen image injection"
    >
      <h3>Image on screen</h3>
      <p className="muted small">
        Prepare an image, then press Space to override the screen for 0.2
        seconds. The camera takes it into the loop.
      </p>
      <input
        ref={gallery}
        className="sr-only"
        type="file"
        accept="image/*"
        aria-label="Screen image from gallery"
        onChange={(e) => load(e.currentTarget)}
      />
      <input
        ref={camera}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Screen image from camera"
        onChange={(e) => load(e.currentTarget)}
      />
      <div className="screen-image-buttons">
        <button className="button" onClick={() => gallery.current?.click()}>
          <ImagePlus size={16} /> Choose image
        </button>
        <button className="button" onClick={() => camera.current?.click()}>
          <Camera size={16} /> Take photo
        </button>
      </div>
      <p className="muted small">
        Hold your phone sideways for a landscape photo. The whole image is
        preserved.
      </p>
      <label className="field-label">
        Image to inject
        <select
          aria-label="Image to inject"
          value={image.source}
          onChange={(e) =>
            attempt(() => studio.screenImage({ source: e.target.value }))
          }
        >
          <option value="seed">Light seed</option>
          {state.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {preview && (
        <img
          className="screen-image-preview"
          src={preview}
          alt="Image prepared for the screen"
          style={{ filter: `contrast(${image.contrast})` }}
        />
      )}
      <Slider
        label="Injection contrast"
        min={0.25}
        max={3}
        step={0.01}
        resetValue={1}
        value={image.contrast}
        hint="Contrast applied to the injected image, before the screen emits its light"
        onChange={(contrast) => attempt(() => studio.screenImage({ contrast }))}
      />
      <label className="field-label">
        Target screen
        <select
          aria-label="Target screen"
          value={image.target}
          onChange={(e) =>
            attempt(() => studio.screenImage({ target: e.target.value }))
          }
        >
          <option value="all">All screens</option>
          {state.scene.graph.nodes
            .filter((n) => n.kind === "screen")
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
        </select>
      </label>
      <button
        className="button primary"
        onClick={() => attempt(() => studio.injectScreenImage())}
      >
        Inject image <kbd>Space</kbd>
      </button>
    </section>
  );
}

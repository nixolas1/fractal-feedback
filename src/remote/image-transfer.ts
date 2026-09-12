import { MAX_IMPULSE_BYTES } from "../services/impulse-image";

// Still images have their own reliable channel so a 4K photo cannot block
// touch/sensor messages. Acknowledgement means the host has decoded the image.
export class ImageTransfer {
  private incoming?: {
    id: string;
    size: number;
    received: number;
    chunks: ArrayBuffer[];
  };
  private pending = new Map<
    string,
    {
      resolve: (id: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    private channel: RTCDataChannel,
    private accept?: (id: string, image: Blob) => Promise<void>,
  ) {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", this.message);
    channel.addEventListener("close", this.dispose);
  }
  send(image: Blob): Promise<string> {
    const task = this.queue.catch(() => {}).then(() => this.transmit(image));
    this.queue = task;
    return task;
  }
  private async transmit(image: Blob) {
    if (this.closed || this.channel.readyState !== "open")
      throw new Error(
        "Image sending needs the direct phone connection. Wait for it to connect.",
      );
    if (
      image.type !== "image/jpeg" ||
      !image.size ||
      image.size > MAX_IMPULSE_BYTES
    )
      throw new Error("Use a JPEG image under 8 MB.");
    const id = crypto.randomUUID();
    const received = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("Image transfer timed out. Try preparing the photo again."),
        );
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
    });
    // Attach the handler before yielding while buffering the payload.
    void received.catch(() => {});
    try {
      this.channel.send(
        JSON.stringify({ type: "begin", id, size: image.size }),
      );
      const bytes = await image.arrayBuffer();
      const deadline = performance.now() + 25000;
      for (let offset = 0; offset < bytes.byteLength; offset += 16384) {
        while (this.channel.bufferedAmount > 262144) {
          if (this.closed || performance.now() > deadline)
            throw new Error("Image connection interrupted.");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (this.closed) throw new Error("Image connection closed.");
        this.channel.send(bytes.slice(offset, offset + 16384));
      }
      this.channel.send(JSON.stringify({ type: "end", id }));
      return await received;
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      throw error;
    }
  }
  private message = (event: MessageEvent) => {
    void this.receive(event.data).catch(() => {
      this.incoming = undefined;
    });
  };
  private async receive(data: unknown) {
    if (this.closed) return;
    if (data instanceof ArrayBuffer) {
      const incoming = this.incoming;
      if (
        !incoming ||
        data.byteLength > 16384 ||
        incoming.received + data.byteLength > incoming.size
      )
        throw new Error("Invalid image chunk.");
      incoming.chunks.push(data);
      incoming.received += data.byteLength;
      return;
    }
    if (typeof data !== "string" || data.length > 1024) return;
    const message = JSON.parse(data);
    if (typeof message.id !== "string" || !/^[a-f0-9-]{36}$/.test(message.id))
      return;
    if (message.type === "ready" || message.type === "error") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.type === "ready") pending.resolve(message.id);
      else
        pending.reject(
          new Error(
            "The studio could not prepare this photo. Try another image.",
          ),
        );
    } else if (message.type === "begin" && this.accept) {
      if (
        !Number.isSafeInteger(message.size) ||
        message.size < 1 ||
        message.size > MAX_IMPULSE_BYTES
      )
        throw new Error("Invalid image size.");
      this.incoming = {
        id: message.id,
        size: message.size,
        received: 0,
        chunks: [],
      };
    } else if (message.type === "end" && this.accept) {
      const incoming = this.incoming;
      this.incoming = undefined;
      if (
        !incoming ||
        incoming.id !== message.id ||
        incoming.received !== incoming.size
      )
        throw new Error("Incomplete image.");
      let type = "ready";
      try {
        await this.accept(
          incoming.id,
          new Blob(incoming.chunks, { type: "image/jpeg" }),
        );
      } catch {
        type = "error";
      }
      if (!this.closed && this.channel.readyState === "open")
        this.channel.send(JSON.stringify({ type, id: incoming.id }));
    }
  }
  dispose = () => {
    this.closed = true;
    this.incoming = undefined;
    this.channel.removeEventListener("message", this.message);
    this.channel.removeEventListener("close", this.dispose);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Image connection closed."));
    }
    this.pending.clear();
  };
}

export type VideoState = "connecting" | "connected" | "retrying" | "blocked";

export function videoConnected(peer: RTCPeerConnection) {
  return (
    peer.connectionState === "connected" ||
    (peer.connectionState !== "failed" &&
      peer.connectionState !== "closed" &&
      (peer.iceConnectionState === "connected" ||
        peer.iceConnectionState === "completed"))
  );
}

// Trickled candidates for an ICE restart may reach Firebase before its offer.
// Keep them until their ICE credentials appear in the remote description.
export class RemoteCandidates {
  private queued: RTCIceCandidateInit[] = [];
  constructor(private peer: RTCPeerConnection) {}
  add(candidate: RTCIceCandidateInit) {
    this.queued.push(candidate);
    this.queued = this.queued.slice(-64);
    return this.flush();
  }
  async flush() {
    if (!this.peer.remoteDescription) return;
    for (const candidate of this.queued.splice(0)) {
      if (
        candidate.usernameFragment &&
        !this.peer.remoteDescription.sdp.includes(
          `a=ice-ufrag:${candidate.usernameFragment}\r\n`,
        )
      )
        this.queued.push(candidate);
      else await this.peer.addIceCandidate(candidate).catch(() => {});
    }
  }
}

// Pairing and touch controls can work while ICE is still finding a video route.
// A camera needs the initial SDP exchange, not a connected ICE transport: camera
// permission can itself make local candidates available in privacy browsers.
export class VideoLink {
  private timer?: ReturnType<typeof setTimeout>;
  private closed = new AbortController();
  state: VideoState = "connecting";

  constructor(
    private peer: RTCPeerConnection,
    private restart: () => Promise<void>,
    private changed: (state: VideoState) => void,
  ) {
    peer.addEventListener("connectionstatechange", this.check);
    peer.addEventListener("iceconnectionstatechange", this.check);
    window.addEventListener("online", this.online);
    this.watch();
  }

  private update(state: VideoState) {
    if (this.closed.signal.aborted) return;
    this.state = state;
    this.changed(state);
  }

  check = () => {
    if (this.closed.signal.aborted) return;
    if (videoConnected(this.peer)) {
      clearTimeout(this.timer);
      this.update("connected");
    } else if (this.peer.connectionState === "closed") this.dispose();
    else if (this.state === "connected") this.watch();
  };

  // A fresh camera permission or a network change deserves another ICE attempt.
  watch() {
    clearTimeout(this.timer);
    if (this.closed.signal.aborted) return;
    if (videoConnected(this.peer)) return this.check();
    this.update("connecting");
    this.timer = setTimeout(() => void this.retry().catch(() => {}), 12000);
  }

  async retry() {
    if (this.closed.signal.aborted) return;
    clearTimeout(this.timer);
    this.update("retrying");
    this.timer = setTimeout(() => this.blocked(), 15000);
    try {
      await this.restart();
      this.check();
    } catch (error) {
      this.blocked();
      throw error;
    }
  }

  blocked() {
    clearTimeout(this.timer);
    if (videoConnected(this.peer)) return this.check();
    this.update("blocked");
  }

  private online = () => {
    if (!videoConnected(this.peer)) void this.retry().catch(() => {});
  };

  waitForSignaling(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.peer.removeEventListener("signalingstatechange", check);
        this.closed.signal.removeEventListener("abort", check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (this.closed.signal.aborted || this.peer.signalingState === "closed")
          finish(new Error("The phone connection was closed."));
        else if (
          this.peer.remoteDescription &&
          this.peer.signalingState === "stable"
        )
          finish();
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "The studio did not finish video setup. Keep the studio open, then retry video. If it still fails, reload both screens and pair again.",
            ),
          ),
        timeout,
      );
      this.peer.addEventListener("signalingstatechange", check);
      this.closed.signal.addEventListener("abort", check);
      check();
    });
  }

  dispose() {
    clearTimeout(this.timer);
    this.closed.abort();
    this.peer.removeEventListener("connectionstatechange", this.check);
    this.peer.removeEventListener("iceconnectionstatechange", this.check);
    window.removeEventListener("online", this.online);
  }
}

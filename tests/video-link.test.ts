import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RemoteCandidates,
  VideoLink,
  videoConnected,
} from "../src/remote/video-link";

function peer() {
  return Object.assign(new EventTarget(), {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable",
    remoteDescription: null,
    addIceCandidate: vi.fn(async () => {}),
  }) as unknown as RTCPeerConnection;
}
const links: VideoLink[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  links.splice(0).forEach((link) => link.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function link(pc: RTCPeerConnection, restart = vi.fn(async () => {})) {
  const value = new VideoLink(pc, restart, vi.fn());
  links.push(value);
  return value;
}

describe("phone video connection", () => {
  it("allows camera negotiation after SDP, without waiting for ICE to connect", async () => {
    const pc = peer(),
      video = link(pc);
    const waiting = video.waitForSignaling();
    Object.assign(pc, { remoteDescription: { type: "offer", sdp: "test" } });
    pc.dispatchEvent(new Event("signalingstatechange"));
    await expect(waiting).resolves.toBeUndefined();
    expect(videoConnected(pc)).toBe(false);
  });

  it("retries once, reports a blocked link, and allows a manual retry", async () => {
    const restart = vi.fn(async () => {}),
      video = link(peer(), restart);
    await vi.advanceTimersByTimeAsync(12000);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(video.state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(15000);
    expect(video.state).toBe("blocked");
    await vi.advanceTimersByTimeAsync(60000);
    expect(restart).toHaveBeenCalledTimes(1);
    await video.retry();
    expect(restart).toHaveBeenCalledTimes(2);
    expect(video.state).toBe("retrying");
  });

  it("uses ICE readiness when the aggregate connection state lags", async () => {
    const pc = peer(),
      restart = vi.fn(async () => {}),
      video = link(pc, restart);
    Object.assign(pc, { iceConnectionState: "completed" });
    pc.dispatchEvent(new Event("iceconnectionstatechange"));
    expect(video.state).toBe("connected");
    await vi.advanceTimersByTimeAsync(60000);
    expect(restart).not.toHaveBeenCalled();
    Object.assign(pc, {
      iceConnectionState: "disconnected",
      connectionState: "disconnected",
    });
    pc.dispatchEvent(new Event("iceconnectionstatechange"));
    await vi.advanceTimersByTimeAsync(12000);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("cancels pending setup and retries when the phone is released", async () => {
    const restart = vi.fn(async () => {}),
      video = link(peer(), restart);
    const waiting = video.waitForSignaling();
    const closed = expect(waiting).rejects.toThrow("closed");
    video.dispose();
    await closed;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(restart).not.toHaveBeenCalled();
  });

  it("times out missing signaling and reports failed restart attempts", async () => {
    const video = link(peer());
    const failure = expect(video.waitForSignaling()).rejects.toThrow(
      "studio did not finish",
    );
    await vi.advanceTimersByTimeAsync(10000);
    await failure;
    const failed = link(
      peer(),
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(failed.retry()).rejects.toThrow("offline");
    expect(failed.state).toBe("blocked");
  });

  it("retains candidates that arrive before the initial offer or an ICE restart", async () => {
    const pc = peer(),
      candidates = new RemoteCandidates(pc);
    const first = { candidate: "initial", usernameFragment: "initial" };
    const retry = { candidate: "retry", usernameFragment: "retry" };
    await candidates.add(first);
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    Object.assign(pc, {
      remoteDescription: { sdp: "a=ice-ufrag:initial\r\n" },
    });
    await candidates.flush();
    expect(pc.addIceCandidate).toHaveBeenCalledWith(first);
    await candidates.add(retry);
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    Object.assign(pc, { remoteDescription: { sdp: "a=ice-ufrag:retry\r\n" } });
    await candidates.flush();
    expect(pc.addIceCandidate).toHaveBeenLastCalledWith(retry);
  });
});

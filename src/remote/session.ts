import { mediaDevices } from "../services/devices";
import { useSyncExternalStore } from "react";
import {
  ref,
  set,
  push,
  onValue,
  onChildAdded,
  remove,
  onDisconnect,
  type Unsubscribe,
} from "firebase/database";
import { cloud } from "../services/cloud";
import { studio, attempt } from "../core/studio";
import {
  ControllerActionSchema,
  ControllerSampleSchema,
} from "../core/protocol";
import {
  MacrosSchema,
  SensorSchema,
  type SensorSample,
  type MacroKey,
} from "../core/model";
type HostState = {
  id: string;
  code: string;
  status: string;
  controller: string | null;
  epoch: number;
  expires: number;
  connected: boolean;
};
export class HostSession {
  state: HostState = {
    id: "",
    code: "",
    status: "Not paired",
    controller: null,
    epoch: 0,
    expires: 0,
    connected: false,
  };
  listeners = new Set<() => void>();
  private offs: Unsubscribe[] = [];
  private peerOffs: Unsubscribe[] = [];
  private peer?: RTCPeerConnection;
  private actions?: RTCDataChannel;
  private samples?: RTCDataChannel;
  private preview?: MediaStream;
  private previewTimer?: ReturnType<typeof setInterval>;
  private statusTimer?: ReturnType<typeof setInterval>;
  private lastSeq = -1;
  private seen = new Set<string>();
  private starting?: Promise<void>;
  private owner = "";
  constructor() {
    cloud.onAuth(() => {
      if (
        this.state.id &&
        this.owner &&
        cloud.auth?.currentUser?.uid !== this.owner
      )
        this.dispose();
    });
  }
  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  update(patch: Partial<HostState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  async start() {
    if (this.state.id) return;
    if (this.starting) return this.starting;
    this.starting = this.begin();
    try {
      await this.starting;
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      this.starting = undefined;
    }
  }
  private async begin() {
    this.owner = (await cloud.anonymous()).uid;
    const result = await cloud.api<{ id: string; code: string }>(
      "sessions",
      {},
    );
    this.update({ id: result.id, code: result.code, status: "Ready to pair" });
    const base = `sessions/${result.id}`;
    const presence = ref(cloud.db!, `${base}/hostOnline`);
    await onDisconnect(presence).set(false);
    await set(presence, true);
    this.offs.push(
      onValue(ref(cloud.db!, `${base}/controller`), (snapshot) => {
        const c = snapshot.val();
        if (!c) {
          this.closePeer();
          this.update({
            controller: null,
            connected: false,
            status: "Ready to pair",
          });
          return;
        }
        this.update({ expires: c.expires });
        if (c.uid !== this.state.controller || c.epoch !== this.state.epoch) {
          this.closePeer();
          this.update({
            controller: c.uid,
            epoch: c.epoch,
            status: "Connecting phone…",
          });
          attempt(() => this.connect(c.epoch));
        }
      }),
    );
    this.offs.push(
      onValue(ref(cloud.db!, `${base}/samples`), (snapshot) => {
        const data = snapshot.val();
        if (data) this.receive(data, false);
      }),
    );
    this.offs.push(
      onChildAdded(ref(cloud.db!, `${base}/actions`), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          this.receive(data, true);
          set(ref(cloud.db!, `${base}/acks/${snapshot.key}`), {
            received: Date.now(),
          });
          remove(snapshot.ref);
        }
      }),
    );
    this.statusTimer = setInterval(() => {
      set(ref(cloud.db!, `${base}/status`), {
        scene: studio.state.scene.preset,
        macros: studio.state.scene.macros,
        feed: studio.state.scene.feed,
        frozen: studio.state.frozen,
        revision: studio.state.revision,
        hostAt: Date.now(),
      });
    }, 1000);
  }
  private async connect(epoch: number) {
    const { iceServers } = await cloud.api<{ iceServers: RTCIceServer[] }>(
      `sessions/${this.state.id}/ice`,
      {},
    );
    if (epoch !== this.state.epoch) return;
    const pc = new RTCPeerConnection({ iceServers });
    this.peer = pc;
    const base = `sessions/${this.state.id}/signals/${epoch}`;
    pc.onicecandidate = (e) => {
      if (e.candidate)
        push(ref(cloud.db!, `${base}/hostCandidates`), e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.peer) return;
      const connected = pc.connectionState === "connected";
      this.update({
        connected,
        status: connected
          ? "Phone connected"
          : pc.connectionState === "failed"
            ? "Cloud controls active"
            : "Connecting phone…",
      });
    };
    this.actions = pc.createDataChannel("actions", { ordered: true });
    this.samples = pc.createDataChannel("samples", {
      ordered: false,
      maxRetransmits: 0,
    });
    this.actions.onmessage = (e) => {
      try {
        this.receive(JSON.parse(e.data), true);
      } catch (error) {
        studio.fail(error);
      }
    };
    this.samples.onmessage = (e) => {
      try {
        this.receive(JSON.parse(e.data), false);
      } catch {
        /* Ignore malformed or superseded continuous samples. */
      }
    };
    pc.ontrack = (e) => {
      if (e.track.kind === "video" && e.streams[0])
        attempt(() => studio.camera(e.streams[0]));
    };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    this.previewTimer = setInterval(() => {
      if (studio.engine) ctx.drawImage(studio.engine.canvas, 0, 0, 640, 360);
    }, 100);
    this.preview = canvas.captureStream(10);
    this.preview.getTracks().forEach((t) => pc.addTrack(t, this.preview!));
    const queued: RTCIceCandidateInit[] = [];
    this.peerOffs.push(
      onChildAdded(ref(cloud.db!, `${base}/remoteCandidates`), (snap) => {
        const value = snap.val();
        if (pc.remoteDescription) pc.addIceCandidate(value).catch(() => {});
        else queued.push(value);
      }),
    );
    this.peerOffs.push(
      onValue(ref(cloud.db!, `${base}/answer`), async (snap) => {
        if (snap.exists() && !pc.remoteDescription) {
          await pc.setRemoteDescription(snap.val());
          for (const c of queued) await pc.addIceCandidate(c);
        }
      }),
    );
    this.peerOffs.push(
      onValue(ref(cloud.db!, `${base}/remoteOffer`), async (snap) => {
        if (snap.exists()) {
          try {
            await pc.setRemoteDescription(snap.val());
            await pc.setLocalDescription(await pc.createAnswer());
            await set(
              ref(cloud.db!, `${base}/remoteAnswer`),
              pc.localDescription?.toJSON(),
            );
          } catch (error) {
            studio.fail(error);
          }
        }
      }),
    );
    await pc.setLocalDescription(await pc.createOffer());
    await set(ref(cloud.db!, `${base}/offer`), pc.localDescription?.toJSON());
  }
  private receive(data: any, reliable: boolean) {
    const parsed = (
      reliable ? ControllerActionSchema : ControllerSampleSchema
    ).safeParse(data);
    if (!parsed.success) return;
    data = parsed.data;
    if (
      data.epoch !== this.state.epoch ||
      !this.state.controller ||
      data.uid !== this.state.controller ||
      this.state.expires < Date.now()
    )
      return;
    if (reliable) {
      if (typeof data.id !== "string" || this.seen.has(data.id)) return;
      this.seen.add(data.id);
      if (this.seen.size > 1000)
        this.seen.delete(this.seen.values().next().value!);
    } else {
      if (!Number.isSafeInteger(data.seq) || data.seq <= this.lastSeq) return;
      this.lastSeq = data.seq;
    }
    if (data.type === "macros") {
      const values = MacrosSchema.partial().parse(data.values);
      studio.commands([{ type: "macros", values }]);
    }
    if (data.type === "sensors") studio.sensor(SensorSchema.parse(data.values));
    if (reliable) {
      if (data.type === "capture") studio.capture();
      if (data.type === "freeze") studio.freeze();
      if (data.type === "reset") studio.reset();
      if (data.type === "inject") studio.inject();
      if (data.type === "balance") attempt(() => studio.balance());
      if (data.type === "preset" && typeof data.value === "string")
        attempt(() => studio.preset(data.value));
    }
  }
  async refreshCode() {
    if (!this.state.id) return;
    const result = await cloud.api<{ code: string }>(
      `sessions/${this.state.id}/pair-code`,
      {},
    );
    this.update({ code: result.code });
  }
  async release() {
    if (this.state.id) await cloud.api(`sessions/${this.state.id}/release`, {});
    this.closePeer();
    this.update({
      controller: null,
      connected: false,
      status: "Ready to pair",
    });
  }
  private closePeer() {
    this.peerOffs.forEach((fn) => fn());
    this.peerOffs = [];
    this.peer?.close();
    this.peer = undefined;
    this.actions = undefined;
    this.samples = undefined;
    this.preview?.getTracks().forEach((t) => t.stop());
    clearInterval(this.previewTimer);
    this.lastSeq = -1;
    this.seen.clear();
    studio.sensor({
      tiltX: 0,
      tiltY: 0,
      roll: 0,
      audio: 0,
      bass: 0,
      treble: 0,
      motion: 0,
      color: 0,
    });
  }
  dispose() {
    this.closePeer();
    this.offs.forEach((fn) => fn());
    clearInterval(this.statusTimer);
    this.offs = [];
    this.update({
      id: "",
      code: "",
      controller: null,
      connected: false,
      status: "Not paired",
      expires: 0,
      epoch: 0,
    });
  }
}
export const hostSession = new HostSession();
export const useHostSession = () =>
  useSyncExternalStore(hostSession.subscribe, hostSession.get, hostSession.get);
export class PhoneConnection {
  peer?: RTCPeerConnection;
  actions?: RTCDataChannel;
  samples?: RTCDataChannel;
  uid = "";
  epoch = 0;
  private seq = 0;
  private offs: Unsubscribe[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;
  private pending: Record<string, any> = {};
  private flushTimer?: ReturnType<typeof setTimeout>;
  onStatus?: (status: string) => void;
  onScene?: (state: any) => void;
  onPreview?: (stream: MediaStream) => void;
  onDisconnected?: () => void;
  constructor(
    public id: string,
    private code: string,
  ) {}
  async join() {
    const user = await cloud.anonymous();
    this.uid = user.uid;
    const result = await cloud.api<{
      epoch: number;
      iceServers: RTCIceServer[];
    }>(`sessions/${this.id}/claim`, { code: this.code });
    this.epoch = result.epoch;
    const pc = new RTCPeerConnection({ iceServers: result.iceServers });
    this.peer = pc;
    const base = `sessions/${this.id}/signals/${this.epoch}`;
    pc.onicecandidate = (e) => {
      if (e.candidate)
        push(ref(cloud.db!, `${base}/remoteCandidates`), e.candidate.toJSON());
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === "actions") this.actions = e.channel;
      else this.samples = e.channel;
      e.channel.onopen = () => this.onStatus?.("Connected");
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) this.onPreview?.(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      )
        this.onStatus?.("Cloud controls · video reconnecting");
    };
    const queued: RTCIceCandidateInit[] = [];
    this.offs.push(
      onChildAdded(ref(cloud.db!, `${base}/hostCandidates`), (snap) => {
        if (pc.remoteDescription)
          pc.addIceCandidate(snap.val()).catch(() => {});
        else queued.push(snap.val());
      }),
    );
    this.offs.push(
      onValue(ref(cloud.db!, `${base}/offer`), async (snap) => {
        if (snap.exists() && !pc.remoteDescription) {
          try {
            await pc.setRemoteDescription(snap.val());
            for (const c of queued) await pc.addIceCandidate(c);
            await pc.setLocalDescription(await pc.createAnswer());
            await set(
              ref(cloud.db!, `${base}/answer`),
              pc.localDescription?.toJSON(),
            );
          } catch {
            this.onStatus?.("Cloud controls active");
          }
        }
      }),
    );
    this.offs.push(
      onValue(ref(cloud.db!, `${base}/remoteAnswer`), async (snap) => {
        if (snap.exists() && pc.signalingState === "have-local-offer")
          await pc.setRemoteDescription(snap.val());
      }),
    );
    this.offs.push(
      onValue(ref(cloud.db!, `sessions/${this.id}/status`), (snap) => {
        if (snap.exists()) this.onScene?.(snap.val());
      }),
    );
    this.offs.push(
      onValue(
        ref(cloud.db!, `sessions/${this.id}/controller`),
        (snap) => {
          const value = snap.val();
          if (!value || value.uid !== this.uid || value.epoch !== this.epoch) {
            this.ended();
          }
        },
        () => this.ended(),
      ),
    );
    this.heartbeat = setInterval(() => {
      cloud
        .api(`sessions/${this.id}/heartbeat`, { epoch: this.epoch })
        .catch(() => this.onStatus?.("Connection interrupted"));
    }, 10000);
    this.onStatus?.("Touch controls ready · connecting video");
  }
  sample(type: "macros" | "sensors", values: Record<string, number>) {
    const data = {
      type,
      values,
      epoch: this.epoch,
      uid: this.uid,
      seq: ++this.seq,
    };
    if (
      this.samples?.readyState === "open" &&
      this.samples.bufferedAmount < 16384
    ) {
      this.samples.send(JSON.stringify(data));
      return;
    }
    this.pending[type] = { ...(this.pending[type] ?? {}), ...values };
    if (!this.flushTimer)
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        const type = Object.keys(this.pending)[0];
        if (type) {
          const values = this.pending[type];
          delete this.pending[type];
          set(ref(cloud.db!, `sessions/${this.id}/samples`), {
            type,
            values,
            epoch: this.epoch,
            uid: this.uid,
            seq: ++this.seq,
          });
        }
        if (Object.keys(this.pending).length)
          this.sample(Object.keys(this.pending)[0] as "macros" | "sensors", {});
      }, 100);
  }
  action(type: string, value?: string) {
    const id = crypto.randomUUID(),
      data = {
        id,
        type,
        ...(value ? { value } : {}),
        epoch: this.epoch,
        uid: this.uid,
      };
    if (this.actions?.readyState === "open")
      this.actions.send(JSON.stringify(data));
    else set(ref(cloud.db!, `sessions/${this.id}/actions/${id}`), data);
  }
  async camera() {
    if (!this.peer || this.peer.connectionState !== "connected")
      throw new Error(
        "Wait for the video connection before enabling your camera.",
      );
    const stream = await mediaDevices().getUserMedia({
      video: { width: 1280, height: 720, facingMode: "environment" },
      audio: false,
    });
    stream.getTracks().forEach((t) => this.peer!.addTrack(t, stream));
    await this.peer.setLocalDescription(await this.peer.createOffer());
    await set(
      ref(cloud.db!, `sessions/${this.id}/signals/${this.epoch}/remoteOffer`),
      this.peer.localDescription?.toJSON(),
    );
    return stream;
  }
  private ended() {
    this.onStatus?.("Control has been released");
    this.close();
    this.onDisconnected?.();
  }
  async release() {
    await cloud.api(`sessions/${this.id}/release`, { epoch: this.epoch });
    this.close();
  }
  close() {
    this.actions = undefined;
    this.samples = undefined;
    this.pending = {};
    clearInterval(this.heartbeat);
    clearTimeout(this.flushTimer);
    this.offs.forEach((fn) => fn());
    this.offs = [];
    this.peer?.getSenders().forEach((s) => s.track?.stop());
    this.peer?.close();
  }
}

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
import { ImageTransfer } from "./image-transfer";
import {
  VideoLink,
  RemoteCandidates,
  videoConnected,
  type VideoState,
} from "./video-link";
import type { SourceAsset } from "../engine/source";
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

async function publishSignal(
  path: string,
  description: RTCSessionDescriptionInit & { id?: string },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      set(ref(cloud.db!, path), description),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Video setup timed out. Check the internet connection, then retry video.",
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  private images?: ImageTransfer;
  private impulseImage?: { id: string; asset: SourceAsset };
  private phoneCamera?: SourceAsset;
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
            connected: false,
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
    const controller = this.state.controller;
    const { iceServers } = await cloud.api<{ iceServers: RTCIceServer[] }>(
      `sessions/${this.state.id}/ice`,
      {},
    );
    if (
      epoch !== this.state.epoch ||
      !controller ||
      controller !== this.state.controller
    )
      return;
    const pc = new RTCPeerConnection({ iceServers });
    this.peer = pc;
    const base = `sessions/${this.state.id}/signals/${epoch}`;
    pc.onicecandidate = (e) => {
      if (e.candidate && pc === this.peer)
        void push(
          ref(cloud.db!, `${base}/hostCandidates`),
          e.candidate.toJSON(),
        ).catch(() => {});
    };
    pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => {
      if (pc !== this.peer) return;
      const connected = videoConnected(pc);
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
    this.images = new ImageTransfer(
      pc.createDataChannel("images", { ordered: true }),
      async (id, image) => {
        if (pc !== this.peer || this.state.expires < Date.now())
          throw new Error("Phone lease ended.");
        const asset = await studio.sources.addFile(image, "Phone impulse.jpg");
        if (pc !== this.peer || this.state.expires < Date.now()) {
          studio.sources.remove(asset.id);
          throw new Error("Phone lease ended.");
        }
        this.discardImpulseImage();
        this.impulseImage = { id, asset };
      },
    );
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
      if (e.track.kind === "video" && pc === this.peer)
        attempt(async () => {
          const asset = await studio.sources.camera(
            e.streams[0] ?? new MediaStream([e.track]),
          );
          if (pc !== this.peer) {
            studio.sources.remove(asset.id);
            return;
          }
          this.phoneCamera = asset;
          await studio.selectAsset(asset);
        });
    };
    const candidates = new RemoteCandidates(pc);
    // The initial answer and a camera/ICE offer can arrive close together.
    // Apply descriptions in order instead of racing setRemoteDescription calls.
    let signaling = Promise.resolve();
    const signal = (task: () => Promise<void>) => {
      signaling = signaling
        .catch(() => {})
        .then(async () => {
          if (pc === this.peer) await task();
        });
      void signaling.catch((error) => {
        if (pc === this.peer) studio.fail(error);
      });
    };
    this.peerOffs.push(
      onChildAdded(ref(cloud.db!, `${base}/remoteCandidates`), (snap) => {
        if (pc === this.peer) void candidates.add(snap.val());
      }),
    );
    this.peerOffs.push(
      onValue(ref(cloud.db!, `${base}/answer`), (snap) => {
        if (snap.exists())
          signal(async () => {
            if (pc.signalingState !== "have-local-offer") return;
            await pc.setRemoteDescription(snap.val());
            await candidates.flush();
          });
      }),
    );
    this.peerOffs.push(
      onValue(ref(cloud.db!, `${base}/remoteOffer`), (snap) => {
        if (snap.exists())
          signal(async () => {
            const offer = snap.val();
            await pc.setRemoteDescription(offer);
            await candidates.flush();
            await pc.setLocalDescription(await pc.createAnswer());
            await publishSignal(`${base}/remoteAnswer`, {
              ...pc.localDescription!.toJSON(),
              ...(typeof offer.id === "string" ? { id: offer.id } : {}),
            });
          });
      }),
    );
    await pc.setLocalDescription(await pc.createOffer());
    await publishSignal(`${base}/offer`, pc.localDescription!.toJSON());
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
      if (data.type === "image-inject" && this.impulseImage?.id === data.value)
        attempt(() => studio.injectImage(this.impulseImage!.asset));
      if (data.type === "camera-source" && this.phoneCamera)
        attempt(() => studio.selectAsset(this.phoneCamera!));
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
    this.images?.dispose();
    this.images = undefined;
    this.phoneCamera = undefined;
    this.discardImpulseImage();
    this.peerOffs.forEach((fn) => fn());
    this.peerOffs = [];
    this.peer?.close();
    this.peer = undefined;
    this.actions = undefined;
    this.samples = undefined;
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
  private discardImpulseImage() {
    const asset = this.impulseImage?.asset;
    if (
      asset &&
      studio.state.scene.source !== asset.id &&
      !studio.state.scene.assets.includes(asset.id) &&
      studio.state.scene.screenImage?.source !== asset.id &&
      !studio.state.scene.graph.nodes.some((n) => n.sourceId === asset.id)
    )
      studio.sources.remove(asset.id);
    this.impulseImage = undefined;
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
  private images?: ImageTransfer;
  private cameraSender?: RTCRtpSender;
  private cameraTrack?: MediaStreamTrack;
  private cameraUpdate = Promise.resolve();
  private cameraPaused = false;
  private video?: VideoLink;
  private signaling: Promise<unknown> = Promise.resolve();
  private offerId?: string;
  uid = "";
  epoch = 0;
  private seq = 0;
  private offs: Unsubscribe[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;
  private pending: Record<string, any> = {};
  private flushTimer?: ReturnType<typeof setTimeout>;
  onStatus?: (status: string) => void;
  onVideoState?: (state: VideoState) => void;
  onScene?: (state: any) => void;
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
    this.video = new VideoLink(
      pc,
      () => this.offer(true),
      (state) => {
        this.onVideoState?.(state);
        this.onStatus?.(
          {
            connected: "Connected",
            connecting: "Touch controls ready · connecting video",
            retrying: "Cloud controls · retrying video",
            blocked: "Cloud controls · video unavailable",
          }[state],
        );
      },
    );
    const base = `sessions/${this.id}/signals/${this.epoch}`;
    pc.onicecandidate = (e) => {
      if (e.candidate && pc === this.peer)
        void push(
          ref(cloud.db!, `${base}/remoteCandidates`),
          e.candidate.toJSON(),
        ).catch(() => {});
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === "actions") this.actions = e.channel;
      else if (e.channel.label === "samples") this.samples = e.channel;
      else if (e.channel.label === "images")
        this.images = new ImageTransfer(e.channel);
      e.channel.onopen = () => this.video?.check();
    };
    const candidates = new RemoteCandidates(pc);
    this.offs.push(
      onChildAdded(ref(cloud.db!, `${base}/hostCandidates`), (snap) => {
        if (pc === this.peer) void candidates.add(snap.val());
      }),
    );
    this.offs.push(
      onValue(ref(cloud.db!, `${base}/offer`), (snap) => {
        if (snap.exists())
          void this.signal(async () => {
            if (pc !== this.peer || pc.remoteDescription) return;
            await pc.setRemoteDescription(snap.val());
            await candidates.flush();
            await pc.setLocalDescription(await pc.createAnswer());
            await publishSignal(
              `${base}/answer`,
              pc.localDescription!.toJSON(),
            );
          }).catch(() => this.video?.blocked());
      }),
    );
    this.offs.push(
      onValue(ref(cloud.db!, `${base}/remoteAnswer`), (snap) => {
        if (snap.exists())
          void this.signal(async () => {
            const answer = snap.val();
            if (pc !== this.peer || pc.signalingState !== "have-local-offer")
              return;
            if (answer.id && answer.id !== this.offerId) return;
            await pc.setRemoteDescription(answer);
            await candidates.flush();
          }).catch(() => this.video?.blocked());
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
  }
  private signal<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.signaling.catch(() => {}).then(task);
    this.signaling = operation;
    return operation;
  }
  private async offer(iceRestart: boolean) {
    const pc = this.peer,
      video = this.video;
    if (!pc || !video)
      throw new Error("Pair the phone again to connect video.");
    // A camera offer may overlap an automatic retry. Wait outside the queue so
    // receiving the outstanding answer can still make signaling stable.
    for (let attempt = 0; attempt < 3; attempt++) {
      await video.waitForSignaling();
      const sent = await this.signal(async () => {
        if (pc !== this.peer)
          throw new Error("The phone connection was closed.");
        if (pc.signalingState !== "stable") return false;
        this.offerId = crypto.randomUUID();
        await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
        await publishSignal(
          `sessions/${this.id}/signals/${this.epoch}/remoteOffer`,
          { ...pc.localDescription!.toJSON(), id: this.offerId },
        );
        return true;
      });
      if (sent) return;
    }
    throw new Error("Video setup is busy. Retry video in a moment.");
  }
  retryVideo() {
    return this.video?.retry();
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
  prepareImage(image: Blob) {
    if (!this.images)
      throw new Error(
        "Wait for the direct phone connection before preparing an image.",
      );
    return this.images.send(image);
  }
  async camera(stream: MediaStream) {
    const pc = this.peer,
      video = this.video;
    if (!pc || !video)
      throw new Error("Pair the phone again to connect video.");
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live")
      throw new Error("Enable the camera first.");
    this.cameraTrack = track;
    track.contentHint = "detail";
    video.watch();
    await video.waitForSignaling();
    if (
      pc !== this.peer ||
      track !== this.cameraTrack ||
      track.readyState !== "live"
    )
      throw new Error("Camera was stopped.");
    if (this.cameraSender) {
      await this.pauseCamera(false);
      if (!videoConnected(pc)) await this.offer(true);
      if (
        pc !== this.peer ||
        track !== this.cameraTrack ||
        track.readyState !== "live"
      )
        throw new Error("Camera was stopped.");
      this.action("camera-source");
      return stream;
    }
    this.cameraPaused = false;
    this.cameraSender = pc.addTransceiver(track, {
      direction: "sendonly",
      streams: [stream],
      sendEncodings: [
        {
          maxBitrate: 40000000,
          maxFramerate: track.getSettings().frameRate ?? 30,
          scaleResolutionDownBy: 1,
        },
      ],
    }).sender;
    await this.offer(!videoConnected(pc));
    if (
      pc !== this.peer ||
      track !== this.cameraTrack ||
      track.readyState !== "live"
    )
      throw new Error("Camera was stopped.");
    return stream;
  }
  pauseCamera(paused: boolean) {
    this.cameraPaused = paused;
    this.cameraUpdate = this.cameraUpdate
      .catch(() => {})
      .then(async () => {
        if (this.cameraSender)
          await this.cameraSender.replaceTrack(
            this.cameraPaused ? null : (this.cameraTrack ?? null),
          );
      });
    return this.cameraUpdate;
  }
  async stopCamera() {
    this.cameraTrack = undefined;
    await this.pauseCamera(true);
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
    this.video?.dispose();
    this.video = undefined;
    this.images?.dispose();
    this.images = undefined;
    this.actions = undefined;
    this.samples = undefined;
    this.pending = {};
    clearInterval(this.heartbeat);
    clearTimeout(this.flushTimer);
    this.offs.forEach((fn) => fn());
    this.offs = [];
    this.peer?.getSenders().forEach((s) => s.track?.stop());
    this.peer?.close();
    this.cameraTrack?.stop();
    this.cameraTrack = undefined;
    this.cameraSender = undefined;
    this.peer = undefined;
  }
}

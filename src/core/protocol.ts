import { z } from "zod";
import {
  SceneSchema,
  BatchSchema,
  SensorSchema,
  MacrosSchema,
} from "./model.js";
export const PROTOCOL_VERSION = 1 as const;
export const OperationSchema = z.enum([
  "get_capabilities",
  "get_scene",
  "get_frame",
  "get_metrics",
  "upload_asset",
  "load_scene",
  "apply_commands",
  "capture",
  "freeze",
  "reset",
  "find_balance",
  "save_scene",
  "start_recording",
  "stop_recording",
]);
export const OperationRequestSchema = z
  .object({ method: OperationSchema, args: z.record(z.unknown()).default({}) })
  .strict();
export const ControllerSampleSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("macros"),
      uid: z.string(),
      epoch: z.number().int(),
      seq: z.number().int(),
      values: MacrosSchema.partial(),
    })
    .strict(),
  z
    .object({
      type: z.literal("sensors"),
      uid: z.string(),
      epoch: z.number().int(),
      seq: z.number().int(),
      values: SensorSchema,
    })
    .strict(),
]);
export const ControllerActionSchema = z
  .object({
    id: z.string().max(100),
    uid: z.string().max(128),
    epoch: z.number().int(),
    type: z.enum(["capture", "freeze", "reset", "inject", "balance", "preset"]),
    value: z.string().max(40).optional(),
  })
  .strict();
export const CheckpointStateSchema = z.object({
  frame: z.number().int().nonnegative(),
  pulse: z.number().int().min(0).max(1000),
  heads: z.record(z.number().int().min(0).max(30)),
  front: z.record(z.number().int().min(0).max(1)),
});
export const CheckpointBufferSchema = z.object({
  key: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+:\d+$/),
  width: z.number().int().min(1).max(3840),
  height: z.number().int().min(1).max(2160),
  float: z.boolean(),
  file: z.string().regex(/^buffers\/\d+\.gz$/),
});
export const AssetDescriptorSchema = z.object({
  id: z.string(),
  name: z.string().max(500),
  kind: z.enum(["image", "gif", "video", "text", "camera"]),
  text: z.string().max(200000).optional(),
  fontSize: z.number().min(8).max(1000).optional(),
  textMode: z.enum(["lines", "glyphs", "block"]).optional(),
  tracking: z.number().min(-2).max(16).optional(),
  position: z.number().finite().nonnegative().optional(),
  gifRemaining: z.number().nonnegative().optional(),
  gifLoops: z.number().int().nonnegative().optional(),
  paused: z.boolean().optional(),
  file: z
    .string()
    .regex(/^assets\/\d+$/)
    .optional(),
  mime: z.string().max(100).optional(),
  lastFrame: z
    .string()
    .regex(/^assets\/\d+\.png$/)
    .optional(),
});
export const MomentManifestSchema = z.object({
  format: z.literal("feedback-moment"),
  version: z.literal(1),
  moment: z.object({
    scene: SceneSchema,
    state: CheckpointStateSchema,
    precision: z.string().max(100),
    recordingType: z.string().max(150).optional(),
  }),
  buffers: z.array(CheckpointBufferSchema).max(1200),
  assets: z.array(AssetDescriptorSchema).max(64),
});
export const CommandReceiptSchema = z.object({
  status: z.enum(["pending", "complete", "expired"]),
  ok: z.boolean().optional(),
  value: z.unknown().optional(),
  error: z.string().optional(),
  finished: z.number().optional(),
  actor: z.string().optional(),
});
export { SceneSchema, BatchSchema, SensorSchema };

import { useMemo, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Connection,
  applyNodeChanges,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, CircleDot, Radio, AudioLines } from "lucide-react";
import {
  NODE_SPECS,
  clone,
  type NodeKind,
  type Modulation,
} from "../core/model";
import { newNode } from "../core/presets";
import { studio, useStudio, attempt } from "../core/studio";
import { Slider } from "./Controls";
function SignalNode({ data }: NodeProps) {
  const kind = data.kind as NodeKind,
    spec = NODE_SPECS[kind];
  return (
    <div className={`signal-node kind-${kind}`}>
      <span className="node-kind">
        {kind === "history" ? "One frame minimum" : spec.label}
      </span>
      <strong>{data.label as string}</strong>
      {spec.inputs.map((port, i) => (
        <div className="node-port" key={port}>
          <Handle
            type="target"
            position={Position.Left}
            id={port}
            style={{ top: 64 + i * 21 }}
          />
          <span>{port}</span>
        </div>
      ))}
      {kind !== "output" && (
        <Handle type="source" position={Position.Right} id="out" />
      )}
    </div>
  );
}
const nodeTypes = { signal: SignalNode };
export function Patch() {
  const state = useStudio(),
    scene = state.scene;
  const [selected, setSelected] = useState("optics-a");
  const [add, setAdd] = useState<NodeKind>("screen");
  const modelNodes = useMemo(
    () =>
      scene.graph.nodes.map((n) => ({
        id: n.id,
        type: "signal",
        position: n.position,
        data: { kind: n.kind, label: n.label },
        selected: n.id === selected,
      })),
    [scene.graph, selected],
  );
  const [nodes, setNodes] = useState<Node[]>(modelNodes);
  useEffect(() => setNodes(modelNodes), [modelNodes]);
  const edges = useMemo(
    () =>
      scene.graph.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        targetHandle: e.input,
        style: {
          stroke:
            scene.graph.nodes.find((n) => n.id === e.from)?.kind === "history"
              ? "#91b8ce"
              : "#69767d",
          strokeWidth: 1.4,
        },
        animated: false,
      })),
    [scene.graph],
  );
  const chosen = scene.graph.nodes.find((n) => n.id === selected);
  const connect = (c: Connection) =>
    attempt(() => {
      if (!c.source || !c.target || !c.targetHandle) return;
      const graph = clone(scene.graph);
      graph.edges.push({
        id: crypto.randomUUID(),
        from: c.source,
        to: c.target,
        input: c.targetHandle,
      });
      studio.commands([{ type: "graph", graph }]);
    });
  function modulation(patch: Partial<Modulation>, id: string) {
    studio.commands([
      {
        type: "modulations",
        values: scene.modulations.map((m) =>
          m.id === id ? { ...m, ...patch } : m,
        ),
      },
    ]);
  }
  return (
    <>
      <div className="drawer-intro">
        <h2>The optical bench</h2>
        <p>Follow the signal. Change what comes back.</p>
      </div>
      <div className="patch-toolbar">
        <label className="check">
          <input
            type="checkbox"
            checked={scene.linked}
            onChange={(e) =>
              attempt(() =>
                studio.commands([
                  { type: "linked", enabled: e.target.checked },
                ]),
              )
            }
          />{" "}
          Link camera movement
        </label>
        <div className="inline">
          <select
            aria-label="Processing block"
            value={add}
            onChange={(e) => setAdd(e.target.value as NodeKind)}
          >
            {Object.entries(NODE_SPECS)
              .filter(([k]) => k !== "output")
              .map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
          </select>
          <button
            className="icon-button"
            aria-label="Add processing block"
            onClick={() =>
              attempt(() => {
                const graph = clone(scene.graph);
                const n = newNode(add, graph.nodes.length);
                graph.nodes.push(n);
                studio.commands([{ type: "graph", graph }]);
                setSelected(n.id);
              })
            }
          >
            <Plus size={17} />
          </button>
        </div>
      </div>
      <div className="patch-canvas">
        <ReactFlow
          nodes={nodes}
          onNodesChange={(changes) =>
            setNodes((current) => applyNodeChanges(changes, current))
          }
          edges={edges}
          nodeTypes={nodeTypes}
          onConnect={connect}
          onNodeClick={(_, n) => setSelected(n.id)}
          onNodeDragStop={(_, n) =>
            attempt(() => {
              const graph = clone(scene.graph);
              graph.nodes.find((x) => x.id === n.id)!.position = n.position;
              studio.commands([{ type: "graph", graph }]);
            })
          }
          onEdgesDelete={(deleted) =>
            attempt(() => {
              const graph = clone(scene.graph);
              graph.edges = graph.edges.filter(
                (e) => !deleted.some((d) => d.id === e.id),
              );
              studio.commands([{ type: "graph", graph }]);
            })
          }
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#30383c" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="patch-note">
        <CircleDot size={14} />
        <span>
          Frame memory closes the loop. Repatching starts a new evolution.
        </span>
      </div>
      {chosen && (
        <section className="node-inspector">
          <div className="section-heading">
            <h3>{chosen.label}</h3>
            {chosen.kind !== "output" && (
              <button
                className="icon-button"
                aria-label="Remove selected node"
                onClick={() =>
                  attempt(() => {
                    const graph = clone(scene.graph);
                    graph.nodes = graph.nodes.filter((n) => n.id !== chosen.id);
                    graph.edges = graph.edges.filter(
                      (e) => e.from !== chosen.id && e.to !== chosen.id,
                    );
                    studio.commands([{ type: "graph", graph }]);
                    setSelected("output");
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          {chosen.kind === "source" && (
            <label className="field-label">
              Source
              <select
                value={chosen.sourceId ?? scene.source}
                onChange={(e) =>
                  attempt(() => {
                    const graph = clone(scene.graph);
                    graph.nodes.find((n) => n.id === chosen.id)!.sourceId =
                      e.target.value;
                    studio.commands([{ type: "graph", graph }]);
                  })
                }
              >
                <option value="seed">Light seed</option>
                {state.assets.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="parameter-grid">
            {Object.entries(NODE_SPECS[chosen.kind].params).map(
              ([key, param]) => (
                <Slider
                  compact
                  key={key}
                  label={param.label}
                  value={chosen.params[key] ?? param.default}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  unit={param.unit}
                  onChange={(value) =>
                    attempt(() =>
                      studio.commands([
                        { type: "parameter", node: chosen.id, key, value },
                      ]),
                    )
                  }
                />
              ),
            )}
          </div>
        </section>
      )}
      <section>
        <div className="section-heading">
          <h3>
            <Radio size={16} /> Modulation
          </h3>
          <button
            className="text-button"
            onClick={() =>
              attempt(() =>
                studio.commands([
                  {
                    type: "modulations",
                    values: [
                      ...scene.modulations,
                      {
                        id: crypto.randomUUID(),
                        source: "sine",
                        target: "turn",
                        depth: 0.2,
                        rate: 0.08,
                        enabled: true,
                      },
                    ],
                  },
                ]),
              )
            }
          >
            <Plus size={15} /> Add
          </button>
        </div>
        {!scene.modulations.length && (
          <p className="muted small">
            Let a slow wave, sound, or movement turn a control.
          </p>
        )}
        {scene.modulations.map((mod) => (
          <div className="modulation" key={mod.id}>
            <input
              aria-label="Enable modulation"
              type="checkbox"
              checked={mod.enabled}
              onChange={(e) =>
                attempt(() => modulation({ enabled: e.target.checked }, mod.id))
              }
            />
            <select
              aria-label="Modulation source"
              value={mod.source}
              onChange={(e) =>
                attempt(() =>
                  modulation(
                    { source: e.target.value as Modulation["source"] },
                    mod.id,
                  ),
                )
              }
            >
              {[
                "sine",
                "triangle",
                "audio",
                "bass",
                "treble",
                "motion",
                "color",
                "roll",
                "tiltX",
                "tiltY",
              ].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span>to</span>
            <select
              aria-label="Modulation target"
              value={mod.target}
              onChange={(e) =>
                attempt(() =>
                  modulation(
                    { target: e.target.value as Modulation["target"] },
                    mod.id,
                  ),
                )
              }
            >
              {[
                "distance",
                "turn",
                "balance",
                "contrast",
                "color",
                "memory",
                "x",
                "y",
                "cameraSpin",
                "cameraBSpin",
                "screenSpin",
              ].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label="Modulation depth"
              title="Depth"
              type="number"
              step=".05"
              min="-1"
              max="1"
              value={mod.depth}
              onChange={(e) =>
                attempt(() => modulation({ depth: +e.target.value }, mod.id))
              }
            />
            <input
              aria-label="Modulation rate"
              title="Cycles per second"
              type="number"
              step=".01"
              min=".01"
              max="10"
              value={mod.rate}
              onChange={(e) =>
                attempt(() => modulation({ rate: +e.target.value }, mod.id))
              }
            />
            <button
              aria-label="Remove modulation"
              className="icon-button"
              onClick={() =>
                attempt(() =>
                  studio.commands([
                    {
                      type: "modulations",
                      values: scene.modulations.filter((m) => m.id !== mod.id),
                    },
                  ]),
                )
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
      <section>
        <div className="section-heading">
          <h3>
            <AudioLines size={16} /> Gesture loop
          </h3>
          <button
            className={state.recordingGestures ? "button recording" : "button"}
            onClick={() => attempt(() => studio.gestures())}
          >
            {state.recordingGestures ? "Finish & loop" : "Record gestures"}
          </button>
        </div>
        <p className="muted small">
          Record the movement of the performance controls.{" "}
          {scene.automation.duration > 0
            ? `${scene.automation.duration.toFixed(1)} seconds recorded.`
            : ""}
        </p>
        {scene.automation.points.length > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={scene.automation.playing}
              onChange={(e) =>
                attempt(() => {
                  const next = clone(scene);
                  next.automation.playing = e.target.checked;
                  studio.commit(next);
                })
              }
            />{" "}
            Play recorded gestures
          </label>
        )}
      </section>
    </>
  );
}

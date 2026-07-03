'use client';

// 3D "Brain" view — the real anatomical glass brain (mesh from /brain-model.json)
// with the REAL wiki graph ingested inside it, rendered as a NEURON network:
//   • nodes  = neuron cells (soma + dendrite spikes), instanced, with a soft glow halo
//   • edges  = curved, glowing synapse fibres
//   • hover  = the cell + its synapses light up and signal pulses travel the fibres
// Nodes are dim at rest; they light up ONLY on hover (canvas hover, or sidebar hover
// via `focusedIds`) — exactly like Graph view. No idle auto-firing.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BrainViewNode {
  id: string;
  title: string;
  color: string; // hex
  weight?: number;
}
export interface BrainViewEdge {
  source: string;
  target: string;
}

// Deterministic PRNG so node placement / orientation is stable across renders.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BrainModel {
  positions: number[];
  indices: number[];
  interior?: number[][];
}

// A single neuron cell: a small soma (icosphere) with a handful of tapering
// dendrite spikes radiating outward. Built once, then instanced per node.
function makeNeuronGeometry(): THREE.BufferGeometry {
  // toNonIndexed() on every part so mergeGeometries gets consistent attributes
  // (IcosahedronGeometry is non-indexed, ConeGeometry is indexed — must match).
  const parts: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(1, 1).toNonIndexed()];
  const dirs: Array<[number, number, number]> = [
    [1, 0.35, 0.2], [-0.85, 0.5, -0.3], [0.2, 1, 0.15], [-0.15, -0.92, 0.3],
    [0.45, 0.2, 1], [-0.5, -0.25, -0.9], [0.92, -0.45, -0.4], [-0.9, 0.35, 0.6],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const d = new THREE.Vector3();
  for (const [x, y, z] of dirs) {
    const cone = new THREE.ConeGeometry(0.16, 1.4, 6);
    cone.translate(0, 0.7, 0); // base at origin, tip pointing +Y
    d.set(x, y, z).normalize();
    q.setFromUnitVectors(up, d);
    cone.applyQuaternion(q);
    cone.translate(d.x * 0.82, d.y * 0.82, d.z * 0.82); // base on the soma surface
    parts.push(cone.toNonIndexed());
    cone.dispose();
  }
  return mergeGeometries(parts, false) ?? parts[0];
}

// Soft radial sprite used for both the cell glow halo and the travelling pulses.
function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function BrainView({
  nodes,
  edges,
  focusedIds,
  onNodeClick,
}: {
  nodes: BrainViewNode[];
  edges: BrainViewEdge[];
  focusedIds?: Set<string> | null;
  onNodeClick?: (id: string | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef<Set<string> | null>(focusedIds ?? null);
  useEffect(() => {
    focusedRef.current = focusedIds ?? null;
  }, [focusedIds]);
  const onClickRef = useRef(onNodeClick);
  useEffect(() => {
    onClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    const mount: HTMLDivElement | null = mountRef.current;
    if (!mount) return;
    const container: HTMLDivElement = mount;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const model: BrainModel = await fetch('/brain-model.json').then((r) => r.json());
      if (disposed) return;

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;

      // ----- renderer / scene / camera -----
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#ffffff');
      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
      camera.position.set(4.2, 0.3, 0); // static side (profile) view by default

      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      // ----- lighting (plain white scene) -----
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(3, 5, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.6);
      rim.position.set(-4, 2, -3);
      scene.add(rim);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xeeeeee, 0.4));

      // ----- real brain geometry from the model -----
      const outerGeo = new THREE.BufferGeometry();
      outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(model.positions, 3));
      outerGeo.setIndex(model.indices);
      outerGeo.computeVertexNormals();
      outerGeo.computeBoundingBox();
      outerGeo.computeBoundingSphere();
      const innerGeo = outerGeo.clone();
      innerGeo.scale(0.93, 0.93, 0.93);

      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.1, transmission: 1.0, thickness: 0.35, ior: 1.4,
        attenuationColor: new THREE.Color('#eef0f4'), attenuationDistance: 1.6, clearcoat: 0.5,
        clearcoatRoughness: 0.1, sheen: 0.5, sheenColor: new THREE.Color('#f1d6e0'), sheenRoughness: 0.4,
        envMapIntensity: 1.0, side: THREE.FrontSide, transparent: true, opacity: 1.0,
      });
      const innerMat = glassMat.clone();
      innerMat.side = THREE.BackSide;

      const brain = new THREE.Group();
      brain.add(new THREE.Mesh(outerGeo, glassMat));
      brain.add(new THREE.Mesh(innerGeo, innerMat));
      brain.rotation.y = -0.3;
      scene.add(brain);

      // ----- place REAL nodes at baked interior points -----
      const pool = (model.interior || []).map((a) => new THREE.Vector3(a[0], a[1], a[2]));
      const rng = mulberry32(0x9e3779b1 ^ nodes.length);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const N = nodes.length;
      // Pull every cell toward the brain centre by a small safety margin so neither
      // the soma nor its dendrite spikes can poke through the wall — but keep them
      // close to the surface so the brain stays well filled.
      const INWARD = 0.94;
      const positions: THREE.Vector3[] = nodes.map((_, i) =>
        pool.length ? pool[i % pool.length].clone().multiplyScalar(INWARD) : new THREE.Vector3(),
      );
      const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
      const palette = nodes.map((n) => new THREE.Color(n.color || '#9aa0a6'));
      const dimNode = new THREE.Color('#3a3a3a');
      const dimEdge = new THREE.Color('#dfe3ea'); // initial fibre colour (repainted each frame)
      const WHITE = new THREE.Color('#ffffff');

      const edgePairs: Array<[number, number]> = [];
      for (const e of edges) {
        const a = idIndex.get(e.source);
        const b = idIndex.get(e.target);
        if (a != null && b != null && a !== b) edgePairs.push([a, b]);
      }
      const neighbors = nodes.map(() => new Set<number>());
      const degree = new Array(N).fill(0);
      for (const [a, b] of edgePairs) { neighbors[a].add(b); neighbors[b].add(a); degree[a]++; degree[b]++; }

      // ----- neuron cells (instanced soma + dendrites) -----
      const neuronGeo = makeNeuronGeometry();
      const nodeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, toneMapped: false });
      const inst = new THREE.InstancedMesh(neuronGeo, nodeMat, Math.max(N, 1));
      inst.count = N;
      inst.renderOrder = 2;
      const sizes = nodes.map((_, i) => 0.006 + Math.min(degree[i], 12) * 0.0011);
      const m4 = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const scaleV = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        eul.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
        quat.setFromEuler(eul);
        scaleV.setScalar(sizes[i]);
        m4.compose(positions[i], quat, scaleV);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, dimNode);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      brain.add(inst);

      // ----- glow halos (Points; soft colored disc — reads as a glow on white) -----
      const glowTex = makeGlowTexture();
      const haloPos = new Float32Array(N * 3);
      const haloCol = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        haloPos[i * 3] = positions[i].x; haloPos[i * 3 + 1] = positions[i].y; haloPos[i * 3 + 2] = positions[i].z;
      }
      const haloGeo = new THREE.BufferGeometry();
      haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
      haloGeo.setAttribute('color', new THREE.BufferAttribute(haloCol, 3));
      const haloMat = new THREE.PointsMaterial({
        map: glowTex, vertexColors: true, transparent: true, size: 0.09, sizeAttenuation: true,
        depthTest: false, depthWrite: false, opacity: 0.9, blending: THREE.NormalBlending,
      });
      const halo = new THREE.Points(haloGeo, haloMat);
      halo.renderOrder = 0;
      brain.add(halo);

      // ----- curved synapse fibres -----
      const SEG = 10; // sample points per fibre
      const ctrl = new THREE.Vector3();
      const sp = new THREE.Vector3();
      const edgeSamples: THREE.Vector3[][] = edgePairs.map(([a, b]) => {
        const pa3 = positions[a], pb3 = positions[b];
        ctrl.copy(pa3).add(pb3).multiplyScalar(0.5).multiplyScalar(0.78); // bow inward, stays in cavity
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s < SEG; s++) {
          const t = s / (SEG - 1);
          const it = 1 - t;
          sp.set(0, 0, 0)
            .addScaledVector(pa3, it * it)
            .addScaledVector(ctrl, 2 * it * t)
            .addScaledVector(pb3, t * t);
          pts.push(sp.clone());
        }
        return pts;
      });
      const segCount = edgePairs.length * (SEG - 1);
      const edgePos = new Float32Array(segCount * 6);
      const edgeCol = new Float32Array(segCount * 6);
      {
        let vi = 0;
        for (let e = 0; e < edgePairs.length; e++) {
          const pts = edgeSamples[e];
          for (let s = 0; s < SEG - 1; s++) {
            const p0 = pts[s], p1 = pts[s + 1];
            edgePos[vi * 6 + 0] = p0.x; edgePos[vi * 6 + 1] = p0.y; edgePos[vi * 6 + 2] = p0.z;
            edgePos[vi * 6 + 3] = p1.x; edgePos[vi * 6 + 4] = p1.y; edgePos[vi * 6 + 5] = p1.z;
            edgeCol.set([dimEdge.r, dimEdge.g, dimEdge.b, dimEdge.r, dimEdge.g, dimEdge.b], vi * 6);
            vi++;
          }
        }
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
      edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3));
      const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, toneMapped: false });
      const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat);
      edgeMesh.renderOrder = 1;
      brain.add(edgeMesh);

      // ----- interaction: hover only (no auto-fire) -----
      const pointerNDC = new THREE.Vector2(-2, -2);
      let hovered: number | null = null;
      const tmpV = new THREE.Vector3();
      const canvasEl = renderer.domElement;
      function pickNode(): number | null {
        brain.updateWorldMatrix(true, false);
        const mat = brain.matrixWorld;
        let best: number | null = null, bestD2 = 0.0016;
        for (let i = 0; i < positions.length; i++) {
          tmpV.copy(positions[i]).applyMatrix4(mat).project(camera);
          if (tmpV.z > 1 || tmpV.z < -1) continue;
          const dx = tmpV.x - pointerNDC.x, dy = tmpV.y - pointerNDC.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        return best;
      }
      function onMove(e: PointerEvent) {
        const rect = canvasEl.getBoundingClientRect();
        pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        hovered = pickNode();
        const tip = tooltipRef.current;
        if (tip) {
          if (hovered != null) {
            tip.textContent = nodes[hovered].title;
            tip.style.left = `${e.clientX - rect.left + 12}px`;
            tip.style.top = `${e.clientY - rect.top + 12}px`;
            tip.style.opacity = '1';
          } else {
            tip.style.opacity = '0';
          }
        }
        canvasEl.style.cursor = hovered != null ? 'pointer' : 'default';
      }
      function onLeave() {
        hovered = null;
        if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
        canvasEl.style.cursor = 'default';
      }
      let downAt: { x: number; y: number; t: number } | null = null;
      function onDown(e: PointerEvent) {
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      }
      function onUp(e: PointerEvent) {
        if (!downAt) return;
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        const elapsed = performance.now() - downAt.t;
        downAt = null;
        if (moved > 5 || elapsed > 400) return; // was a drag, not a click
        const rect = canvasEl.getBoundingClientRect();
        pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const hit = pickNode();
        onClickRef.current?.(hit != null ? nodes[hit].id : null);
      }
      canvasEl.addEventListener('pointermove', onMove);
      canvasEl.addEventListener('pointerleave', onLeave);
      canvasEl.addEventListener('pointerdown', onDown);
      canvasEl.addEventListener('pointerup', onUp);

      // ----- paint: active = canvas-hovered cell (+neighbours), else sidebar focus set -----
      const active = new Float32Array(N);
      const pc = new THREE.Color();
      const gA = new THREE.Color(), gB = new THREE.Color(), seg0 = new THREE.Color(), seg1 = new THREE.Color();
      function paint() {
        active.fill(0);
        if (hovered != null) {
          active[hovered] = 1;
          for (const nb of neighbors[hovered]) active[nb] = 0.85;
        } else {
          const focus = focusedRef.current;
          if (focus && focus.size) {
            for (let i = 0; i < N; i++) if (focus.has(nodes[i].id)) active[i] = 1;
          }
        }

        // neuron cells — always shown in their (sub-)brain colour so they read
        // against the glass: muted at rest, bright when active.
        for (let i = 0; i < N; i++) {
          pc.copy(palette[i]).multiplyScalar(0.62 + 0.75 * active[i]);
          inst.setColorAt(i, pc);
        }
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

        // glow halos — faint at rest, bright when active
        for (let i = 0; i < N; i++) {
          const a = 0.12 + 0.88 * active[i];
          haloCol[i * 3] = palette[i].r * a;
          haloCol[i * 3 + 1] = palette[i].g * a;
          haloCol[i * 3 + 2] = palette[i].b * a;
        }
        haloGeo.attributes.color.needsUpdate = true;

        // synapse fibres — colour gradient scaled by activity
        let vi = 0;
        let peak = 0;
        for (let e = 0; e < edgePairs.length; e++) {
          const a = edgePairs[e][0], b = edgePairs[e][1];
          const ea = Math.max(active[a], active[b]);
          if (ea > peak) peak = ea;
          for (let s = 0; s < SEG - 1; s++) {
            const t0 = s / (SEG - 1), t1 = (s + 1) / (SEG - 1);
            // tinted but visible at rest, full brain colour when active
            gA.copy(palette[a]).lerp(palette[b], t0); seg0.copy(gA).lerp(WHITE, 0.4).lerp(gA, ea);
            gB.copy(palette[a]).lerp(palette[b], t1); seg1.copy(gB).lerp(WHITE, 0.4).lerp(gB, ea);
            const o = vi * 6;
            edgeCol[o] = seg0.r; edgeCol[o + 1] = seg0.g; edgeCol[o + 2] = seg0.b;
            edgeCol[o + 3] = seg1.r; edgeCol[o + 4] = seg1.g; edgeCol[o + 5] = seg1.b;
            vi++;
          }
        }
        edgeGeo.attributes.color.needsUpdate = true;
        // always visible at rest; a touch more opaque when something is active
        edgeMat.opacity = 0.6 + peak * 0.3;
      }

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 2.2;
      controls.maxDistance = 8;
      controls.target.set(0, 0, 0);
      controls.autoRotate = false; // static by default — drag to rotate
      controls.minPolarAngle = 0.2;
      controls.maxPolarAngle = Math.PI - 0.2;

      let raf = 0;
      function tick() {
        paint();
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);

      function onResize() {
        const w = container.clientWidth || 800, h = container.clientHeight || 600;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      }
      window.addEventListener('resize', onResize);
      const ro = new ResizeObserver(onResize);
      ro.observe(container);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        ro.disconnect();
        canvasEl.removeEventListener('pointermove', onMove);
        canvasEl.removeEventListener('pointerleave', onLeave);
        canvasEl.removeEventListener('pointerdown', onDown);
        canvasEl.removeEventListener('pointerup', onUp);
        controls.dispose();
        outerGeo.dispose(); innerGeo.dispose(); neuronGeo.dispose(); nodeMat.dispose();
        haloGeo.dispose(); haloMat.dispose(); glowTex.dispose();
        edgeGeo.dispose(); edgeMat.dispose();
        glassMat.dispose(); innerMat.dispose();
        pmrem.dispose(); renderer.dispose();
        if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      };
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [nodes, edges]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute', pointerEvents: 'none', opacity: 0, transition: 'opacity 0.12s',
          background: 'rgba(17,17,17,0.9)', color: '#fff', padding: '4px 8px', borderRadius: 6,
          fontSize: 12, maxWidth: 240, zIndex: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      />
      <div style={{ position: 'absolute', left: 16, bottom: 14, fontSize: 11, letterSpacing: '0.04em', color: '#888', pointerEvents: 'none' }}>
        BRAIN · drag to rotate · scroll to zoom · hover a neuron
      </div>
    </div>
  );
}

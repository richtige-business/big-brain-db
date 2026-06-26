'use client';

// 3D "Brain" view — the real anatomical glass brain (mesh from /brain-model.json)
// with the REAL wiki graph ingested inside it: each brain node is placed at a baked
// interior point, connected by its real wiki-link edges, coloured by its (sub-)brain.
// Adapted from the "Glass Brain" studio. NO auto-firing: nodes light up ONLY on hover
// (canvas hover, or sidebar hover via the `focusedIds` prop) — exactly like Graph view.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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

// Deterministic PRNG so node placement is stable across renders.
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
  // sidebar-hover focus set, read by the render loop without rebuilding the scene
  const focusedRef = useRef<Set<string> | null>(focusedIds ?? null);
  useEffect(() => {
    focusedRef.current = focusedIds ?? null;
  }, [focusedIds]);
  // latest click handler, read without rebuilding the scene
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

      // ----- lighting (plain white scene, no studio backdrop / shadows) -----
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
        color: 0xffffff, metalness: 0, roughness: 0.08, transmission: 1.0, thickness: 0.4, ior: 1.42,
        attenuationColor: new THREE.Color('#ffd6e6'), attenuationDistance: 1.6, clearcoat: 0.6,
        clearcoatRoughness: 0.08, sheen: 1.0, sheenColor: new THREE.Color('#ff8ab5'), sheenRoughness: 0.35,
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
      // deterministic shuffle of the pool so placement is stable but spread out
      const rng = mulberry32(0x9e3779b1 ^ nodes.length);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const positions: THREE.Vector3[] = nodes.map((_, i) =>
        pool.length ? pool[i % pool.length].clone() : new THREE.Vector3(),
      );
      const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
      const palette = nodes.map((n) => new THREE.Color(n.color || '#9aa0a6'));
      const dimNode = new THREE.Color('#3a3a3a');
      const dimEdge = new THREE.Color('#2a2a2a');

      const edgePairs: Array<[number, number]> = [];
      for (const e of edges) {
        const a = idIndex.get(e.source);
        const b = idIndex.get(e.target);
        if (a != null && b != null && a !== b) edgePairs.push([a, b]);
      }
      const neighbors = nodes.map(() => new Set<number>());
      const degree = new Array(nodes.length).fill(0);
      for (const [a, b] of edgePairs) { neighbors[a].add(b); neighbors[b].add(a); degree[a]++; degree[b]++; }

      const nodeGeo = new THREE.SphereGeometry(1, 14, 14);
      const nodeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false });
      const inst = new THREE.InstancedMesh(nodeGeo, nodeMat, Math.max(nodes.length, 1));
      inst.count = nodes.length; // draw exactly N (0 → nothing)
      inst.renderOrder = 2;
      const sizes = nodes.map((_, i) => 0.008 + Math.min(degree[i], 12) * 0.0016);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < nodes.length; i++) {
        m4.makeScale(sizes[i], sizes[i], sizes[i]); m4.setPosition(positions[i]);
        inst.setMatrixAt(i, m4); inst.setColorAt(i, dimNode);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      brain.add(inst);

      const edgeGeo = new THREE.BufferGeometry();
      const edgePos = new Float32Array(edgePairs.length * 6);
      const edgeCol = new Float32Array(edgePairs.length * 6);
      for (let i = 0; i < edgePairs.length; i++) {
        const a = positions[edgePairs[i][0]], b = positions[edgePairs[i][1]];
        edgePos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        edgeCol.set([dimEdge.r, dimEdge.g, dimEdge.b, dimEdge.r, dimEdge.g, dimEdge.b], i * 6);
      }
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
      edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3));
      const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false, toneMapped: false });
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
      // click → open preview (distinguish from orbit drag by movement/time)
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

      // ----- paint: active = canvas-hovered node (+neighbours), else sidebar focus set -----
      const N = nodes.length;
      const active = new Float32Array(N);
      const pc = new THREE.Color(), pa = new THREE.Color(), pb = new THREE.Color();
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
        for (let i = 0; i < N; i++) {
          pc.copy(dimNode).lerp(palette[i], active[i]);
          if (active[i] > 0.5) pc.multiplyScalar(1.25);
          inst.setColorAt(i, pc);
        }
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        let peak = 0;
        for (let e = 0; e < edgePairs.length; e++) {
          const a = edgePairs[e][0], b = edgePairs[e][1];
          const ea = Math.max(active[a], active[b]);
          if (ea > peak) peak = ea;
          pa.copy(dimEdge).lerp(palette[a], ea); pb.copy(dimEdge).lerp(palette[b], ea);
          edgeCol.set([pa.r, pa.g, pa.b, pb.r, pb.g, pb.b], e * 6);
        }
        edgeGeo.attributes.color.needsUpdate = true;
        edgeMat.opacity = 0.28 + peak * 0.5;
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
        controls.dispose();
        outerGeo.dispose(); innerGeo.dispose(); nodeGeo.dispose(); nodeMat.dispose();
        edgeGeo.dispose(); edgeMat.dispose(); glassMat.dispose(); innerMat.dispose();
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
        BRAIN · drag to rotate · scroll to zoom · hover a node
      </div>
    </div>
  );
}

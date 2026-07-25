/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import {
  createConstraintSet,
  resetConstraintLambdas,
  solveDistances,
  solveMaximumDistances,
  solveMinimumAreas,
  solveTethers,
  type ConstraintSet,
} from "./constraints";
import { clampMagnitude, finiteArray, signedTriangleArea } from "./math";
import { resolveParameters, type ResolvedPhysicsParameters } from "./parameters";
import { SeededRandom } from "./prng";
import { createRigidFrameState, stepRigidFrame } from "./rigidFrame";
import { createShapeClusters, solveShapeMatching, type ShapeCluster } from "./shapeMatching";
import type {
  MeshData,
  MotionParameters,
  PhysicsInput,
  PhysicsSnapshot,
  Point,
  RigidFrameState,
  SolverQuality,
} from "./types";

export interface PhysicsSimulatorOptions {
  mesh: MeshData;
  parameters: MotionParameters;
  seed: number;
  quality?: SolverQuality;
}

export const DEFAULT_SOLVER_QUALITY: SolverQuality = {
  tickRate: 120,
  iterations: 4,
  maxCatchUpSteps: 4,
};

const AUTOMATIC_REGION_GAIN = 1.6;

function gravityVector(parameters: MotionParameters, acceleration: number): Point {
  switch (parameters.gravityDirection) {
    case "down": return { x: 0, y: acceleration };
    case "up": return { x: 0, y: -acceleration };
    case "left": return { x: -acceleration, y: 0 };
    case "right": return { x: acceleration, y: 0 };
    case "none": return { x: 0, y: 0 };
  }
}

export function gravityOnsetMultiplier(elapsedSeconds: number): number {
  return 1 + 22 * Math.exp(-Math.max(0, elapsedSeconds) * 5);
}

export function selectionResponseForWeight(weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  if (weight >= 0.8) return Math.min(1, weight);
  const progress = weight / 0.8;
  const smoothProgress = progress * progress * (3 - 2 * progress);
  return weight * (0.35 + 0.65 * smoothProgress);
}

export function meanActiveSelectionResponse(weights: ArrayLike<number>): number {
  let total = 0;
  let activeCount = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (!(weight > 0)) continue;
    total += selectionResponseForWeight(weight);
    activeCount += 1;
  }
  return activeCount > 0 ? total / activeCount : 0;
}

export class PhysicsSimulator {
  public readonly mesh: MeshData;
  public readonly quality: SolverQuality;
  public readonly constraints: ConstraintSet;
  public readonly clusters: ShapeCluster[];
  public readonly frame: RigidFrameState;

  private parameters: MotionParameters;
  private resolved: ResolvedPhysicsParameters;
  private readonly random: SeededRandom;
  private seed: number;
  private readonly secondaryOffsets: Float64Array;
  private readonly secondaryVelocities: Float64Array;
  private readonly vertexClusterIndices: Int32Array;
  private readonly automaticSpatialFactors: Float64Array;
  private readonly elongationXFactors: Float64Array;
  private readonly elongationYFactors: Float64Array;
  private readonly tetherTargetOffsets: Float64Array;
  private gravityElapsedSeconds = 0;
  private accumulator = 0;
  private tickValue = 0;

  public constructor(options: PhysicsSimulatorOptions) {
    this.mesh = options.mesh;
    this.parameters = { ...options.parameters };
    this.resolved = resolveParameters(this.parameters);
    this.quality = { ...DEFAULT_SOLVER_QUALITY, ...options.quality };
    this.seed = options.seed >>> 0;
    this.random = new SeededRandom(options.seed);
    this.constraints = createConstraintSet(this.mesh);
    this.clusters = createShapeClusters(this.mesh);
    this.frame = createRigidFrameState();
    this.secondaryOffsets = new Float64Array(this.mesh.positions.length);
    this.secondaryVelocities = new Float64Array(this.mesh.positions.length);
    this.vertexClusterIndices = new Int32Array(this.mesh.weights.length);
    this.vertexClusterIndices.fill(-1);
    this.automaticSpatialFactors = new Float64Array(this.mesh.weights.length);
    this.elongationXFactors = new Float64Array(this.mesh.weights.length);
    this.elongationYFactors = new Float64Array(this.mesh.weights.length);
    this.tetherTargetOffsets = new Float64Array(this.mesh.positions.length);
    this.initializeSpatialFields();
  }

  public get tick(): number {
    return this.tickValue;
  }

  public get fixedDeltaTime(): number {
    return 1 / this.quality.tickRate;
  }

  public setParameters(parameters: MotionParameters): void {
    if (
      parameters.gravityDirection !== this.parameters.gravityDirection
    ) {
      this.gravityElapsedSeconds = 0;
    }
    this.parameters = { ...parameters };
    this.resolved = resolveParameters(parameters);
  }

  public step(input: PhysicsInput = {}): void {
    const dt = this.fixedDeltaTime;
    stepRigidFrame(this.frame, input, dt);
    resetConstraintLambdas(this.constraints);
    const gravity = gravityVector(
      this.parameters,
      this.resolved.gravityAcceleration * gravityOnsetMultiplier(this.gravityElapsedSeconds),
    );
    const gravityTarget = gravityVector(this.parameters, this.resolved.gravityTargetDisplacement);
    const directAcceleration = clampMagnitude(input.localAcceleration ?? { x: 0, y: 0 }, 8);
    const automaticAcceleration = clampMagnitude(input.automaticAcceleration ?? { x: 0, y: 0 }, 1);
    const inertia = {
      x: -this.frame.acceleration.x * this.resolved.inputGain,
      y: -this.frame.acceleration.y * this.resolved.inputGain,
    };
    const dynamicAcceleration = clampMagnitude({
      x: directAcceleration.x * this.resolved.inputGain + inertia.x,
      y: directAcceleration.y * this.resolved.inputGain + inertia.y,
    }, 24);
    const primaryGain = 1 - this.resolved.secondaryMotionStrength * 0.52;
    const automaticGain = this.resolved.inputGain * AUTOMATIC_REGION_GAIN;

    for (let vertex = 0; vertex < this.mesh.weights.length; vertex += 1) {
      const offset = vertex * 2;
      const inverseMass = this.mesh.inverseMasses[vertex] ?? 0;
      this.mesh.previousPositions[offset] = this.mesh.positions[offset] ?? 0;
      this.mesh.previousPositions[offset + 1] = this.mesh.positions[offset + 1] ?? 0;
      if (inverseMass <= 0) {
        this.mesh.positions[offset] = this.mesh.restPositions[offset] ?? 0;
        this.mesh.positions[offset + 1] = this.mesh.restPositions[offset + 1] ?? 0;
        this.mesh.velocities[offset] = 0;
        this.mesh.velocities[offset + 1] = 0;
        continue;
      }
      const randomFluctuationScale = (1 - this.resolved.tremorStrength) ** 2;
      const fluctuationX = this.random.nextSigned() * this.resolved.fluctuationAcceleration * randomFluctuationScale;
      const fluctuationY = this.random.nextSigned() * this.resolved.fluctuationAcceleration * randomFluctuationScale;
      const floating = this.parameters.gravityDirection === "none"
        ? this.floatingAccelerationForVertex(vertex)
        : { x: 0, y: 0 };
      const automaticFactor = this.automaticSpatialFactors[vertex] ?? 0;
      const automatic = {
        x: automaticAcceleration.x * automaticGain * automaticFactor,
        y: automaticAcceleration.y * automaticGain * automaticFactor,
      };
      const elongationSource = {
        x: dynamicAcceleration.x + automaticAcceleration.x * automaticGain,
        y: dynamicAcceleration.y + automaticAcceleration.y * automaticGain,
      };
      const elongation = {
        x: elongationSource.x * this.resolved.elongationStrength * 1.8 * (this.elongationXFactors[vertex] ?? 0),
        y: elongationSource.y * this.resolved.elongationStrength * 1.8 * (this.elongationYFactors[vertex] ?? 0),
      };
      const tremor = this.tremorAccelerationForVertex(vertex);
      const tremorTarget = this.tremorTargetForVertex(vertex);
      const selectionResponse = selectionResponseForWeight(this.mesh.weights[vertex] ?? 0);
      const elongationTarget = {
        x: elongationSource.x / 24 * this.resolved.elongationStrength * 0.04 * (this.elongationXFactors[vertex] ?? 0) * selectionResponse,
        y: elongationSource.y / 24 * this.resolved.elongationStrength * 0.04 * (this.elongationYFactors[vertex] ?? 0) * selectionResponse,
      };
      this.tetherTargetOffsets[offset] = tremorTarget.x + elongationTarget.x + gravityTarget.x * selectionResponse;
      this.tetherTargetOffsets[offset + 1] = tremorTarget.y + elongationTarget.y + gravityTarget.y * selectionResponse;
      const vertexDynamic = clampMagnitude({
        x: (dynamicAcceleration.x + automatic.x + elongation.x + tremor.x) * selectionResponse,
        y: (dynamicAcceleration.y + automatic.y + elongation.y + tremor.y) * selectionResponse,
      }, 24);
      const secondary = this.stepSecondaryMotion(vertex, vertexDynamic, dt);
      const accelerationX = (gravity.x + floating.x + fluctuationX) * selectionResponse + vertexDynamic.x * primaryGain + secondary.x;
      const accelerationY = (gravity.y + floating.y + fluctuationY) * selectionResponse + vertexDynamic.y * primaryGain + secondary.y;
      const velocity = clampMagnitude({
        x: (this.mesh.velocities[offset] ?? 0) + accelerationX * inverseMass * dt,
        y: (this.mesh.velocities[offset + 1] ?? 0) + accelerationY * inverseMass * dt,
      }, this.resolved.maximumSpeed);
      this.mesh.velocities[offset] = velocity.x;
      this.mesh.velocities[offset + 1] = velocity.y;
      this.mesh.positions[offset] = (this.mesh.positions[offset] ?? 0) + velocity.x * dt;
      this.mesh.positions[offset + 1] = (this.mesh.positions[offset + 1] ?? 0) + velocity.y * dt;
      this.clampVertexDisplacement(vertex);
    }

    for (let iteration = 0; iteration < this.quality.iterations; iteration += 1) {
      solveTethers(this.mesh, this.constraints, this.resolved.tetherCompliance, dt, this.tetherTargetOffsets);
      solveDistances(this.mesh, this.constraints, this.resolved.distanceCompliance, dt);
      solveMaximumDistances(this.mesh, this.constraints, this.resolved.maximumStretchRatio, 1e-9, dt);
      solveMinimumAreas(this.mesh, this.constraints, 1e-10, dt);
      solveShapeMatching(this.mesh, this.clusters, this.resolved.shapeStrength);
    }
    solveMaximumDistances(this.mesh, this.constraints, this.resolved.maximumStretchRatio, 0, dt);
    solveMinimumAreas(this.mesh, this.constraints, 0, dt);

    const damping = Math.exp(-this.resolved.dampingRate * dt);
    for (let vertex = 0; vertex < this.mesh.weights.length; vertex += 1) {
      const offset = vertex * 2;
      if ((this.mesh.inverseMasses[vertex] ?? 0) <= 0) {
        this.mesh.positions[offset] = this.mesh.restPositions[offset] ?? 0;
        this.mesh.positions[offset + 1] = this.mesh.restPositions[offset + 1] ?? 0;
        this.mesh.velocities[offset] = 0;
        this.mesh.velocities[offset + 1] = 0;
        continue;
      }
      this.clampVertexDisplacement(vertex);
      const velocity = clampMagnitude({
        x: ((this.mesh.positions[offset] ?? 0) - (this.mesh.previousPositions[offset] ?? 0)) / dt * damping,
        y: ((this.mesh.positions[offset + 1] ?? 0) - (this.mesh.previousPositions[offset + 1] ?? 0)) / dt * damping,
      }, this.resolved.maximumSpeed);
      this.mesh.velocities[offset] = velocity.x;
      this.mesh.velocities[offset + 1] = velocity.y;
    }
    this.gravityElapsedSeconds += dt;
    this.tickValue += 1;
  }

  public advance(elapsedSeconds: number, inputForTick: (tick: number) => PhysicsInput = () => ({})): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new RangeError("Elapsed time must be finite and non-negative.");
    }
    this.accumulator += Math.min(elapsedSeconds, 0.25);
    const dt = this.fixedDeltaTime;
    let steps = 0;
    while (this.accumulator + 1e-12 >= dt && steps < this.quality.maxCatchUpSteps) {
      this.step(inputForTick(this.tickValue));
      this.accumulator -= dt;
      steps += 1;
    }
    if (steps === this.quality.maxCatchUpSteps && this.accumulator >= dt) {
      this.accumulator %= dt;
    }
    return steps;
  }

  public createSnapshot(): PhysicsSnapshot {
    return {
      version: 1,
      seed: this.seed,
      tick: this.tickValue,
      accumulator: this.accumulator,
      randomState: this.random.getState(),
      gravityElapsedSeconds: this.gravityElapsedSeconds,
      parameters: { ...this.parameters },
      quality: { ...this.quality },
      positions: Array.from(this.mesh.positions),
      previousPositions: Array.from(this.mesh.previousPositions),
      velocities: Array.from(this.mesh.velocities),
      secondaryOffsets: Array.from(this.secondaryOffsets),
      secondaryVelocities: Array.from(this.secondaryVelocities),
      frame: {
        position: { ...this.frame.position },
        velocity: { ...this.frame.velocity },
        acceleration: { ...this.frame.acceleration },
      },
      constraintLambdas: {
        tetherX: Array.from(this.constraints.tetherX),
        tetherY: Array.from(this.constraints.tetherY),
        distance: Array.from(this.constraints.distanceLambdas),
        maximumDistance: Array.from(this.constraints.maximumDistanceLambdas),
        area: Array.from(this.constraints.areaLambdas),
      },
      clusterRotations: this.clusters.map((cluster) => cluster.previousRotation),
    };
  }

  public restoreSnapshot(snapshot: PhysicsSnapshot): void {
    if (snapshot.version !== 1) throw new Error("Unsupported physics snapshot version.");
    if (
      snapshot.quality.tickRate !== this.quality.tickRate
      || snapshot.quality.iterations !== this.quality.iterations
      || snapshot.quality.maxCatchUpSteps !== this.quality.maxCatchUpSteps
    ) {
      throw new Error("Physics snapshot solver quality does not match the simulator.");
    }
    const copy = (source: number[], destination: Float64Array, label: string): void => {
      if (source.length !== destination.length || !finiteArray(source)) {
        throw new Error(`Invalid ${label} snapshot data.`);
      }
      destination.set(source);
    };
    copy(snapshot.positions, this.mesh.positions, "position");
    copy(snapshot.previousPositions, this.mesh.previousPositions, "previous position");
    copy(snapshot.velocities, this.mesh.velocities, "velocity");
    copy(snapshot.secondaryOffsets, this.secondaryOffsets, "secondary offset");
    copy(snapshot.secondaryVelocities, this.secondaryVelocities, "secondary velocity");
    copy(snapshot.constraintLambdas.tetherX, this.constraints.tetherX, "tether X");
    copy(snapshot.constraintLambdas.tetherY, this.constraints.tetherY, "tether Y");
    copy(snapshot.constraintLambdas.distance, this.constraints.distanceLambdas, "distance lambda");
    copy(snapshot.constraintLambdas.maximumDistance, this.constraints.maximumDistanceLambdas, "maximum-distance lambda");
    copy(snapshot.constraintLambdas.area, this.constraints.areaLambdas, "area lambda");
    if (snapshot.clusterRotations.length !== this.clusters.length || !finiteArray(snapshot.clusterRotations)) {
      throw new Error("Invalid cluster rotation snapshot data.");
    }
    snapshot.clusterRotations.forEach((rotation, index) => {
      const cluster = this.clusters[index];
      if (cluster) cluster.previousRotation = rotation;
    });
    this.tickValue = snapshot.tick;
    this.accumulator = snapshot.accumulator;
    this.seed = snapshot.seed >>> 0;
    this.random.setState(snapshot.randomState);
    this.setParameters(snapshot.parameters);
    if (!Number.isFinite(snapshot.gravityElapsedSeconds) || snapshot.gravityElapsedSeconds < 0) {
      throw new Error("Invalid gravity elapsed time in physics snapshot.");
    }
    this.gravityElapsedSeconds = snapshot.gravityElapsedSeconds;
    this.frame.position = { ...snapshot.frame.position };
    this.frame.velocity = { ...snapshot.frame.velocity };
    this.frame.acceleration = { ...snapshot.frame.acceleration };
  }

  public isFinite(): boolean {
    return finiteArray(this.mesh.positions)
      && finiteArray(this.mesh.velocities)
      && finiteArray(this.secondaryOffsets)
      && finiteArray(this.secondaryVelocities)
      && Number.isFinite(this.gravityElapsedSeconds)
      && Number.isFinite(this.frame.position.x)
      && Number.isFinite(this.frame.position.y);
  }

  public hasInvertedTriangles(): boolean {
    return this.constraints.areas.some(({ a, b, c }) => signedTriangleArea(
      this.mesh.positions[a * 2] ?? 0,
      this.mesh.positions[a * 2 + 1] ?? 0,
      this.mesh.positions[b * 2] ?? 0,
      this.mesh.positions[b * 2 + 1] ?? 0,
      this.mesh.positions[c * 2] ?? 0,
      this.mesh.positions[c * 2 + 1] ?? 0,
    ) <= 0);
  }

  private clampVertexDisplacement(vertex: number): void {
    const offset = vertex * 2;
    const displacement = clampMagnitude({
      x: (this.mesh.positions[offset] ?? 0) - (this.mesh.restPositions[offset] ?? 0),
      y: (this.mesh.positions[offset + 1] ?? 0) - (this.mesh.restPositions[offset + 1] ?? 0),
    }, this.resolved.maximumDisplacement);
    this.mesh.positions[offset] = (this.mesh.restPositions[offset] ?? 0) + displacement.x;
    this.mesh.positions[offset + 1] = (this.mesh.restPositions[offset + 1] ?? 0) + displacement.y;
  }

  private stepSecondaryMotion(vertex: number, input: Point, dt: number): Point {
    const offset = vertex * 2;
    const strength = this.resolved.secondaryMotionStrength;
    if (strength <= 0) {
      this.secondaryOffsets[offset] = 0;
      this.secondaryOffsets[offset + 1] = 0;
      this.secondaryVelocities[offset] = 0;
      this.secondaryVelocities[offset + 1] = 0;
      return { x: 0, y: 0 };
    }

    const restX = this.mesh.restPositions[offset] ?? 0;
    const restY = this.mesh.restPositions[offset + 1] ?? 0;
    const spatialPhase = Math.sin(restX * 8.37 + restY * 5.19);
    const frequency = this.resolved.secondaryFrequency * (1 + spatialPhase * this.resolved.secondaryPhaseSpread);
    const omega = Math.PI * 2 * frequency;
    const damping = 2 * this.resolved.secondaryDampingRatio * omega;
    const verticalCoupling = input.x * spatialPhase * 0.22 * this.resolved.secondaryVerticalBias;
    const targets = [
      input.x * 0.045 * (1 - this.resolved.secondaryVerticalBias * 0.45),
      (input.y + verticalCoupling) * 0.06,
    ];
    const result = { x: 0, y: 0 };
    for (let axis = 0; axis < 2; axis += 1) {
      const stateIndex = offset + axis;
      const position = this.secondaryOffsets[stateIndex] ?? 0;
      const velocity = this.secondaryVelocities[stateIndex] ?? 0;
      const target = (targets[axis] ?? 0) * strength;
      const acceleration = (target - position) * omega * omega - velocity * damping;
      const nextVelocity = Math.max(-12, Math.min(12, velocity + acceleration * dt));
      const nextPosition = Math.max(-1.5, Math.min(1.5, position + nextVelocity * dt));
      this.secondaryVelocities[stateIndex] = nextVelocity;
      this.secondaryOffsets[stateIndex] = nextPosition;
      const force = nextPosition * strength * 9;
      if (axis === 0) result.x = force;
      else result.y = force;
    }
    return result;
  }

  private floatingAccelerationForVertex(vertex: number): Point {
    const offset = vertex * 2;
    const restX = this.mesh.restPositions[offset] ?? 0;
    const restY = this.mesh.restPositions[offset + 1] ?? 0;
    const time = this.tickValue * this.fixedDeltaTime;
    const clusterIndex = this.vertexClusterIndices[vertex] ?? -1;
    if (clusterIndex < 0) return { x: 0, y: 0 };
    const seedPhase = (this.seed % 65_521) / 65_521 * Math.PI * 2;
    const clusterPhase = seedPhase + clusterIndex * 2.399963229728653;
    const spatialPhase = restX * 1.7 + restY * 1.13;
    const magnitude = this.resolved.floatingAcceleration;
    return {
      x: (
        Math.sin(time * 0.83 + clusterPhase) * 0.75
        + Math.sin(time * 0.83 + clusterPhase + spatialPhase) * 0.25
      ) * magnitude,
      y: (
        Math.cos(time * 0.61 + clusterPhase * 1.37) * 0.75
        + Math.cos(time * 0.61 + clusterPhase * 1.37 - spatialPhase * 0.72) * 0.25
      ) * magnitude * 0.72,
    };
  }

  private tremorAccelerationForVertex(vertex: number): Point {
    const strength = this.resolved.tremorStrength;
    const factor = this.automaticSpatialFactors[vertex] ?? 0;
    const clusterIndex = this.vertexClusterIndices[vertex] ?? -1;
    if (strength <= 0 || factor === 0 || clusterIndex < 0) return { x: 0, y: 0 };
    const time = this.tickValue * this.fixedDeltaTime;
    const phase = clusterIndex * 1.618033988749895 + (this.seed % 8_191) / 8_191 * Math.PI * 2;
    const angle = time * Math.PI * 2 * this.resolved.tremorFrequency + phase;
    const acceleration = Math.sin(angle) * strength * 2 * factor;
    return { x: acceleration, y: Math.cos(angle) * strength * 0.7 * factor };
  }

  private tremorTargetForVertex(vertex: number): Point {
    const strength = this.resolved.tremorStrength;
    const factor = this.automaticSpatialFactors[vertex] ?? 0;
    const clusterIndex = this.vertexClusterIndices[vertex] ?? -1;
    if (strength <= 0 || factor === 0 || clusterIndex < 0) return { x: 0, y: 0 };
    const time = this.tickValue * this.fixedDeltaTime;
    const phase = clusterIndex * 1.618033988749895 + (this.seed % 8_191) / 8_191 * Math.PI * 2;
    const angle = time * Math.PI * 2 * this.resolved.tremorFrequency + phase;
    const selectionResponse = selectionResponseForWeight(this.mesh.weights[vertex] ?? 0);
    return {
      x: Math.sin(angle) * strength * 0.45 * factor * selectionResponse,
      y: Math.cos(angle) * strength * 0.165 * factor * selectionResponse,
    };
  }

  private initializeSpatialFields(): void {
    const assignNormalized = (
      cluster: ShapeCluster,
      target: Float64Array,
      rawValue: (vertex: number) => number,
    ): void => {
      let weightedSquareSum = 0;
      let weightSum = 0;
      for (const vertex of cluster.vertices) {
        const weight = this.mesh.weights[vertex] ?? 0;
        const raw = rawValue(vertex);
        weightedSquareSum += raw * raw * weight;
        weightSum += weight;
      }
      const rms = Math.sqrt(weightedSquareSum / Math.max(weightSum, 1e-9));
      if (rms < 1e-9) return;
      for (const vertex of cluster.vertices) {
        target[vertex] = rawValue(vertex) / rms;
      }
    };

    this.clusters.forEach((cluster, clusterIndex) => {
      for (const vertex of cluster.vertices) this.vertexClusterIndices[vertex] = clusterIndex;
      const qx = (vertex: number) => (this.mesh.restPositions[vertex * 2] ?? 0) - cluster.restCenterX;
      const qy = (vertex: number) => (this.mesh.restPositions[vertex * 2 + 1] ?? 0) - cluster.restCenterY;
      assignNormalized(cluster, this.automaticSpatialFactors, (vertex) => qx(vertex) + qy(vertex) * 0.63);
      assignNormalized(cluster, this.elongationXFactors, qx);
      assignNormalized(cluster, this.elongationYFactors, qy);
    });
  }
}

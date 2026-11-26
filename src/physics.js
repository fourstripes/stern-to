// Planar surge/sway/yaw dynamics in SI units. Positive y and yaw are starboard.
// The added-mass/Coriolis terms follow the diagonal 3-DOF form of Fossen's
// marine-craft model: https://www.fossen.biz/html/marineCraftModel.html
// These are calibrated game hulls, not measured hydrodynamic derivatives.
const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createVesselPhysics(ship) {
  const lengthScale = ship.L / 50, beamScale = ship.B / 9.4;
  const areaScale = lengthScale ** 2, yawScale = areaScale ** 2;
  return Object.freeze({
    mass: ship.m, length: ship.L, beam: ship.B,
    mx: 1.1 * ship.m, my: 1.6 * ship.m,
    iz: 1.2e8 * (ship.m / 5e5) * areaScale,
    thrustAhead: ship.tA, thrustAstern: ship.tS,
    propArm: 3.2 * beamScale,
    thrusterForce: ship.thr, thrusterArm: 20 * lengthScale,
    surgeLinear: 3000 * areaScale,
    surgeQuadratic: 5350 * lengthScale * beamScale * (ship.cd ?? 1),
    swayLinear: 20000 * areaScale, swayQuadratic: 72000 * areaScale,
    yawLinear: 4e6 * yawScale, yawQuadratic: 1.6e8 * yawScale * lengthScale,
    yawSurge: 1.5e6 * yawScale,
    rudderArm: -23 * lengthScale, rudderCoefficient: 6000 * areaScale * (ship.rudderScale ?? 1),
    // Fast planing craft need reduced full-lock authority at speed. Low-speed
    // prop-wash steering remains available for close-quarters manoeuvring.
    steeringSpeed: ship.steeringSpeed ?? Infinity
  });
}

export function vesselForces(model, state) {
  const { u, v, r } = state;
  const boost = state.thrustScale ?? 1;
  const thrust = rpm => (rpm >= 0 ? model.thrustAhead : -model.thrustAstern) * rpm * rpm * boost;
  const port = thrust(state.rpm[0]), starboard = thrust(state.rpm[1]);
  // dragScale lets a hydrofoil shed hull drag once it flies (and carry a little extra over the hump).
  const drag = state.dragScale ?? 1;
  let X = port + starboard - drag * (model.surgeLinear * u + model.surgeQuadratic * u * Math.abs(u));
  let Y = -model.swayLinear * v - model.swayQuadratic * v * Math.abs(v);
  let N = (port - starboard) * model.propArm
    - model.yawLinear * r - model.yawQuadratic * r * Math.abs(r)
    - model.yawSurge * Math.abs(u) * r;

  // Prop walk from outward-turning twin screws. A propeller going astern walks the
  // stern sideways: the port (left-handed) screw to starboard, the starboard screw
  // to port. Both astern cancel; one ahead and one astern adds to the twisting
  // couple. It is strongest from rest or making sternway and fades with headway.
  const walkFade = clamp(1 - Math.max(0, u) / 3, .2, 1);
  const walk = .045 * walkFade * (Math.max(-port, 0) - Math.max(-starboard, 0));
  Y += walk;
  N += model.rudderArm * walk;

  // Resolve the local flow normal to the rudder, including stern motion.
  // Without prop wash, F dot velocity is always <= 0. The induced axial drag
  // prevents a rudder from creating energy while it turns a coasting boat.
  const delta = state.rud * DEG / (1 + (u / (state.steeringSpeed ?? model.steeringSpeed)) ** 2);
  const sin = Math.sin(delta), cos = Math.cos(delta);
  const flowSquared = u * Math.abs(u)
    + .45 * (Math.max(port, 0) + Math.max(starboard, 0)) / model.rudderCoefficient;
  const axialFlow = Math.sign(flowSquared) * Math.sqrt(Math.abs(flowSquared));
  const lateralFlow = v + model.rudderArm * r;
  const normalForce = -model.rudderCoefficient * Math.abs(axialFlow)
    * (axialFlow * sin + lateralFlow * cos);
  X += normalForce * sin;
  Y += normalForce * cos;
  N += model.rudderArm * normalForce * cos;

  const bowThrust = state.thrAct * model.thrusterForce * clamp(1 - Math.abs(u) / 4, 0, 1);
  Y += bowThrust;
  N += model.thrusterArm * bowThrust;
  return { X, Y, N };
}

export function bodyAcceleration(model, velocity, forces) {
  const { u, v, r } = velocity;
  // All three coupling terms are required. Their combined kinetic power is
  // zero even when surge and sway added masses differ.
  return {
    u: (forces.X + model.my * v * r) / model.mx,
    v: (forces.Y - model.mx * u * r) / model.my,
    r: (forces.N + (model.mx - model.my) * u * v) / model.iz
  };
}

export function resolveContact(model, velocity, contact) {
  const { a, b, nx, ny, otherU = 0, otherV = 0, restitution = .15, friction = .25 } = contact;
  let { u, v, r } = velocity;
  const normalSpeed = (u - r * b - otherU) * nx + (v + r * a - otherV) * ny;
  if (normalSpeed >= 0) return { u, v, r, impact: 0, normalImpulse: 0, tangentImpulse: 0 };
  const arm = a * ny - b * nx;
  const effectiveMass = nx * nx / model.mx + ny * ny / model.my + arm * arm / model.iz;
  const normalImpulse = -(1 + restitution) * normalSpeed / effectiveMass;
  u += normalImpulse * nx / model.mx;
  v += normalImpulse * ny / model.my;
  r += normalImpulse * arm / model.iz;

  // Friction acts on the velocity remaining after the normal impulse.
  const tx = -ny, ty = nx, tangentArm = a * ty - b * tx;
  const tangentSpeed = (u - r * b - otherU) * tx + (v + r * a - otherV) * ty;
  const tangentMass = tx * tx / model.mx + ty * ty / model.my + tangentArm * tangentArm / model.iz;
  const tangentImpulse = clamp(-tangentSpeed / tangentMass, -friction * normalImpulse, friction * normalImpulse);
  u += tangentImpulse * tx / model.mx;
  v += tangentImpulse * ty / model.my;
  r += tangentImpulse * tangentArm / model.iz;
  return { u, v, r, impact: -normalSpeed, normalImpulse, tangentImpulse };
}

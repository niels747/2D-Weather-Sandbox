# Experimental axisymmetric atmosphere

Use the **Normal 2D / Axisymmetric 2.5D** buttons at the bottom left of the main site.
The axisymmetric chamber is lazy-loaded in a same-origin frame. The normal WebGL
loop and automatic iteration adjustment stop while the chamber is selected; its
textures, particles, settings, camera and normal save format remain in place.
Returning to Normal 2D resumes that session. This switch does not convert terrain
or clouds between coordinate systems.

The chamber has its own pause/step, presets, forcing controls, heat/moisture/swirl
brushes, field views, flow arrows and orbiting passive tracers. **Reset chamber**
restarts only this chamber using the current controls. **Load** applies the selected
preset. Forcing controls change the evolving model's forcing and outer reservoir;
they do not instantly prescribe the velocity in every cell.

The worker retains its state when hidden. It writes a device-local checkpoint every
30 real seconds while running and on mode exit. Use **Restore checkpoint** to recover
it, or **Export save / Load save** for portable `.axisweather` JSON files. Restores
start paused. A normal `.weathersandbox` file must be loaded in Normal 2D.

## Numerical model

This is an idealized, forced vortex chamber, not a forecast model or a simulation
of tornado genesis in a supercell. Radius r extends from 0 to 2 km; height z extends
from 0 to 2.8 km. The default grid has 80 radial by 112 vertical cells (25 m spacing).
Every cell represents an annular volume. All fields are independent of azimuth.
The renderer mirrors the half-plane about the axis. Cloud view integrates diagnosed
condensate through the revolved volume; it does not paint an imposed funnel.

The solver runs in a Web Worker using JavaScript typed arrays. It is independent
of the existing WebGL/GLSL solver. It targets interactivity at modest resolution;
the selected time multiplier is a target and the UI reports the achieved rate.

- Constant-reference-density Boussinesq dynamics with radial and vertical velocities
  on a staggered MAC grid and cell-centered specific angular momentum M = r vθ.
- Radial continuity uses annular face areas:
  `div(u) = ((i+1) u[i+1] - i u[i]) / ((i+1/2) dr) + (w[j+1]-w[j])/dz`.
- Pressure projection solves the cylindrical Poisson equation using Jacobi
  preconditioned conjugate gradients, with radius-weighted inner products. Both
  the matrix and velocity correction use the same face geometry. Reported p′ is
  the kinematic solution multiplied by the reference density (1.15 kg/m³), in hPa.
- The radial momentum equation includes vθ²/r. Radial and vertical velocities use
  midpoint semi-Lagrangian advection, eddy viscosity, and a near-ground drag layer.
- M and total/cloud water use conservative, slope-limited annular flux transport.
  In a closed flow the transport preserves volume-integrated angular momentum
  to floating-point roundoff; open boundaries, surface drag, viscosity and the
  forced outer reservoir can change it in the chamber.
- Viscous angular-momentum transport uses torque in flux form:
  `dM/dt = ν/r * d/dr(r³ d(M/r²)/dr) + ν d²M/dz²`.
- The axis is a face at r=0 with zero radial flow; scalar cells sit at r=dr/2
  and do not divide by zero. The ground and ceiling are impermeable. The ceiling
  is free-slip. The ground drag layer damps radial and tangential winds.
  The outer radius is open with reference perturbation pressure zero, an ambient
  scalar reservoir for inflow and a smooth peripheral relaxation zone.
- Potential temperature is advected. Simplified saturation adjustment exchanges
  cloud/vapor with latent heating, conserving total water and local moist enthalpy.
  A hydrostatic background and small pressure perturbation provide approximate
  temperature and saturation. Buoyancy includes thermal, vapor and cloud-loading
  perturbations. This does not amount to a compressible atmospheric pressure model.
- An adaptive time step constrains transport, near-axis rotation and viscosity.
  Non-finite values or extreme flow stop the worker and expose an error, while
  Normal 2D remains usable. The scheme has numerical diffusion and finite resolution.

## What this mode does not do

It cannot represent azimuthally asymmetric turbulence, multiple vortices, tornado
translation or a complete supercell. The flat chamber has no editable terrain,
solar/radiative cycle, aircraft, lightning, hail or original precipitation particle
model. Cloud condensate is carried with air; there is no rain sedimentation.
Rotation is seeded and supplied at the outer reservoir. Coriolis is omitted at
this small scale. A condensation funnel is possible only if the computed moisture
and temperature allow it; its appearance and intensity are not validated against
observations. Changes in resolution, domain, boundaries and forcing affect results.

The cylindrical momentum/pressure/friction design is informed by the axisymmetric
model discussion in [Davies-Jones (2008), NOAA/NSSL](https://ams.confex.com/ams/pdfpapers/141745.pdf).
This code is not a reproduction or validation of that research model.

## Verification

Run `node --test axisymmetric/solver.test.mjs` and
`node --test axisymmetric/integration.test.mjs` from the repository root.
Tests cover rest-state preservation, cylindrical projection, closed-flow angular
momentum conservation, centrifugal balance, zero-swirl preservation, saturation
enthalpy conservation, save validation, reset reproducibility, sustained vortex
integration and the lazy reversible mode switch. Browser rendering has not been
automatically tested in this environment.

The root remains a plain static site: serve it over HTTP as before. No package
installation is needed. `node scripts/build-static.mjs` prepares the private Sites
copy under `dist`. That build links large example saves to their original GitHub
files rather than duplicating them in the static deployment; local repository
usage retains all original save files.

Original weather sandbox: Niels Daemen and contributors. Additions are licensed
under GPL-3.0-or-later, consistent with the repository license.

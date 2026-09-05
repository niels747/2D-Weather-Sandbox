function generateLightningBoltImageData(width, height, createCanvas)
{
  const lightningCanvas = createCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // Store all segments so we can render glow + core in separate passes
  const segments = [];

  function addSegment(x1, y1, x2, y2, width, isMainBolt) {
    segments.push({ x1, y1, x2, y2, width, isMainBolt });
  }

  // ─── Color & Glow ───
  // Real lightning: hot white core with a blue-violet atmospheric glow
  function getGlowColor(w) {
    const intensity = Math.min(1, w / 2);
    const r = Math.floor(80 + 100 * intensity);
    const g = Math.floor(140 + 80 * intensity);
    const b = 255;
    return `rgba(${r}, ${g}, ${b}, 0.25)`;
  }
  function getCoreColor(w) {
    const intensity = Math.min(1, w / 2);
    const r = Math.floor(220 + 35 * intensity);
    const g = Math.floor(240 + 15 * intensity);
    const b = 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  // ─── Main Bolt ───
  let currX = width / 2.0 + (Math.random() - 0.5) * width * 0.2;
  let currY = 0;
  let angle = (Math.random() - 0.5) * 0.4;        // Start nearly vertical
  let lineWidth = 5.0 + Math.random() * 3.0;      // Slightly varied thickness
  const targetAngle = 0.0;                         // 0 = straight down
  const maxBranches = 60;                          // Fewer = more realistic
  let numBranches = 0;

  while (currY < height) {
    // Variable step size: 3–12px creates sharp zigzags instead of smooth curves
    const step = 2 + Math.random() * 6;

    // More aggressive randomness for jagged look, but strong pull back to vertical
    angle += (Math.random() - 0.5) * 1.4;
    angle -= (angle - targetAngle) * 0.2;

    const nextX = currX + Math.sin(angle) * step;
    const nextY = currY + Math.cos(angle) * step;

    addSegment(currX, currY, nextX, nextY, lineWidth, true);

    // Branching: more frequent in upper 60% of bolt, rare near ground
    const heightFactor = 1 - (currY / height) * 0.7;
    if (numBranches < maxBranches && Math.random() < 0.045 * heightFactor) {
      numBranches++;
      // Branches angle outward and downward; rarely go upward
      const branchAngle = angle + (Math.random() - 0.5) * 2.2;
      const branchWidth = lineWidth * (0.25 + Math.random() * 0.35);
      drawBranch(nextX, nextY, branchAngle, branchWidth);
    }

    // Main bolt width tapers slowly
    if (Math.random() < 0.0) {
      lineWidth = Math.max(0.0, lineWidth * 0.00);
    }

    currX = nextX;
    currY = nextY;
  }

  // ─── Branch Generator ───
  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;
    let x = startX;
    let y = startY;
    let w = line_width;

    while (y < height && w > 0.6) {
      const step = 2 + Math.random() * 5;

      // Branches are more erratic but still pulled toward their target
      angle += (Math.random() - 0.5) * 1.8;
      angle -= (angle - targetAngle) * 0.1;

      const nextX = x + Math.sin(angle) * step;
      const nextY = y + Math.cos(angle) * step;

      addSegment(x, y, nextX, nextY, w, false);

      // Branches fade exponentially (much faster than main bolt)
      w *= 0.45;
      if (Math.random() < 0.06) w *= 0.325;

      // Rare secondary branching
      if (numBranches < maxBranches && Math.random() < 0.02) {
        numBranches++;
        const subAngle = angle + (Math.random() - 0.5) * 1.2;
        drawBranch(nextX, nextY, subAngle, w * 0.45);
      }

      x = nextX;
      y = nextY;
    }
  }

  // ─── Render Passes (back-to-front for correct glow) ───
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Pass 1: Wide atmospheric glow
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(100, 160, 255, 0.4)';
  for (const s of segments) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.lineWidth = s.width * 0.1;
    ctx.strokeStyle = getGlowColor(s.width);
    ctx.stroke();
  }

  // Pass 2: Medium glow
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(180, 210, 255, 0.5)';
  for (const s of segments) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.lineWidth = s.width * 0.1;
    ctx.strokeStyle = getGlowColor(s.width);
    ctx.stroke();
  }

  // Pass 3: Bright core
  ctx.shadowBlur = 0;
  for (const s of segments) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.lineWidth = s.width;
    ctx.strokeStyle = getCoreColor(s.width);
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, width, height);
        }

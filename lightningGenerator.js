self.onmessage = (event) => {
  const {index, width, height} = event.data;
  const gray = generateLightningBolt(width, height);
  postMessage({index, width, height, data : gray}, [ gray.buffer ]);
};

function clampAngle(angle, limit = 1.35) { return angle < -limit ? -limit : (angle > limit ? limit : angle); }

function generateLightningBolt(width, height)
{
  if (typeof OffscreenCanvas === 'undefined') {
    return new Uint8Array(width * height);
  }

  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {willReadFrequently : true});

  ctx.clearRect(0, 0, width, height);

  function genLightningColor(lineWidth)
  {
    const val = Math.min(255, Math.round(12 * lineWidth * lineWidth));
    return `rgb(${val}, ${val}, ${val})`;
  }

  const maxSteps = height * 4;
  const minX = -width * 0.25;
  const maxX = width * 1.25;

  function drawBranch(startX, startY, rawTargetAngle, line_width, depth)
  {
    if (depth > 8 || line_width < 0.1)
      return;

    const targetAngle = clampAngle(rawTargetAngle);
    let angle = targetAngle;
    let steps = 0;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height && steps < maxSteps) {
      steps++;
      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      if (nextY < -20 || nextX < minX || nextX > maxX)
        break;

      angle += (Math.random() - 0.5) * 0.7;
      angle -= (angle - targetAngle) * 0.08;

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) {
        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.1)
          return;

        if (Math.random() < 0.1) {
          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width, depth + 1);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }

  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.0;
  const lineWidth = 9.0;
  const targetAngle = 0.0;
  let steps = 0;

  ctx.moveTo(startX, startY);
  ctx.lineWidth = lineWidth;

  while (startY < height && steps < maxSteps) {
    steps++;
    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    if (nextY < -20 || nextX < minX || nextX > maxX)
      break;

    angle += (Math.random() - 0.5) * 1.4;
    angle -= (angle - targetAngle) * 0.08;

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;

    if (Math.random() < 0.015 * (1.0 - nextY / height)) {
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random(), 1);
      ctx.beginPath();
      ctx.moveTo(nextX, nextY);
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const totalPixels = width * height;
  const gray = new Uint8Array(totalPixels);
  for (let p = 0, s = 0; p < totalPixels; p++, s += 4) {
    gray[p] = rgba[s];
  }
  return gray;
}

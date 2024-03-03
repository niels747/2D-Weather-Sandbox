onmessage = (event) => {
  const msg = event.data;
  console.log(msg);
  let imgElement = generateLightningBolt(msg.width, msg.height);
  postMessage(imgElement);
};


function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  const colR = 100;
  const colG = 100;
  const colB = 100;

  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.;
  let lineWidth = 9.0;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;

  while (startY < height) {

    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * 0.7;

    angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;


    if (Math.random() < 0.015 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = `rgb(${colR * lineWidth}, ${colG * lineWidth}, ${colB * lineWidth})`;
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
      ctx.beginPath();
      ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = `rgb(${colR * lineWidth}, ${colG * lineWidth}, ${colB * lineWidth})`;
  ctx.stroke();


  return ctx.getImageData(0, 0, width, height);


  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {

      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (Math.random() - 0.5) * 0.7;

      angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) { // reduce width

        ctx.strokeStyle = `rgb(${colR * line_width}, ${colG * line_width}, ${colB * line_width})`;
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.1)
          return;

        if (Math.random() < 0.1) { // branch 0.005

          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = `rgb(${colR * line_width}, ${colG * line_width}, ${colB * line_width})`;
    ctx.stroke();
  }
}
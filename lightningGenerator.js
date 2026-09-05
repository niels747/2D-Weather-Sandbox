importScripts('./lightningGeneratorCore.js');

onmessage = (event) => {
  const msg = event.data;
  // console.log(msg);
  if (typeof OffscreenCanvas == 'undefined') {
    throw new Error('OffscreenCanvas is not available in this worker.');
  }
  const imgElement =
      generateLightningBoltImageData(msg.width, msg.height, (width, height) => new OffscreenCanvas(width, height));
  postMessage(imgElement);
};

// our own camera screen, so we choose the back camera ourselves instead of trusting the phone's camera app.
// resolves with a File, or null if the person closed it. rejects if no camera can be used (caller falls back to the file picker).
export async function getStream(facing) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no camera api");
  try { return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }); }
  catch (e) { if (e && e.name === "NotAllowedError") throw e; return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false }); }
}

export async function openCamera() {
  const get = getStream;
  let facing = "environment", stream = await get(facing);
  return new Promise(resolve => {
    const el = document.createElement("div"); el.className = "camview";
    el.innerHTML = `<video playsinline autoplay muted></video>
      <div class="camtop"><button class="camb" id="cam-x" aria-label="Close">✕</button><button class="camb" id="cam-flip" aria-label="Switch camera">⟲</button></div>
      <div class="cambot"><button class="shutter" id="cam-shot" aria-label="Take photo"></button></div>`;
    document.body.appendChild(el);
    const v = el.querySelector("video"); v.srcObject = stream;
    const stop = () => { stream.getTracks().forEach(t => t.stop()); el.remove(); };
    el.querySelector("#cam-x").onclick = () => { stop(); resolve(null); };
    el.querySelector("#cam-flip").onclick = async () => {
      try { const next = await get(facing === "environment" ? "user" : "environment"); stream.getTracks().forEach(t => t.stop()); stream = next; facing = facing === "environment" ? "user" : "environment"; v.srcObject = stream; } catch {}
    };
    el.querySelector("#cam-shot").onclick = () => {
      if (!v.videoWidth) return;
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      c.toBlob(b => { stop(); resolve(new File([b], "photo.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.92);
    };
  });
}

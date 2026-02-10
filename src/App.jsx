import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, RotateCcw, Loader2, Sparkles, Wand2, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const App = () => {
  const [videoUrl, setVideoUrl] = useState(null);
  const [processedUrl, setProcessedUrl] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [cvLoaded, setCvLoaded] = useState(false);

  // 4 Anime Styles: hayao, shinkai, paprika, sketch
  const [style, setStyle] = useState('hayao'); // Default
  const [theme, setTheme] = useState('dark');

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    if (newTheme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
  };

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    const checkCV = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        setCvLoaded(true);
        clearInterval(checkCV);
        console.log("OpenCV Loaded");
      }
    }, 500);
    return () => clearInterval(checkCV);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setProcessedUrl(null);
      setStatus('idle');
      setProgress(0);
    }
  };

  const startProConversion = async () => {
    if (!cvLoaded || !videoUrl) return;
    console.log("Starting full resolution conversion:", style);
    setStatus('processing');
    setProgress(0);
    setProcessedUrl(null);

    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.preload = "auto";

    video.style.display = 'none';
    document.body.appendChild(video);

    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = reject;
      video.load();
    });

    let width = Math.ceil(video.videoWidth);
    let height = Math.ceil(video.videoHeight);

    // Safety cap for extremely large videos
    if (width > 1920) {
      const scale = 1920 / width;
      width = 1920;
      height = Math.ceil(height * scale);
    }

    console.log("Processing resolution:", width, "x", height);

    let canvas = canvasRef.current;
    if (!canvas) { await new Promise(r => setTimeout(r, 100)); canvas = canvasRef.current; }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const fps = 24;
    const stream = canvas.captureStream(fps);

    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    let selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';

    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 25000000 // 25 Mbps
      });
    } catch (e) {
      console.error("Recorder error:", e);
      recorder = new MediaRecorder(stream);
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: selectedMime });
      const url = URL.createObjectURL(blob);
      setProcessedUrl(url);
      setStatus('ready');
      document.body.removeChild(video);
      console.log("Recording stopped and saved.");
    };
    recorder.start();

    // ALLOCATE MATS
    let src = new cv.Mat(height, width, cv.CV_8UC4);
    const dst = new cv.Mat(height, width, cv.CV_8UC3);
    const gray = new cv.Mat(height, width, cv.CV_8UC1);
    const edges = new cv.Mat(height, width, cv.CV_8UC1);
    const tempMat = new cv.Mat(height, width, cv.CV_8UC3);
    const hsv = new cv.Mat();
    const channels = new cv.MatVector();
    const fullGray = new cv.Mat(height, width, cv.CV_8UC1);
    const textMask = new cv.Mat(height, width, cv.CV_8UC1);

    const duration = video.duration;
    const SAFE_DURATION = (duration && isFinite(duration)) ? duration : 30;
    const step = 1 / fps;

    try {
      let currentTime = 0;
      let frameCount = 0;

      while (currentTime < SAFE_DURATION) {
        video.currentTime = currentTime;

        await new Promise((resolve) => {
          let resolved = false;
          const h = () => { if (!resolved) { resolved = true; video.removeEventListener('seeked', h); resolve(); } };
          video.addEventListener('seeked', h);
          setTimeout(h, 400); // 400ms failsafe
        });

        ctx.drawImage(video, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);

        // Memory Alignment Check
        if (src.data.length !== imgData.data.length) {
          src.delete(); src = cv.matFromImageData(imgData);
        } else {
          src.data.set(imgData.data);
        }

        // 1. Prepare Main Mat (RGB)
        cv.cvtColor(src, dst, cv.COLOR_RGBA2RGB);

        // 2. Caption Protection (High-Brightness Mask)
        cv.cvtColor(src, fullGray, cv.COLOR_RGBA2GRAY);
        cv.threshold(fullGray, textMask, 230, 255, cv.THRESH_BINARY);

        // 3. STYLE LOGIC
        if (style === 'sketch') {
          // SKETCH: Clean High-Contrast Line Art
          cv.cvtColor(dst, gray, cv.COLOR_RGB2GRAY);
          cv.adaptiveThreshold(gray, edges, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
          cv.cvtColor(edges, dst, cv.COLOR_GRAY2RGB);
        } else {
          // ANIME MODES
          if (style === 'hayao') {
            // HAYAO: Soft Painterly look
            cv.bilateralFilter(dst, tempMat, 9, 75, 75);
            tempMat.copyTo(dst);
          } else if (style === 'shinkai') {
            // SHINKAI: High Sharpness / Geometric Clarity
            cv.medianBlur(dst, dst, 3);
            cv.GaussianBlur(dst, tempMat, new cv.Size(0, 0), 3);
            cv.addWeighted(dst, 1.5, tempMat, -0.5, 0, dst);
          } else if (style === 'paprika') {
            // PAPRIKA: Dream-like intensity
            cv.GaussianBlur(dst, tempMat, new cv.Size(5, 5), 0);
            cv.addWeighted(dst, 0.7, tempMat, 0.3, 0, dst);
          }

          // Cartoon Outlines (Optimized to prevent "Blackout")
          cv.cvtColor(dst, gray, cv.COLOR_RGB2GRAY);
          // Block size 7, Constant 5 provides clean thin lines without black chunks
          cv.adaptiveThreshold(gray, edges, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 7, 5);
          cv.cvtColor(edges, edges, cv.COLOR_GRAY2RGB);
          cv.bitwise_and(dst, edges, dst);

          // Color Enhancement (HSV Space)
          cv.cvtColor(dst, tempMat, cv.COLOR_RGB2HSV);
          cv.split(tempMat, channels);
          let sMat = channels.get(1);
          let vMat = channels.get(2);

          if (style === 'hayao') {
            // Vibrant Nature Colors
            sMat.convertTo(sMat, -1, 1.5, 10);
            vMat.convertTo(vMat, -1, 1.1, 5);
          } else if (style === 'shinkai') {
            // Higher Contrast, Clear Lighting
            sMat.convertTo(sMat, -1, 1.3, 0);
            vMat.convertTo(vMat, -1, 1.25, 10);
          } else if (style === 'paprika') {
            // Surreal Red/Orange Intensity
            sMat.convertTo(sMat, -1, 1.8, 15);
            vMat.convertTo(vMat, -1, 1.05, 0);
          }

          cv.merge(channels, tempMat);
          cv.cvtColor(tempMat, dst, cv.COLOR_HSV2RGB);
          sMat.delete(); vMat.delete();
        }

        // 4. Burn-in Protected Captions (RGBA -> RGB handled by src copy)
        // Convert src to RGB for accurate copyTo matching dst
        cv.cvtColor(src, tempMat, cv.COLOR_RGBA2RGB);
        tempMat.copyTo(dst, textMask);

        // 5. Render to Screen
        cv.imshow(canvas, dst);

        currentTime += step;
        frameCount++;

        if (frameCount % 24 === 0) {
          console.log(`Frame: ${frameCount}, Time: ${currentTime.toFixed(1)}s`);
        }

        const pct = Math.min(Math.round((currentTime / SAFE_DURATION) * 100), 100);
        setProgress(pct);
        await new Promise(r => setTimeout(r, 0));
      }
    } catch (err) {
      console.error("Processing Loop Error:", err);
      alert("Processing Error: " + err);
    } finally {
      if (recorder.state === 'recording') recorder.stop();
      // CLEANUP ALL MATS
      if (src) src.delete();
      if (dst) dst.delete();
      if (gray) gray.delete();
      if (edges) edges.delete();
      if (tempMat) tempMat.delete();
      if (hsv) hsv.delete();
      if (channels) channels.delete();
      if (fullGray) fullGray.delete();
      if (textMask) textMask.delete();
    }
  };

  const reset = () => {
    setVideoUrl(null);
    setProcessedUrl(null);
    setStatus('idle');
    setProgress(0);
  };

  return (
    <div className="container">
      <button className="theme-toggle" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <header className="header">
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h1>
            Video2<i>Studio</i>
          </h1>
          <p>Next-Gen Anime Engine</p>
        </motion.div>
      </header>

      <motion.main
        className="main-card"
        layout
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
      >
        <AnimatePresence mode="wait">
          {!videoUrl ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              transition={{ type: "spring", bounce: 0.3 }}
              className="upload-zone"
              onClick={() => cvLoaded && fileInputRef.current?.click()}
              whileHover={{ scale: 1.02, borderColor: "rgba(168, 85, 247, 0.5)" }}
              whileTap={{ scale: 0.98 }}
            >
              {!cvLoaded ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="animate-spin text-primary mb-6" size={48} />
                  <p>Initializing Neural Engine...</p>
                </div>
              ) : (
                <>
                  <Upload className="upload-icon" strokeWidth={1.5} />
                  <h3>Upload Source Footage</h3>
                  <p>Supports MP4, WebM (Max 1080p)</p>
                </>
              )}
              <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={handleFileChange} />
            </motion.div>
          ) : (
            <motion.div
              key="view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="space-y-6"
            >

              <div className="grid grid-cols-2 gap-8">
                <div className="panel">
                  <h3 className="section-title">Input</h3>
                  <div className="video-frame">
                    <video src={videoUrl} autoPlay loop muted />
                  </div>
                </div>
                <div className="panel">
                  <h3 className="section-title">Output ({style.toUpperCase()})</h3>
                  <div className="video-frame">
                    {status === 'processing' ? (
                      <>
                        <canvas ref={canvasRef} />
                        <div className="scanner-overlay">
                          <div className="scanner-line" />
                          <div className="scanner-gradient" />
                        </div>
                        <div className="loader-overlay">
                          <div className="loader-spinner" />
                          <span className="loader-text">{progress}%</span>
                        </div>
                      </>
                    ) : status === 'ready' ? (
                      <video src={processedUrl} autoPlay loop controls />
                    ) : (
                      <div className="placeholder">
                        <div className="placeholder-content">
                          <Sparkles className="mb-2 opacity-50" />
                          <span>Output Preview</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="controls-container">
                <div className="model-selector">
                  {['hayao', 'shinkai', 'paprika', 'sketch'].map(m => (
                    <button
                      key={m}
                      onClick={() => setStyle(m)}
                      className={`model-btn ${style === m ? 'active' : ''}`}
                      disabled={status === 'processing'}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div className="action-row">
                  <button className="reset-btn" onClick={reset} disabled={status === 'processing'}>
                    <RotateCcw size={20} />
                  </button>

                  {status === 'ready' ? (
                    <a href={processedUrl} download={`video2studio_${style}.webm`} className="primary-btn download">
                      <Download size={20} /> Download Result
                    </a>
                  ) : (
                    <button
                      className={`primary-btn ${status === 'processing' ? 'processing' : ''}`}
                      onClick={startProConversion}
                      disabled={status === 'processing'}
                    >
                      {status === 'processing' ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <Wand2 size={20} />
                          <span>Generate {style.toUpperCase()}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* ADVERTISEMENT BOX */}
              <div className="ad-container">
                <span className="ad-label">Advertisement</span>
                <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>Ad Space (728x90) - Place your script here</p>
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </motion.main>

      <div className="how-to-use" style={{ marginTop: '3rem', textAlign: 'center', opacity: 0.8 }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--primary)' }}>How to Use</h3>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          <span>1. Upload Video</span>
          <span>2. Select Style</span>
          <span>3. Click Generate</span>
          <span>4. Download</span>
        </div>
      </div>

      <footer className="footer">
        Studio Engine v2.3 • High Fidelity Processing
      </footer>

    </div>
  );
};

export default App;
